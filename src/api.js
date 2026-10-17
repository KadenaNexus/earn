import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { authenticated, admin } from './auth.js';
import { audit } from './db.js';
import { command, signingRequest, quote, decimal, micros, verifySignature } from './pact.js';
import { campaignSchema, campaignEditSchema, proofSignature, rewardSchema, maxTaskRewardKda, proofData, requireValue, HttpError } from './validation.js';
import { enqueue, unwrap, syncCampaign, pauseState, queuePayout } from './jobs.js';

const id = value => z.coerce.number().int().positive().parse(value);
const short = account => `${account.slice(0,10)}…${account.slice(-6)}`;
export function taskView(c) {
 const snap=c.chain_snapshot;
 const occupied=Number(c.occupied||0);
 return {id:c.id,cat:c.category,type:c.template,title:c.title,sum:c.summary,sponsor:c.sponsor_name,
   reward:c.reward_kda,mins:c.minutes_estimate,max:c.max_rewards,left:Math.max(0,Math.min(c.max_rewards-occupied,snap?c.max_rewards-Number(snap['paid-count'])-Number(snap['reserved-count']):c.max_rewards)),
   ends:Math.max(0,Math.ceil((Date.parse(c.deadline)-Date.now())/86400000)),deadline:c.deadline,featured:c.featured,ai:!!c.ai_review,
   steps:c.steps,proof:c.proof_schema.map(f=>f.label),proof_schema:c.proof_schema,status:c.status,
   escrow:snap?{funded:snap.funded,paid:snap.paid,refunded:snap.refunded,remaining:Number(snap.funded)-Number(snap.paid)-Number(snap.refunded),reserved:Number(snap.reward)*Number(snap['reserved-count']),checked_at:c.chain_checked_at}:null,
   funding_tx:c.funding_tx,hidden:!!c.hidden};
}
const campaignQuery=`SELECT c.*, (SELECT count(*) FROM submissions s WHERE s.campaign_id=c.id AND s.status IN ('reserving','in_review','changes_requested','approved','paid','payout_failed'))+
 (SELECT count(*) FROM task_starts t WHERE t.campaign_id=c.id AND t.state='started' AND t.expires_at>now()) AS occupied FROM task_campaigns c`;

export function apiRoutes(app,db,chain,c,worker) {
 const owner=admin(c);
 async function assertRunning(tx=db) {requireValue(!(await pauseState(tx,{lock:tx!==db})).paused,409,'Emergency pause is active or awaiting confirmation');}
 function assertWrites() {requireValue(c.writes,503,'Blockchain writes are disabled until deployment and review are ready');}
 async function idempotent(req,fn) {
   const key=z.string().min(8).max(120).parse(req.get('idempotency-key'));
   const fingerprint=createHash('sha256').update(JSON.stringify({method:req.method,url:req.originalUrl,body:req.body||{}})).digest('hex');
   return db.tx(async tx=>{
     await tx.query('INSERT INTO idempotency_keys(actor_id,key,fingerprint) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[req.user.id,key,fingerprint]);
     const row=(await tx.query('SELECT * FROM idempotency_keys WHERE actor_id=$1 AND key=$2 FOR UPDATE',[req.user.id,key])).rows[0];
     requireValue(row.fingerprint===fingerprint,409,'Idempotency key was used for a different action');
     if(row.response)return row.response;
     const response=await fn(tx);
     await tx.query('UPDATE idempotency_keys SET response=$3 WHERE actor_id=$1 AND key=$2',[req.user.id,key,JSON.stringify(response)]);
     return response;
   });
 }
 app.get('/api/config',(req,res)=>res.json({network:c.network,chain:c.chain,admin_account:c.admin,writes_enabled:c.writes,task_reward_cap_kda:maxTaskRewardKda,campaign_pool_cap_kda:null,slot_hold_minutes:30,explorer:'/transactions/',ai_review_max_reward_kda:c.ai.maxReward}));
 app.get('/api/transactions/:key',async(req,res)=>{const key=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.params.key);const result=await chain.poll(key);requireValue(result,404,'Transaction has not confirmed yet');res.json(result);});
 app.get('/api/tasks',async(req,res)=>{
   const rows=(await db.query(`${campaignQuery} WHERE c.status='open' AND NOT c.hidden AND c.deadline>now() ORDER BY c.created_at DESC`)).rows;
   let list=rows.map(taskView);
   if(req.query.category)list=list.filter(t=>t.cat===req.query.category);
   if(req.query.q){const q=String(req.query.q).toLowerCase();list=list.filter(t=>(t.title+' '+t.sum+' '+t.sponsor).toLowerCase().includes(q));}
   const sorts={reward:(a,b)=>Number(b.reward)-Number(a.reward),time:(a,b)=>a.mins-b.mins,ending:(a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline)};
   if(sorts[req.query.sort])list.sort(sorts[req.query.sort]);
   res.json(list);
 });
 app.get('/api/tasks/:id',async(req,res)=>{
   const cid=id(req.params.id);let row=(await db.query(`${campaignQuery} WHERE c.id=$1`,[cid])).rows[0];
   requireValue(row&&row.funding_tx,404,'Task not found');
   if(!row.chain_checked_at||Date.now()-Date.parse(row.chain_checked_at)>20000){await syncCampaign(db,chain,cid);row=(await db.query(`${campaignQuery} WHERE c.id=$1`,[cid])).rows[0];}
   res.json(taskView(row));
 });
 app.get('/api/campaigns/:id/ledger',async(req,res)=>res.json((await db.query('SELECT event_type,amount_kda,tx,created_at FROM campaign_ledger WHERE campaign_id=$1 ORDER BY id',[id(req.params.id)])).rows));
 app.get('/api/stats',async(req,res)=>{
   const r=(await db.query(`SELECT count(*) AS paid_submissions,coalesce(sum(p.amount_kda),0) AS kda_paid,count(*) FILTER(WHERE s.ai_reviewed) AS ai_paid_submissions,coalesce(sum(p.amount_kda) FILTER(WHERE s.ai_reviewed),0) AS ai_kda_paid FROM payouts p JOIN submissions s ON s.id=p.submission_id WHERE p.status='confirmed'`)).rows[0];
   const campaigns=(await db.query("SELECT reward_kda,max_rewards,chain_snapshot FROM task_campaigns WHERE status='open' AND NOT hidden AND deadline>now()")).rows;
   let open=0n;for(const t of campaigns)if(t.chain_snapshot)open+=micros(t.reward_kda)*BigInt(Math.max(0,t.max_rewards-Number(t.chain_snapshot['paid-count'])-Number(t.chain_snapshot['reserved-count'])));
   res.json({...r,open_rewards:Number(open)/1e6});
 });
 app.get('/api/payouts/recent',async(req,res)=>{
   const limit=z.coerce.number().int().min(1).max(50).parse(req.query.limit||4);
   const rows=(await db.query(`SELECT p.amount_kda reward,p.request_key tx,c.template type,c.sponsor_name sponsor,s.ai_reviewed ai,CASE WHEN s.ai_reviewed THEN s.id END receipt,u.kadena_account FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN users u ON u.id=s.user_id JOIN task_campaigns c ON c.id=s.campaign_id WHERE p.status='confirmed' ORDER BY p.paid_at DESC,p.id DESC LIMIT $1`,[limit])).rows;
   res.json(rows.map(({kadena_account,...r})=>({...r,who:short(kadena_account)})));
 });
 // Public receipt of an AI payout: the exact text whose SHA-256 is in the payout transaction's data.
 app.get('/api/ai-receipts/:id',async(req,res)=>{
   const sid=z.string().uuid().parse(req.params.id);
   const r=(await db.query(`SELECT a.receipt,a.receipt_hash,p.status,p.request_key,p.paid_at FROM ai_reviews a LEFT JOIN payouts p ON p.submission_id=a.submission_id
     WHERE a.submission_id=$1 AND a.applied='approved' AND a.receipt IS NOT NULL ORDER BY a.id DESC,p.created_at DESC LIMIT 1`,[sid])).rows[0];
   requireValue(r,404,'No AI receipt for this submission');
   res.json({receipt:r.receipt,receipt_sha256:r.receipt_hash,payout:{status:r.status||null,tx:r.request_key||null,paid_at:r.paid_at||null},network:c.network,chain:c.chain});
 });
 app.get('/api/leaderboard',async(req,res)=>{
   const rows=(await db.query(`SELECT u.kadena_account, count(*) done,sum(p.amount_kda) earned FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN users u ON u.id=s.user_id WHERE p.status='confirmed' GROUP BY u.id ORDER BY done DESC,earned DESC,u.id LIMIT 100`)).rows;
   res.json(rows.map(({kadena_account,...r})=>({...r,name:short(kadena_account),you:kadena_account===req.user?.kadena_account})));
 });
 app.get('/api/work',async(req,res)=>{
   const rows=(await db.query(`SELECT w.id,w.finding_text f,w.public_links links,s.ai_reviewed ai,CASE WHEN s.ai_reviewed THEN s.id END receipt,p.paid_at d,p.request_key tx,p.amount_kda r,c.title t,c.category cat,c.sponsor_name sp,u.kadena_account FROM work_items w JOIN submissions s ON s.id=w.submission_id JOIN payouts p ON p.submission_id=s.id JOIN task_campaigns c ON c.id=s.campaign_id JOIN users u ON u.id=s.user_id WHERE p.status='confirmed' ORDER BY p.paid_at DESC LIMIT 500`)).rows;
   let list=rows.map(({kadena_account,...r})=>({...r,by:short(kadena_account)}));
   if(req.query.filter&&req.query.filter!=='all')list=list.filter(r=>r.cat===req.query.filter);
   if(req.query.q){const q=String(req.query.q).toLowerCase();list=list.filter(r=>(r.f+r.t+r.by+r.sp).toLowerCase().includes(q));}
   res.json(list);
 });
 app.get('/api/me/tasks',authenticated,async(req,res)=>{
   const rows=(await db.query(`SELECT c.id campaign_id,c.title t,c.reward_kda r,c.deadline,t.expires_at,s.id submission_id,s.status,s.review_note,s.ai_reviewed ai,s.proof_json,s.public_consent,p.request_key tx,p.error,
     coalesce(s.submitted_at,t.started_at) AS "when",CASE WHEN s.id IS NULL THEN CASE WHEN t.expires_at>now() THEN 'started' ELSE 'expired' END ELSE s.status END AS s
     FROM task_starts t JOIN task_campaigns c ON c.id=t.campaign_id LEFT JOIN submissions s ON s.campaign_id=c.id AND s.user_id=t.user_id LEFT JOIN payouts p ON p.submission_id=s.id WHERE t.user_id=$1 ORDER BY t.started_at DESC`,[req.user.id])).rows;
   res.json(rows);
 });
 app.get('/api/me/rewards',authenticated,async(req,res)=>res.json((await db.query(`SELECT coalesce(sum(c.reward_kda) FILTER(WHERE s.status='paid'),0) paid,coalesce(sum(c.reward_kda) FILTER(WHERE s.status IN ('approved','payout_failed')),0) approved,coalesce(sum(c.reward_kda) FILTER(WHERE s.status IN ('reserving','in_review','changes_requested')),0) review FROM submissions s JOIN task_campaigns c ON c.id=s.campaign_id WHERE s.user_id=$1`,[req.user.id])).rows[0]));
 app.post('/api/tasks/:id/start',authenticated,async(req,res)=>{
   const cid=id(req.params.id);assertWrites();
   const result=await db.tx(async tx=>{
     await assertRunning(tx);
     const row=(await tx.query('SELECT * FROM task_campaigns WHERE id=$1 FOR UPDATE',[cid])).rows[0];
     requireValue(row?.status==='open'&&Date.parse(row.deadline)>Date.now(),409,'Campaign is not accepting work');
     requireValue(!row.hidden,409,'This task is no longer accepting new contributors');
     const mine=(await tx.query('SELECT s.status FROM submissions s WHERE campaign_id=$1 AND user_id=$2',[cid,req.user.id])).rows[0];
     requireValue(!mine||mine.status==='reservation_failed',409,'You already submitted this task');
     const existing=(await tx.query('SELECT * FROM task_starts WHERE campaign_id=$1 AND user_id=$2',[cid,req.user.id])).rows[0];
     if(existing?.state==='started'&&Date.parse(existing.expires_at)>Date.now())return existing;
     const occupied=Number((await tx.query(`SELECT (SELECT count(*) FROM submissions WHERE campaign_id=$1 AND status NOT IN ('rejected','reservation_failed'))+(SELECT count(*) FROM task_starts WHERE campaign_id=$1 AND state='started' AND expires_at>now()) AS n`,[cid])).rows[0].n);
     const chainOccupied=row.chain_snapshot?Number(row.chain_snapshot['paid-count'])+Number(row.chain_snapshot['reserved-count']):0;
     requireValue(Math.max(occupied,chainOccupied)<row.max_rewards,409,'All reward slots are held or filled');
     const start=(await tx.query(`INSERT INTO task_starts(campaign_id,user_id,expires_at) VALUES($1,$2,least(now()+interval '30 minutes',$3)) ON CONFLICT(campaign_id,user_id) DO UPDATE SET state='started',started_at=now(),expires_at=excluded.expires_at RETURNING *`,[cid,req.user.id,row.deadline])).rows[0];
     await audit(tx,req.user.id,'start','campaign',cid);return start;
   });res.json(result);
 });
 app.post('/api/tasks/:id/submit',authenticated,async(req,res)=>{
   const cid=id(req.params.id);assertWrites();
   res.json(await db.tx(async tx=>{
     await assertRunning(tx);
     const campaign=(await tx.query('SELECT * FROM task_campaigns WHERE id=$1 FOR UPDATE',[cid])).rows[0];requireValue(campaign,404,'Task not found');
     const input=proofData(campaign.proof_schema,req.body);
     const existing=(await tx.query('SELECT * FROM submissions WHERE campaign_id=$1 AND user_id=$2 FOR UPDATE',[cid,req.user.id])).rows[0];
     if(existing?.status==='changes_requested') {
       const updated=(await tx.query("UPDATE submissions SET proof_json=$2,public_consent=$3,status='in_review',submitted_at=now() WHERE id=$1 RETURNING *",[existing.id,JSON.stringify(input.proof),input.consent])).rows[0];
       await audit(tx,req.user.id,'resubmit','submission',existing.id);return updated;
     }
     requireValue(!existing||existing.status==='reservation_failed',409,'This task was already submitted');
     requireValue(campaign.status==='open'&&Date.parse(campaign.deadline)>Date.now(),409,'Campaign deadline has passed');
     const start=(await tx.query('SELECT * FROM task_starts WHERE campaign_id=$1 AND user_id=$2 FOR UPDATE',[cid,req.user.id])).rows[0];
     requireValue(start?.state==='started'&&Date.parse(start.expires_at)>Date.now(),409,'Start the task again to reserve a slot');
     const sid=existing?.id||randomUUID();
     const s=(await tx.query(`INSERT INTO submissions(id,campaign_id,user_id,proof_json,public_consent,status) VALUES($1,$2,$3,$4,$5,'reserving') ON CONFLICT(campaign_id,user_id) DO UPDATE SET proof_json=excluded.proof_json,public_consent=excluded.public_consent,status='reserving',submitted_at=now(),review_note=NULL RETURNING *`,[sid,cid,req.user.id,JSON.stringify(input.proof),input.consent])).rows[0];
     await tx.query("UPDATE task_starts SET state='submitted' WHERE id=$1",[start.id]);
     await enqueue(tx,{key:`reserve:${sid}:${randomUUID()}`,kind:'reserve',campaign:cid,submission:sid,actor:req.user.id,command:chain.ops(`(${c.module}.reserve-claim ${quote(campaign.pact_campaign_id)} ${quote(sid)} ${quote(req.user.kadena_account)})`,{'recipient-keyset':{keys:[req.user.kadena_account.slice(2)],pred:'keys-all'}})});
     await audit(tx,req.user.id,'submit','submission',sid);return s;
   }));
 });
 app.get('/api/reviewer/submissions',owner,async(req,res)=>res.json((await db.query(`SELECT s.*,c.title task,c.reward_kda reward,c.proof_schema,c.ai_review campaign_ai,u.kadena_account AS "by",
   (SELECT json_build_object('decision',a.decision,'confidence',a.confidence,'reasons',a.reasons,'note',a.note,'applied',a.applied,'skip_reason',a.skip_reason,'at',a.created_at) FROM ai_reviews a WHERE a.submission_id=s.id ORDER BY a.id DESC LIMIT 1) ai
   FROM submissions s JOIN task_campaigns c ON c.id=s.campaign_id JOIN users u ON u.id=s.user_id WHERE s.status IN ('in_review','changes_requested') ORDER BY s.submitted_at`)).rows));
 for(const action of ['approve','reject','request-changes'])app.post(`/api/submissions/:id/${action}`,owner,async(req,res)=>{
   const sid=z.uuid().parse(req.params.id);const {note=''}=z.object({note:z.string().trim().max(2000).optional()}).strict().parse(req.body||{});
   requireValue(action==='approve'||note.length>=5,400,'A review note of at least five characters is required');
   res.json(await db.tx(async tx=>{
     const s=(await tx.query('SELECT * FROM submissions WHERE id=$1 FOR UPDATE',[sid])).rows[0];
     requireValue(s&&['in_review','changes_requested'].includes(s.status),409,'Submission is no longer awaiting a decision');
     requireValue(action!=='approve'||s.status==='in_review',409,'Contributor must resubmit the requested changes');
     const camp=(await tx.query('SELECT * FROM task_campaigns WHERE id=$1',[s.campaign_id])).rows[0];
     if(action==='approve') {
       const user=(await tx.query('SELECT * FROM users WHERE id=$1',[s.user_id])).rows[0];
       await tx.query('INSERT INTO payouts(submission_id,amount_kda,recipient) VALUES($1,$2,$3)',[sid,camp.reward_kda,user.kadena_account]);
     }
     if(action==='reject'){assertWrites();await enqueue(tx,{key:`release:${sid}`,kind:'release',campaign:camp.id,submission:sid,actor:req.user.id,command:chain.ops(`(${c.module}.release-claim ${quote(camp.pact_campaign_id)} ${quote(sid)})`)});}
     const status=action==='approve'?'approved':action==='reject'?'rejected':'changes_requested';
     await tx.query('UPDATE submissions SET status=$2,reviewer_id=$3,review_note=$4,reviewed_at=now() WHERE id=$1',[sid,status,req.user.id,note]);
     await audit(tx,req.user.id,action,'submission',sid,{note});return {status};
   }));
 });
 // Undo an approval whose payout has not been sent: nothing is on chain yet
 // (the reward stays reserved in escrow), so the submission goes back to the
 // contributor as "changes requested" and the pending payout is removed.
 app.post('/api/submissions/:id/undo-approval',owner,async(req,res)=>{
   const sid=z.uuid().parse(req.params.id);const {note}=z.object({note:z.string().trim().min(5).max(2000)}).strict().parse(req.body||{});
   res.json(await db.tx(async tx=>{
     const s=(await tx.query('SELECT * FROM submissions WHERE id=$1 FOR UPDATE',[sid])).rows[0];
     requireValue(s&&s.status==='approved',409,'Only an approved, unsent submission can be reopened');
     const p=(await tx.query('SELECT * FROM payouts WHERE submission_id=$1 FOR UPDATE',[sid])).rows[0];
     requireValue(p&&p.status==='pending'&&!p.request_key,409,'This payout was already sent and cannot be undone');
     requireValue(!(await tx.query('SELECT 1 FROM chain_jobs WHERE payout_id=$1',[p.id])).rowCount,409,'This payout was already sent and cannot be undone');
     await tx.query('DELETE FROM payouts WHERE id=$1',[p.id]);
     await tx.query("UPDATE submissions SET status='changes_requested',reviewer_id=$2,review_note=$3,reviewed_at=now() WHERE id=$1",[sid,req.user.id,note]);
     await audit(tx,req.user.id,'undo_approval','submission',sid,{payout:p.id,note});return {status:'changes_requested'};
   }));
 });
 app.get('/api/admin/payouts',owner,async(req,res)=>res.json((await db.query(`SELECT p.*,c.title task,s.id sub,s.ai_reviewed ai,u.kadena_account AS "by" FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN task_campaigns c ON c.id=s.campaign_id JOIN users u ON u.id=s.user_id ORDER BY p.created_at DESC`)).rows));
 async function sendPayout(tx,pid,req,retry=false) {
   assertWrites();await assertRunning(tx);
   return queuePayout(tx,chain,c,pid,{actor:req.user.id,retry});
 }
 for(const action of ['send','retry'])app.post(`/api/admin/payouts/:id/${action}`,owner,async(req,res)=>res.json(await idempotent(req,tx=>sendPayout(tx,id(req.params.id),req,action==='retry'))));
 app.post('/api/admin/payouts/send-all',owner,async(req,res)=>res.json(await idempotent(req,async tx=>{
   assertWrites();await assertRunning(tx);
   const rows=(await tx.query("SELECT id FROM payouts WHERE status='pending' ORDER BY id LIMIT 100 FOR UPDATE")).rows;
   const sent=[];for(const p of rows)sent.push(await sendPayout(tx,p.id,req));return {sent};
 })));
 // Work in progress pins the proof fields: a started slot, or proof that is
 // still reserving, in review or being revised against the current fields.
 const inProgress=`(SELECT count(*) FROM submissions s WHERE s.campaign_id=c.id AND s.status IN ('reserving','in_review','changes_requested'))+
   (SELECT count(*) FROM task_starts t WHERE t.campaign_id=c.id AND t.state='started' AND t.expires_at>now())`;
 app.get('/api/admin/campaigns',owner,async(req,res)=>res.json((await db.query(`SELECT q.*,(SELECT ${inProgress} FROM task_campaigns c WHERE c.id=q.id) AS in_progress FROM (${campaignQuery}) q ORDER BY q.created_at DESC`)).rows
   .map(r=>({...taskView(r),ai_criteria:r.ai_criteria||'',in_progress:Number(r.in_progress),editable:['draft','funding','funding_failed','open'].includes(r.status)}))));
 app.post('/api/admin/campaigns/:id/edit',owner,async(req,res)=>{
   const cid=id(req.params.id);const input=campaignEditSchema.parse(req.body);
   res.json(await db.tx(async tx=>{
     const row=(await tx.query('SELECT * FROM task_campaigns WHERE id=$1 FOR UPDATE',[cid])).rows[0];
     requireValue(row,404,'Campaign not found');
     requireValue(['draft','funding','funding_failed','open'].includes(row.status),409,'This task has ended and can no longer be edited');
     const fieldsChanged=proofSignature(row.proof_schema)!==proofSignature(input.proof_schema);
     if(fieldsChanged){
       const busy=Number((await tx.query(`SELECT ${inProgress} AS n FROM task_campaigns c WHERE c.id=$1`,[cid])).rows[0].n);
       requireValue(busy===0,409,`Proof fields can't change while ${busy} ${busy===1?'person is':'people are'} working on this task. Other edits are fine; try the proof fields again once their work is reviewed.`);
     }
     const changed=['title','summary','sponsor_name','category','template','minutes_estimate','featured','ai_review'].filter(k=>row[k]!==input[k]);
     if(JSON.stringify(row.steps)!==JSON.stringify(input.steps))changed.push('steps');
     if(fieldsChanged)changed.push('proof_schema');
     if((row.ai_criteria||'')!==(input.ai_criteria||''))changed.push('ai_criteria');
     const updated=(await tx.query(`UPDATE task_campaigns SET title=$2,summary=$3,sponsor_name=$4,category=$5,template=$6,minutes_estimate=$7,steps=$8,proof_schema=$9,featured=$10,ai_review=$11,ai_criteria=$12,updated_at=now() WHERE id=$1 RETURNING *`,
       [cid,input.title,input.summary,input.sponsor_name,input.category,input.template,input.minutes_estimate,JSON.stringify(input.steps),JSON.stringify(input.proof_schema),input.featured,input.ai_review,input.ai_criteria||null])).rows[0];
     await audit(tx,req.user.id,'edit','campaign',cid,{changed});
     return {campaign:taskView(updated),changed};
   }));
 });
 app.post('/api/admin/campaigns/:id/visibility',owner,async(req,res)=>{
   const cid=id(req.params.id);const {hidden}=z.object({hidden:z.boolean()}).strict().parse(req.body||{});
   res.json(await db.tx(async tx=>{
     const row=(await tx.query('UPDATE task_campaigns SET hidden=$2,updated_at=now() WHERE id=$1 RETURNING id,hidden',[cid,hidden])).rows[0];
     requireValue(row,404,'Campaign not found');
     await audit(tx,req.user.id,hidden?'hide':'unhide','campaign',cid);return row;
   }));
 });
 app.post('/api/admin/campaigns',owner,async(req,res)=>{
   assertWrites();const input=campaignSchema.parse(req.body);
   res.json(await idempotent(req,async tx=>{
     await assertRunning(tx);const pactId=`campaign-${randomUUID()}`;
     const row=(await tx.query(`INSERT INTO task_campaigns(pact_campaign_id,sponsor_name,sponsor_account,title,summary,category,template,steps,proof_schema,reward_kda,max_rewards,minutes_estimate,deadline,featured,ai_review,ai_criteria) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[pactId,input.sponsor_name,c.admin,input.title,input.summary,input.category,input.template,JSON.stringify(input.steps),JSON.stringify(input.proof_schema),input.reward_kda,input.max_rewards,input.minutes_estimate,input.deadline,input.featured,input.ai_review,input.ai_criteria||null])).rows[0];
     await audit(tx,req.user.id,'create','campaign',row.id);return {campaign:taskView(row)};
   }));
 });
 app.post('/api/admin/campaigns/:id/funding-command',owner,async(req,res)=>{
   assertWrites();await assertRunning();const row=(await db.query('SELECT * FROM task_campaigns WHERE id=$1',[id(req.params.id)])).rows[0];
   requireValue(row&&['draft','funding_failed'].includes(row.status),409,'Campaign is already being funded');
   rewardSchema.parse(row.reward_kda);
   const pool=Number(micros(row.reward_kda)*BigInt(row.max_rewards))/1e6;
   const code=`(${c.module}.create-and-fund ${quote(row.pact_campaign_id)} ${quote(c.admin)} ${decimal(row.reward_kda)} ${row.max_rewards} (time ${quote(new Date(row.deadline).toISOString().replace(/\.\d{3}Z$/,'Z'))}))`;
   const tx=command(c,code,{'recipient-keyset':{keys:[c.admin.slice(2)],pred:'keys-all'}},c.admin.slice(2),[{name:'coin.GAS',args:[]},{name:`${c.module}.GOVERNANCE`,args:[]},{name:'coin.TRANSFER',args:[c.admin,`${c.module.replace('.','-')}-escrow`,pool]}]);
   res.json({command:tx,signing_request:signingRequest(tx)});
 });
 app.post('/api/admin/campaigns/:id/confirm-funding',owner,async(req,res)=>{
   assertWrites();const cid=id(req.params.id);const signed=req.body?.signed_command;
   requireValue(verifySignature(signed,c.admin.slice(2)),400,'Owner-signed funding command is required');
   res.json(await idempotent(req,async tx=>{
     await assertRunning(tx);const row=(await tx.query('SELECT * FROM task_campaigns WHERE id=$1 FOR UPDATE',[cid])).rows[0];
     requireValue(row,404,'Campaign not found');
     if(row.funding_tx===signed.hash)return {status:row.status,request_key:row.funding_tx};
     requireValue(['draft','funding_failed'].includes(row.status),409,'Campaign already has a funding transaction');
     rewardSchema.parse(row.reward_kda);
     const b=JSON.parse(signed.cmd);
     const expected=`(${c.module}.create-and-fund ${quote(row.pact_campaign_id)} ${quote(c.admin)} ${decimal(row.reward_kda)} ${row.max_rewards} (time ${quote(new Date(row.deadline).toISOString().replace(/\.\d{3}Z$/,'Z'))}))`;
     requireValue(b.networkId===c.network&&b.meta.chainId===c.chain&&b.payload.exec.code===expected,400,'Funding command does not match this campaign');
     await enqueue(tx,{key:`fund:${cid}:${signed.hash}`,kind:'fund',campaign:cid,actor:req.user.id,command:signed});
     await tx.query("UPDATE task_campaigns SET status='funding',funding_tx=$2 WHERE id=$1",[cid,signed.hash]);
     await audit(tx,req.user.id,'fund','campaign',cid,{tx:signed.hash});return {status:'funding',request_key:signed.hash};
   }));
 });
 app.post('/api/admin/pause-command',owner,async(req,res)=>{
   assertWrites();const {paused}=z.object({paused:z.boolean()}).strict().parse(req.body);
   const prepared=await db.tx(async tx=>{
     requireValue(!(await pauseState(tx,{lock:true})).pending,409,'A pause transition is awaiting confirmation');
     const unsigned=command(c,`(${c.module}.set-global-pause (read-msg "paused"))`,{paused},c.admin.slice(2),[{name:'coin.GAS',args:[]},{name:`${c.module}.GOVERNANCE`,args:[]}]);
     return {command:unsigned,signing_request:signingRequest(unsigned)};
   });res.json(prepared);
 });
 app.post('/api/admin/pause',owner,async(req,res)=>{
   assertWrites();const signed=req.body?.signed_command;requireValue(verifySignature(signed,c.admin.slice(2)),400,'Owner wallet signature required');
   const b=JSON.parse(signed.cmd);requireValue(b.networkId===c.network&&b.meta.chainId===c.chain&&b.payload.exec.code===`(${c.module}.set-global-pause (read-msg "paused"))`&&typeof b.payload.exec.data.paused==='boolean',400,'Invalid pause command');
   res.json(await idempotent(req,async tx=>{
     const pending=(await pauseState(tx,{lock:true})).pending;
     const existing=(await tx.query("SELECT id,status,request_key FROM chain_jobs WHERE dedupe_key=$1",[`pause:${signed.hash}`])).rows[0];
     if(existing)return {job_id:existing.id,status:existing.status,request_key:existing.request_key};
     requireValue(!pending,409,'A pause transition is awaiting confirmation');
     requireValue(Number.isFinite(b.meta.creationTime)&&Number.isFinite(b.meta.ttl)&&b.meta.creationTime+b.meta.ttl>Math.floor(Date.now()/1000),400,'Pause command expired; prepare again');
     // Both directions stop money jobs until the native-depth result confirms.
     await tx.query("UPDATE settings SET value='true' WHERE key='payouts_paused'");
     const job=await enqueue(tx,{key:`pause:${signed.hash}`,kind:'pause',actor:req.user.id,command:signed});
     await audit(tx,req.user.id,'pause_requested','global','pause',{paused:b.payload.exec.data.paused,tx:signed.hash});
     return {job_id:job.id,status:job.status,request_key:signed.hash};
   }));
 });
 app.get('/api/admin/kpi',owner,async(req,res)=>{
   const request=req.query.pause_request===undefined?null:z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.pause_request);
   const totals=(await db.query("SELECT coalesce(sum(amount_kda) FILTER(WHERE status='confirmed'),0) paid_all_time,coalesce(sum(amount_kda) FILTER(WHERE status<>'confirmed'),0) approved_unpaid FROM payouts")).rows[0];
   const count=(await db.query("SELECT count(*) n FROM submissions WHERE status='in_review'")).rows[0].n;
   const locked=(await db.query('SELECT chain_snapshot FROM task_campaigns WHERE chain_snapshot IS NOT NULL')).rows.reduce((n,r)=>n+Number(r.chain_snapshot.funded)-Number(r.chain_snapshot.paid)-Number(r.chain_snapshot.refunded),0);
   const pause=await db.tx(async tx=>{
     const state=await pauseState(tx,{lock:true});
     const job=request?(await tx.query("SELECT id,status,request_key FROM chain_jobs WHERE kind='pause' AND request_key=$1",[request])).rows[0]||null:null;
     return {...state,job};
   });
   const aiOn=(await db.query("SELECT value FROM settings WHERE key='ai_review_enabled'")).rows[0]?.value===true;
   res.json({...totals,ai_review_enabled:aiOn,awaiting_review:count,escrow_locked:locked,paused:pause.paused,pause_pending:pause.pending,pause_job:pause.job,worker:{last_success:worker.lastSuccess,error:worker.lastError}});
 });
 app.get('/api/admin/ai-review',owner,async(req,res)=>{
   const on=(await db.query("SELECT value FROM settings WHERE key='ai_review_enabled'")).rows[0]?.value===true;
   const day=(await db.query(`SELECT count(*) FILTER(WHERE applied='approved') approved,count(*) FILTER(WHERE applied='changes_requested') changes,count(*) FILTER(WHERE applied='escalated') escalated FROM ai_reviews WHERE created_at>now()-interval '24 hours'`)).rows[0];
   const spent=(await db.query(`SELECT coalesce(sum(p.amount_kda),0) kda FROM payouts p JOIN submissions s ON s.id=p.submission_id WHERE s.ai_reviewed AND p.created_at>now()-interval '24 hours'`)).rows[0].kda;
   const recent=(await db.query(`SELECT a.submission_id,a.decision,a.confidence,a.applied,a.skip_reason,a.reasons,a.created_at,c.title task FROM ai_reviews a JOIN submissions s ON s.id=a.submission_id JOIN task_campaigns c ON c.id=s.campaign_id ORDER BY a.id DESC LIMIT 50`)).rows;
   res.json({enabled:on,configured:!!worker.agent,model:c.ai.model,max_reward_kda:c.ai.maxReward,daily_kda:c.ai.dailyKda,min_confidence:c.ai.minConfidence,spent_24h:spent,last_24h:day,last_run:worker.agent?.lastRun||null,last_error:worker.agent?.lastError||null,recent});
 });
 app.post('/api/admin/ai-review',owner,async(req,res)=>{
   const {enabled}=z.object({enabled:z.boolean()}).strict().parse(req.body||{});
   requireValue(!enabled||worker.agent,409,'Set ANTHROPIC_API_KEY on the server before turning on the AI reviewer');
   await db.tx(async tx=>{await tx.query("UPDATE settings SET value=$1 WHERE key='ai_review_enabled'",[JSON.stringify(enabled)]);await audit(tx,req.user.id,enabled?'ai_review_on':'ai_review_off','settings','ai_review_enabled');});
   res.json({enabled});
 });
 app.get('/api/admin/jobs',owner,async(req,res)=>res.json((await db.query('SELECT id,kind,campaign_id,submission_id,payout_id,status,request_key,error,created_at FROM chain_jobs ORDER BY created_at DESC LIMIT 100')).rows));
 app.get('/api/admin/audit',owner,async(req,res)=>res.json((await db.query('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200')).rows));
 app.get('/api/admin/jobs/:id',owner,async(req,res)=>{
   const row=(await db.query('SELECT id,kind,status,request_key,error FROM chain_jobs WHERE id=$1',[z.uuid().parse(req.params.id)])).rows[0];requireValue(row,404,'Job not found');res.json(row);
 });
}
