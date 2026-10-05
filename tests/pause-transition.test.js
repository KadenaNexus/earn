import test from 'node:test';
import assert from 'node:assert/strict';
import { sign,command,hashCommand } from '../src/pact.js';
import { createApp } from '../src/server.js';
import { Worker,enqueue } from '../src/jobs.js';
import { testDatabase,testKey,testConfig,TestChain,client,campaignInput } from './helpers.js';

async function fixture(schema){
 const db=await testDatabase(schema),admin=testKey(),c=testConfig(admin,testKey()),chain=new TestChain(c),worker=new Worker(db,chain,c);
 const {app}=createApp(db,chain,c,worker),server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const owner=await client('http://127.0.0.1:'+server.address().port,admin);
 return {db,admin,c,chain,worker,owner,async close(){await new Promise(r=>server.close(r));await db.close();}};
}
const signedPause=(f,paused)=>sign(command(f.c,`(${f.c.module}.set-global-pause (read-msg "paused"))`,{paused},f.admin.publicKey,[{name:'coin.GAS',args:[]},{name:`${f.c.module}.GOVERNANCE`,args:[]}]),f.admin.seed);

// Two owner-approved commands can arrive from different tabs, so the server
// must serialize them regardless of the browser's local busy state.
test('Distinct concurrent pause commands enqueue once; same signed replay keeps the existing job and audit',async()=>{
 const f=await fixture('ke_pause_acceptance_tests');
 try{
  const first=await f.owner.call('/admin/pause-command',{paused:true}),second=await f.owner.call('/admin/pause-command',{paused:false});
  assert.equal(first.status,200);assert.equal(second.status,200);
  const signed=[sign(first.data.command,f.admin.seed),sign(second.data.command,f.admin.seed)];
  const received=await Promise.all(signed.map((signed_command,i)=>f.owner.call('/admin/pause',{signed_command},{'idempotency-key':'pause-concurrent-'+i})));
  assert.deepEqual(received.map(r=>r.status).sort(),[200,409]);
  const winner=received.findIndex(r=>r.status===200),job=received[winner].data;
  const replay=await f.owner.call('/admin/pause',{signed_command:signed[winner]},{'idempotency-key':'pause-replay-new-key'});
  assert.equal(replay.status,200);assert.equal(replay.data.job_id,job.job_id);assert.equal(replay.data.request_key,job.request_key);
  assert.equal((await f.db.query("SELECT count(*) n FROM chain_jobs WHERE kind='pause'")).rows[0].n,'1');
  assert.equal((await f.db.query("SELECT count(*) n FROM audit_log WHERE action='pause_requested'")).rows[0].n,'1');
  assert.equal((await f.owner.call('/admin/pause-command',{paused:false})).status,409);
  const k=(await f.owner.call('/admin/kpi')).data;assert.equal(k.paused,true);assert.equal(k.pause_pending.request_key,job.request_key);
  let locked,unlock;const jobLocked=new Promise(r=>locked=r),releaseJob=new Promise(r=>unlock=r);
  const holding=f.db.tx(async tx=>{await tx.query('SELECT id FROM chain_jobs WHERE id=$1 FOR UPDATE',[job.job_id]);locked();await releaseJob;});await jobLocked;
  try{
   const replayLocked=await Promise.race([
    f.owner.call('/admin/pause',{signed_command:signed[winner]},{'idempotency-key':'pause-worker-locked-replay'}),
    new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Pause replay waited for a worker-held job lock')),1000);timer.unref();})
   ]);assert.equal(replayLocked.status,200);assert.equal(replayLocked.data.job_id,job.job_id);
  }finally{unlock();await holding;}
  await f.worker.tick();await f.worker.tick();
  const replayConfirmed=await f.owner.call('/admin/pause',{signed_command:signed[winner]},{'idempotency-key':'pause-confirmed-replay'});
  assert.equal(replayConfirmed.data.job_id,job.job_id);assert.equal(replayConfirmed.data.status,'confirmed');
  const lookup=(await f.owner.call('/admin/kpi?pause_request='+job.request_key)).data;assert.equal(lookup.pause_job.request_key,job.request_key);assert.equal(lookup.pause_job.status,'confirmed');
  assert.equal((await f.db.query("SELECT count(*) n FROM audit_log WHERE action='pause_requested'")).rows[0].n,'1');
 }finally{await f.close();}
});

test('Mined but unconfirmed resume with live false holds money APIs and prepared money jobs',async()=>{
 const f=await fixture('ke_pause_resume_depth_tests');
 try{
  const created=(await f.owner.call('/admin/campaigns',campaignInput(),{'idempotency-key':'before-resume-draft'})).data;
  const cid=created.campaign.id,fund=(await f.owner.call('/admin/campaigns/'+cid+'/funding-command',{})).data;
  await f.db.query("UPDATE settings SET value='true' WHERE key='payouts_paused'");f.chain.paused=true;
  const saved=await f.owner.call('/admin/pause',{signed_command:signedPause(f,false)},{'idempotency-key':'delayed-resume-one'});assert.equal(saved.status,200);
  const resumeKey=saved.data.request_key,poll=f.chain.poll.bind(f.chain);let confirmed=false;
  f.chain.poll=key=>key===resumeKey&&!confirmed?Promise.resolve(null):poll(key);
  for(const [i,kind] of ['fund','reserve','payout'].entries())await f.db.tx(tx=>enqueue(tx,{key:'money-held-'+kind,kind,command:f.chain.ops(`(+ ${i} ${i})`)}));
  await f.worker.tick();await f.worker.tick();
  assert.equal(f.chain.paused,false,'The live node can show resume before confirmation depth');assert.equal(f.chain.sends,1,'Only the owner resume was sent');
  const held=(await f.db.query("SELECT status FROM chain_jobs WHERE dedupe_key LIKE 'money-held-%'")).rows;assert.equal(held.length,3);assert.ok(held.every(j=>j.status==='prepared'));
  // Even if old/stale application state says false, the pending job is a gate.
  await f.db.query("UPDATE settings SET value='false' WHERE key='payouts_paused'");
  const requests=await Promise.all([
   f.owner.call('/admin/campaigns',campaignInput(),{'idempotency-key':'while-resume-create'}),
   f.owner.call('/tasks/'+cid+'/start',{}),
   f.owner.call('/tasks/'+cid+'/submit',{proof:{finding:'A sufficient finding for the pause API gate test.',private_link:'https://example.com/evidence'},public_consent:true}),
   f.owner.call('/admin/campaigns/'+cid+'/funding-command',{}),
   f.owner.call('/admin/campaigns/'+cid+'/confirm-funding',{signed_command:sign(fund.command,f.admin.seed)},{'idempotency-key':'while-resume-fund'}),
   f.owner.call('/admin/payouts/1/send',{},{'idempotency-key':'while-resume-send'})
  ]);assert.ok(requests.every(r=>r.status===409),JSON.stringify(requests));
  const k=(await f.owner.call('/admin/kpi')).data;assert.equal(k.paused,true);assert.equal(k.pause_pending.request_key,resumeKey);
  await f.worker.tick();assert.equal(f.chain.sends,1);assert.equal((await f.db.query("SELECT value FROM settings WHERE key='payouts_paused'")).rows[0].value,true);
  // Remove dummy jobs before releasing the gate: they intentionally have no
  // campaign/submission rows and exist solely to observe broadcast exclusion.
  await f.db.query("DELETE FROM chain_jobs WHERE dedupe_key LIKE 'money-held-%'");confirmed=true;await f.worker.tick();
  const settled=(await f.owner.call('/admin/kpi')).data;assert.equal(settled.paused,false);assert.equal(settled.pause_pending,null);
  assert.equal((await f.owner.call('/admin/campaigns',campaignInput(),{'idempotency-key':'after-resume-create'})).status,200);
 }finally{await f.close();}
});

test('Legacy multiple resumes stay stopped when the first confirms and the second remains unknown',async()=>{
 const f=await fixture('ke_pause_legacy_tests');
 try{
  const first=signedPause(f,false),second=signedPause(f,false);
  await f.db.tx(async tx=>{await enqueue(tx,{key:'pause:'+first.hash,kind:'pause',command:first});await enqueue(tx,{key:'pause:'+second.hash,kind:'pause',command:second});});
  f.chain.results.set(first.hash,{reqKey:first.hash,result:{status:'success',data:true},metaData:{blockHeight:1}});f.chain.unknown=true;
  await f.worker.tick();
  assert.equal((await f.db.query('SELECT status FROM chain_jobs WHERE request_key=$1',[first.hash])).rows[0].status,'confirmed');
  assert.equal((await f.db.query('SELECT status FROM chain_jobs WHERE request_key=$1',[second.hash])).rows[0].status,'broadcast');
  assert.equal((await f.owner.call('/admin/kpi')).data.paused,true);
  assert.equal((await f.owner.call('/admin/campaigns',campaignInput(),{'idempotency-key':'legacy-held-create'})).status,409);
 }finally{await f.close();}
});

test('Pause acceptance cannot be overwritten by a concurrent stale state synchronization',async()=>{
 const f=await fixture('ke_pause_sync_race_tests');
 try{
  let release,entered;const enteredState=new Promise(r=>entered=r),releaseState=new Promise(r=>release=r);
  f.chain.state=async()=>{entered();await releaseState;return {paused:false};};
  const ticking=f.worker.tick();await enteredState;
  let attempted;const mutexAttempted=new Promise(r=>attempted=r),originalTx=f.db.tx;
  f.db.tx=fn=>originalTx(tx=>fn({query:(sql,args)=>{if(sql==="SELECT value FROM settings WHERE key='payouts_paused' FOR UPDATE")attempted();return tx.query(sql,args);}}));
  const submitting=f.owner.call('/admin/pause',{signed_command:signedPause(f,true)},{'idempotency-key':'sync-race-pause'});
  await Promise.race([mutexAttempted,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Pause acceptance did not use the synchronization mutex')),1000);timer.unref();})]);
  release();await ticking;const saved=await submitting;assert.equal(saved.status,200);
  assert.equal((await f.db.query("SELECT value FROM settings WHERE key='payouts_paused'")).rows[0].value,true);
  assert.equal((await f.owner.call('/admin/kpi')).data.pause_pending.request_key,saved.data.request_key);
 }finally{await f.close();}
});


test('Pause acceptance serializes against an in-flight money broadcast without setting/domain lock inversion',async()=>{
 const f=await fixture('ke_pause_broadcast_race_tests');let release;
 try{
  const money=f.chain.ops('(+ 1 1)');await f.db.tx(tx=>enqueue(tx,{key:'in-flight-fund',kind:'fund',command:money}));
  let entered,attempted;const sending=new Promise(r=>entered=r),sendAllowed=new Promise(r=>release=r),pauseAttempted=new Promise(r=>attempted=r);
  const send=f.chain.send.bind(f.chain);f.chain.send=async tx=>{entered();await sendAllowed;return send(tx);};
  const ticking=f.worker.tick();await sending;
  const originalTx=f.db.tx;f.db.tx=fn=>originalTx(tx=>fn({query:(sql,args)=>{if(sql==="SELECT value FROM settings WHERE key='payouts_paused' FOR UPDATE")attempted();return tx.query(sql,args);}}));
  let accepted=false;const submitting=f.owner.call('/admin/pause',{signed_command:signedPause(f,true)},{'idempotency-key':'during-money-broadcast'}).then(r=>{accepted=true;return r;});
  await pauseAttempted;
  // A second independent connection cannot acquire the mutex while the worker
  // is broadcasting. NOWAIT makes this a database assertion, not a timing sleep.
  await assert.rejects(()=>originalTx(tx=>tx.query("SELECT value FROM settings WHERE key='payouts_paused' FOR UPDATE NOWAIT")),e=>e.code==='55P03');
  assert.equal(accepted,false);release();await ticking;const saved=await submitting;assert.equal(saved.status,200);
  assert.equal(f.chain.sends,1);assert.equal((await f.owner.call('/admin/kpi')).data.paused,true);
  assert.equal((await f.db.query('SELECT status FROM chain_jobs WHERE request_key=$1',[money.hash])).rows[0].status,'broadcast');
  await f.db.query('DELETE FROM chain_jobs WHERE request_key=$1',[money.hash]);
  const later=f.chain.ops('(+ 2 2)');await f.db.tx(tx=>enqueue(tx,{key:'after-pause-accepted',kind:'fund',command:later}));
  await f.worker.tick();assert.equal(f.chain.sends,2,'Only the owner pause broadcasts after it is accepted');
  assert.equal((await f.db.query('SELECT status FROM chain_jobs WHERE request_key=$1',[later.hash])).rows[0].status,'prepared');
 }finally{release?.();await f.close();}
});


test('Expired signed pause is rejected before enqueue; expired unknown legacy pause keeps the gate closed',async()=>{
 const f=await fixture('ke_pause_expiry_tests');
 try{
  const original=signedPause(f,false),body=JSON.parse(original.cmd);body.meta.creationTime=Math.floor(Date.now()/1000)-1000;
  const cmd=JSON.stringify(body),expired=sign({...original,cmd,hash:hashCommand(cmd)},f.admin.seed);
  const received=await f.owner.call('/admin/pause',{signed_command:expired},{'idempotency-key':'expired-pause-no-enqueue'});
  assert.equal(received.status,400);assert.match(received.data.error,/expired/i);
  assert.equal((await f.db.query("SELECT count(*) n FROM chain_jobs WHERE kind='pause'")).rows[0].n,'0');
  assert.equal((await f.db.query("SELECT value FROM settings WHERE key='payouts_paused'")).rows[0].value,false);
  await f.db.tx(tx=>enqueue(tx,{key:'pause:'+expired.hash,kind:'pause',command:expired}));
  await f.worker.tick();assert.equal(f.chain.sends,0);
  const held=(await f.db.query('SELECT status,error FROM chain_jobs WHERE request_key=$1',[expired.hash])).rows[0];
  assert.equal(held.status,'prepared');assert.match(held.error,/expired.*no automatic replacement/i);
  const k=(await f.owner.call('/admin/kpi')).data;assert.equal(k.paused,true);assert.equal(k.pause_pending.request_key,expired.hash);
  const replay=await f.owner.call('/admin/pause',{signed_command:expired},{'idempotency-key':'expired-existing-replay'});
  assert.equal(replay.status,200);assert.equal(replay.data.request_key,expired.hash);
  assert.equal((await f.owner.call('/admin/pause-command',{paused:false})).status,409);
  await f.worker.tick();assert.equal(f.chain.sends,0);
 }finally{await f.close();}
});

test('Worker owns pause mutex before payout reconciliation locks domain rows',async()=>{
 const f=await fixture('ke_pause_domain_order_tests');let release;
 try{
  const cid=(await f.owner.call('/admin/campaigns',campaignInput(),{'idempotency-key':'domain-order-create'})).data.campaign.id;
  const funding=(await f.owner.call('/admin/campaigns/'+cid+'/funding-command',{})).data;
  await f.owner.call('/admin/campaigns/'+cid+'/confirm-funding',{signed_command:sign(funding.command,f.admin.seed)},{'idempotency-key':'domain-order-fund'});
  await f.worker.tick();await f.worker.tick();await f.owner.call('/tasks/'+cid+'/start',{});
  const sub=(await f.owner.call('/tasks/'+cid+'/submit',{proof:{finding:'A detailed finding to create a real API payout for lock ordering.',private_link:'https://example.com/evidence'},public_consent:true})).data;
  await f.worker.tick();await f.worker.tick();await f.owner.call('/submissions/'+sub.id+'/approve',{});
  const payout=(await f.owner.call('/admin/payouts')).data[0];
  await f.owner.call('/admin/payouts/'+payout.id+'/send',{},{'idempotency-key':'domain-order-send'});await f.worker.tick();
  const later=f.chain.ops('(+ 3 3)');await f.db.tx(tx=>enqueue(tx,{key:'later-money-after-finish',kind:'fund',command:later}));
  let entered,attempted;const reconciling=new Promise(r=>entered=r),finishAllowed=new Promise(r=>release=r),apiMutex=new Promise(r=>attempted=r);
  const originalTx=f.db.tx;let atReconciliation=false;
  f.db.tx=fn=>originalTx(tx=>fn({query:async(sql,args)=>{
   if(atReconciliation&&sql==="SELECT value FROM settings WHERE key='payouts_paused' FOR UPDATE")attempted();
   const result=await tx.query(sql,args);
   if(sql.startsWith("UPDATE payouts SET status='confirmed'")){atReconciliation=true;entered();await finishAllowed;}
   return result;
  }}));
  const ticking=f.worker.tick();await reconciling;
  // This check runs before the competing API can take any mutex, proving the
  // worker acquired settings before UPDATE payouts held that domain row.
  await assert.rejects(()=>originalTx(tx=>tx.query("SELECT value FROM settings WHERE key='payouts_paused' FOR UPDATE NOWAIT")),e=>e.code==='55P03');
  let settled=false;const replay=f.owner.call('/admin/payouts/'+payout.id+'/send',{},{'idempotency-key':'domain-order-replay'}).then(r=>{settled=true;return r;});
  await apiMutex;assert.equal(settled,false);release();await ticking;
  const result=await replay;assert.equal(result.status,200);assert.equal(result.data.status,'confirmed');
  assert.equal((await f.db.query('SELECT status FROM payouts WHERE id=$1',[payout.id])).rows[0].status,'confirmed');
  assert.equal((await f.db.query('SELECT status FROM chain_jobs WHERE request_key=$1',[later.hash])).rows[0].status,'broadcast');
 }finally{release?.();await f.close();}
});
