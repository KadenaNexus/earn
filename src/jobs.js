import { randomUUID } from 'node:crypto';
import { quote, micros } from './pact.js';
import { audit } from './db.js';
import { publicProof, requireValue } from './validation.js';

export async function enqueue(tx,{key,kind,campaign,submission,payout,actor,command}) {
 const id=randomUUID();
 const r=await tx.query(`INSERT INTO chain_jobs(id,dedupe_key,kind,campaign_id,submission_id,payout_id,actor_id,command,request_key)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=excluded.dedupe_key RETURNING *`,[id,key,kind,campaign||null,submission||null,payout||null,actor||null,JSON.stringify(command),command.hash]);
 return r.rows[0];
}
// The settings row is the pause-transition mutex. Pending jobs are deliberately
// read without row locks: the worker may already hold their locks while waiting
// for this mutex to reconcile a confirmed transition.
export async function pauseState(tx,{lock=false}={}) {
 const row=(await tx.query("SELECT value FROM settings WHERE key='payouts_paused'"+(lock?' FOR UPDATE':''))).rows[0];
 const pending=(await tx.query("SELECT id,request_key FROM chain_jobs WHERE kind='pause' AND status IN ('prepared','broadcast') ORDER BY created_at,id LIMIT 1")).rows[0]||null;
 return {paused:!!row.value||!!pending,pending};
}
// Shared by the owner's Send/Retry buttons and the AI review agent, so both
// pay the fixed reserved reward to the fixed recipient through the same job.
// Callers must check writes and the pause gate first.
export async function queuePayout(tx,chain,c,pid,{actor=null,retry=false,agent=false}={}) {
 const p=(await tx.query('SELECT p.*,s.campaign_id,c.pact_campaign_id FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN task_campaigns c ON c.id=s.campaign_id WHERE p.id=$1 FOR UPDATE OF p',[pid])).rows[0];
 requireValue(p,404,'Payout not found');
 if(['sending','confirmed'].includes(p.status))return {status:p.status,request_key:p.request_key};
 requireValue(p.status===(retry?'failed':'pending'),409,retry?'Only a conclusively failed payout can be retried':'Use Retry for a failed payout');
 requireValue(!retry||p.retry_count<3,409,'Three retries exhausted; reconcile the transaction before further action');
 const job=await enqueue(tx,{key:`payout:${p.id}:${p.retry_count+(retry?1:0)}`,kind:'payout',campaign:p.campaign_id,submission:p.submission_id,payout:p.id,actor,command:chain.ops(`(${c.module}.pay-reward ${quote(p.pact_campaign_id)} ${quote(p.submission_id)} ${quote(p.recipient)})`,{'recipient-keyset':{keys:[p.recipient.slice(2)],pred:'keys-all'}})});
 await tx.query("UPDATE payouts SET status='sending',request_key=$2,error=NULL,retry_count=retry_count+$3 WHERE id=$1",[pid,job.request_key,retry?1:0]);
 await audit(tx,actor,retry?'retry':'send','payout',pid,{tx:job.request_key,...(agent?{agent:true}:{})});return {status:'sending',request_key:job.request_key};
}
export function unwrap(value) {
 if (value&&typeof value==='object'&&!Array.isArray(value)) {
   if ('decimal' in value) return String(value.decimal);
   if ('int' in value) return Number(value.int);
   return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,unwrap(v)]));
 }
 return value;
}
export async function syncCampaign(db,chain,id) {
 const row=(await db.query('SELECT * FROM task_campaigns WHERE id=$1',[id])).rows[0];
 if(!row?.funding_tx)return null;
 // Public task reads must not bypass the worker's confirmation-depth gate.
 // Bind to the current funding attempt, not any previous job for this campaign.
 if(!(await db.query("SELECT 1 FROM chain_jobs WHERE campaign_id=$1 AND kind='fund' AND status='confirmed' AND request_key=$2",[id,row.funding_tx])).rowCount)return null;
 const snap=unwrap(await chain.campaign(row.pact_campaign_id));
 if(snap.sponsor!==row.sponsor_account||micros(snap.reward)!==micros(row.reward_kda)||Number(snap.slots)!==row.max_rewards)throw new Error('Contract campaign does not match the database');
 const ended=Date.parse(row.deadline)<=Date.now();
 const settled=micros(snap.funded)===micros(snap.paid)+micros(snap.refunded);
 await db.query('UPDATE task_campaigns SET chain_snapshot=$2,chain_checked_at=now(),status=$3 WHERE id=$1',[id,JSON.stringify(snap),ended?(settled?'settled':'ended'):'open']);
 return snap;
}

export class Worker {
 constructor(db,chain,c) {this.db=db;this.chain=chain;this.c=c;this.busy=false;this.lastSuccess=null;this.lastError=null;}
 async prepareRefunds() {
   const rows=(await this.db.query("SELECT * FROM task_campaigns WHERE status IN ('open','ended') AND deadline<=now() ORDER BY id")).rows;
   for(const campaign of rows) {
     const snap=await syncCampaign(this.db,this.chain,campaign.id);
     const available=micros(snap.funded)-micros(snap.paid)-micros(snap.refunded)-micros(snap.reward)*BigInt(snap['reserved-count']);
     if(available<=0n)continue;
     // Stable key based on cumulative refunded amount; persist command before broadcast.
     const key=`refund:${campaign.id}:${snap.refunded}`;
     const existing=(await this.db.query('SELECT id FROM chain_jobs WHERE dedupe_key=$1',[key])).rows[0];
     if(!existing)await this.db.tx(tx=>enqueue(tx,{key,kind:'refund',campaign:campaign.id,command:this.chain.ops(`(${this.c.module}.refund-unused ${quote(campaign.pact_campaign_id)})`)}));
   }
 }
 async retryMaintenance() {
   // Only conclusive on-chain failures are retried, at most three broadcasts.
   // Unknown/expired transactions remain preserved for reconciliation.
   await this.db.tx(async tx=>{
     const failures=(await tx.query("SELECT * FROM chain_jobs WHERE kind IN ('release','refund') AND status='failed' AND attempts<3 AND confirmed_at<now()-interval '30 seconds' FOR UPDATE SKIP LOCKED")).rows;
     for(const previous of failures) {
       const key=previous.dedupe_key.replace(/:retry:\d+$/,'')+':retry:'+previous.attempts;
       if((await tx.query('SELECT 1 FROM chain_jobs WHERE dedupe_key=$1',[key])).rowCount)continue;
       const body=JSON.parse(previous.command.cmd);
       const next=await enqueue(tx,{key,kind:previous.kind,campaign:previous.campaign_id,submission:previous.submission_id,actor:previous.actor_id,command:this.chain.ops(body.payload.exec.code,body.payload.exec.data)});
       await tx.query('UPDATE chain_jobs SET attempts=$2 WHERE id=$1',[next.id,previous.attempts]);
       await audit(tx,null,'maintenance_retry',previous.kind,next.id,{previous_job:previous.id,attempt:previous.attempts+1});
     }
   });
 }
 async finish(tx,job,result) {
   const ok=result.result.status==='success';
   // A polled result proves at least one attempt, including recovery after a
   // crash between node acceptance and persisting broadcast status.
   const retryIndex=['release','refund'].includes(job.kind)?Number(job.dedupe_key.match(/:retry:(\d+)$/)?.[1]||0):0;
   const minimumAttempts=retryIndex+1;
   await tx.query('UPDATE chain_jobs SET status=$2,result=$3,error=$4,confirmed_at=now(),attempts=greatest(attempts,$5) WHERE id=$1',[job.id,ok?'confirmed':'failed',JSON.stringify(result),ok?null:(result.result.error?.message||'Pact transaction failed'),minimumAttempts]);
   if(!ok) {
     if(job.kind==='fund')await tx.query("UPDATE task_campaigns SET status='funding_failed' WHERE id=$1",[job.campaign_id]);
     if(job.kind==='reserve')await tx.query("UPDATE submissions SET status='reservation_failed',review_note=$2 WHERE id=$1",[job.submission_id,'Escrow reservation failed. Start again while the campaign is open.']);
     if(job.kind==='payout') {
       await tx.query("UPDATE payouts SET status='failed',error=$2 WHERE id=$1",[job.payout_id,result.result.error?.message||'Pact transaction failed']);
       await tx.query("UPDATE submissions SET status='payout_failed' WHERE id=$1",[job.submission_id]);
     }
     await audit(tx,job.actor_id,'chain_failed',job.kind,job.id,{tx:job.request_key,error:result.result.error?.message});
     return;
   }
   if(job.kind==='fund') {
     const c=(await tx.query('SELECT * FROM task_campaigns WHERE id=$1 FOR UPDATE',[job.campaign_id])).rows[0];
     await tx.query("UPDATE task_campaigns SET status='open' WHERE id=$1",[c.id]);
     await tx.query("INSERT INTO campaign_ledger(campaign_id,event_type,amount_kda,tx) VALUES($1,'funded',$2,$3) ON CONFLICT DO NOTHING",[c.id,String(micros(c.reward_kda)*BigInt(c.max_rewards)/1000000n)+'.'+String(micros(c.reward_kda)*BigInt(c.max_rewards)%1000000n).padStart(6,'0'),job.request_key]);
   }
   if(job.kind==='reserve')await tx.query("UPDATE submissions SET status='in_review' WHERE id=$1 AND status='reserving'",[job.submission_id]);
   if(job.kind==='payout') {
     const p=(await tx.query('UPDATE payouts SET status=\'confirmed\',paid_at=now(),error=NULL WHERE id=$1 RETURNING *',[job.payout_id])).rows[0];
     const s=(await tx.query("UPDATE submissions SET status='paid' WHERE id=$1 RETURNING *",[job.submission_id])).rows[0];
     const campaign=(await tx.query('SELECT * FROM task_campaigns WHERE id=$1',[s.campaign_id])).rows[0];
     const pub=publicProof(campaign.proof_schema,s.proof_json,s.public_consent);
     await tx.query('INSERT INTO work_items(submission_id,finding_text,public_links) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[s.id,pub.finding,JSON.stringify(pub.links)]);
     await tx.query("INSERT INTO campaign_ledger(campaign_id,event_type,amount_kda,tx) VALUES($1,'paid',$2,$3) ON CONFLICT DO NOTHING",[s.campaign_id,p.amount_kda,job.request_key]);
   }
   if(job.kind==='refund')await tx.query("INSERT INTO campaign_ledger(campaign_id,event_type,amount_kda,tx) VALUES($1,'refunded',$2,$3) ON CONFLICT DO NOTHING",[job.campaign_id,unwrap(result.result.data),job.request_key]);
   if(job.kind==='pause') {
     const paused=JSON.parse(job.command.cmd).payload.exec.data.paused;
     const pending=(await pauseState(tx,{lock:true})).pending;
     await tx.query("UPDATE settings SET value=$1 WHERE key='payouts_paused'",[JSON.stringify(paused||!!pending)]);
   }
   await audit(tx,job.actor_id,'chain_confirmed',job.kind,job.id,{tx:job.request_key});
 }
 async tick() {
   if(this.busy)return;this.busy=true;
   try {
     await this.db.tx(async tx=>{
       const locked=(await tx.query('SELECT pg_try_advisory_xact_lock(827125) AS ok')).rows[0].ok;
       if(!locked)return;
       // Every transaction that touches the pause gate takes this mutex before
       // domain/job rows. It also serializes acceptance against a money send.
       await pauseState(tx,{lock:true});
       const jobs=(await tx.query("SELECT * FROM chain_jobs WHERE status IN ('prepared','broadcast') ORDER BY created_at LIMIT 50 FOR UPDATE")).rows;
       for(const job of jobs) {
         try {
           // Always poll first: an earlier process may have broadcast then crashed.
           const result=await this.chain.poll(job.request_key);
           if(result) {await this.finish(tx,job,result);continue;}
           const body=JSON.parse(job.command.cmd);
           if(body.meta.creationTime+body.meta.ttl<Math.floor(Date.now()/1000)) {
             // Never replace an unknown transaction with a fresh payout/refund.
             await tx.query('UPDATE chain_jobs SET error=$2 WHERE id=$1',[job.id,'Transaction expired without a conclusive result. Reconciliation required; no automatic replacement.']);
             continue;
           }
           if(job.status==='prepared') {
             if(['setup_install','setup_gas'].includes(job.kind)) {
               if(!this.setupSender)continue;
               await this.setupSender(tx,job);
               await tx.query("UPDATE chain_jobs SET status='broadcast',attempts=attempts+1,error=NULL WHERE id=$1",[job.id]);
               continue;
             }
             const bootstrap=this.c.allowPilotInstall&&(job.kind==='pilot_install'||job.kind==='pilot_gas'&&this.c.allowPilotGas)&&this.c.pilotInstallFamily&&job.dedupe_key.startsWith(this.c.pilotInstallFamily);
             if(!this.c.writes&&!bootstrap)continue;
             if(['fund','reserve','payout'].includes(job.kind)&&(await pauseState(tx)).paused)continue;
             await this.chain.send(job.command);
             await tx.query("UPDATE chain_jobs SET status='broadcast',attempts=attempts+1,error=NULL WHERE id=$1",[job.id]);
           }
         } catch(error) {await tx.query('UPDATE chain_jobs SET error=$2 WHERE id=$1',[job.id,error.message]);}
       }
     });
     if(this.c.writes){await this.retryMaintenance();await this.prepareRefunds();}
     // The AI reviewer runs after chain jobs so its payouts broadcast next tick.
     // Its own errors never stop payments or refunds.
     if(this.agent)try{await this.agent.run();}catch(error){this.agent.lastError=error.message;console.error(JSON.stringify({event:'ai_review_error',error:error.message}));}
     // Before deployment there is no contract to query. Saved transactions are
     // still polled above, including recovery while new writes are disabled.
     if(this.c.module) {
       const campaigns=(await this.db.query("SELECT id FROM task_campaigns WHERE status IN ('funding','open','ended') AND funding_tx IS NOT NULL")).rows;
       for(const c of campaigns) {
         if((await this.db.query("SELECT 1 FROM chain_jobs WHERE campaign_id=$1 AND kind='fund' AND status='confirmed'",[c.id])).rowCount)await syncCampaign(this.db,this.chain,c.id);
       }
       await this.db.tx(async tx=>{
         const pending=(await pauseState(tx,{lock:true})).pending;
         // Read live state under the same mutex as pause acceptance. Otherwise a
         // stale false read could overwrite the stop set by a concurrent request.
         const state=unwrap(await this.chain.state());
         await tx.query("UPDATE settings SET value=$1 WHERE key='payouts_paused'",[JSON.stringify(state.paused||!!pending)]);
       });
     }
     this.lastSuccess=new Date().toISOString();this.lastError=null;
   }catch(error){this.lastError=error.message;console.error(JSON.stringify({event:'worker_error',error:error.message}));}
   finally {this.busy=false;}
 }
 start(){this.timer=setInterval(()=>this.tick(),this.c.workerMs);this.timer.unref();this.tick();}
 stop(){clearInterval(this.timer);}
}
