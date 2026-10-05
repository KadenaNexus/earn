import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, micros, command } from '../src/pact.js';
import { config } from '../src/config.js';
import { publicProof } from '../src/validation.js';
import { EckoWallet } from '../public/wallet.js';
import { createApp } from '../src/server.js';
import { Worker } from '../src/jobs.js';
import { testDatabase,testKey,testConfig,TestChain,client,campaignInput } from './helpers.js';

test('Exact amounts, private fields and Ecko command binding',async()=>{
 assert.equal(micros('0.1')*3n,300000n);assert.throws(()=>micros('1e3'));assert.throws(()=>micros('0.0000001'));
 const schema=campaignInput().proof_schema;
 assert.deepEqual(publicProof(schema,{finding:'Public finding',private_link:'https://secret.example'},true),{finding:'Public finding',links:[]});
 assert.equal(publicProof(schema,{finding:'Secret'},false).finding,'Contributor completed this task. Proof is private.');
 const key=testKey(),ops=testKey(),c=testConfig(key,ops);const tx=command(c,'(+ 1 1)',{},key.publicKey,[]);
 const calls=[];const wallet=new EckoWallet({isKadena:true,request:async request=>{calls.push(request);if(request.method==='kda_connect')return {status:'success'};if(request.method==='kda_checkStatus')return {status:'success',account:{account:key.account,publicKey:key.publicKey}};const signed=sign(tx,key.seed);return {status:'success',responses:[{outcome:{result:'success',hash:tx.hash},commandSigData:{cmd:tx.cmd,sigs:[{pubKey:key.publicKey,sig:signed.sigs[0].sig}]}}]};}});
 assert.equal(await wallet.connect('development'),key.account);assert.deepEqual(await wallet.sign(tx),sign(tx,key.seed));assert.equal(calls.at(-1).data.commandSigDatas[0].cmd,tx.cmd);
 const insecure={...c,network:'mainnet01'};
 assert.throws(()=>config({DATABASE_URL:'postgres://x',KADENA_NETWORK_ID:'mainnet01',ENABLE_CHAIN_WRITES:'true'}),/REVIEW/);
});

test('Complete API workflow: authentication, concurrency, review, payout, privacy, recovery and refunds',async()=>{
 const db=await testDatabase('ke_api_tests'),adminKey=testKey(),opsKey=testKey(),c=testConfig(adminKey,opsKey),chain=new TestChain(c),worker=new Worker(db,chain,c);
 const {app}=createApp(db,chain,c,worker);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
 const owner=await client(base,adminKey),users=await Promise.all([1,2,3,4].map(()=>client(base,testKey())));
 assert.equal((await users[0].call('/admin/campaigns')).status,403);
 assert.equal((await owner.raw('/auth/verify',{account:adminKey.account,nonce:owner.nonce.data.nonce,signed_command:sign(owner.nonce.data.command,adminKey.seed)})).status,401);
 const challenge=await owner.raw('/auth/nonce',{account:adminKey.account});const changed=command(c,'(coin.transfer "evil" "thief" 1.0)',{},adminKey.publicKey,[]);
 assert.equal((await owner.raw('/auth/verify',{account:adminKey.account,nonce:challenge.data.nonce,signed_command:sign(changed,adminKey.seed)})).status,401);
 assert.equal((await owner.call('/admin/campaigns',campaignInput(),{'x-csrf-token':'bad','idempotency-key':'csrf-test-key'})).status,403);
 assert.equal((await owner.call('/admin/campaigns',campaignInput(),{origin:'https://evil.example','idempotency-key':'origin-test-key'})).status,403);
 const input=campaignInput();const created=await owner.call('/admin/campaigns',input,{'idempotency-key':'create-pilot-1'});assert.equal(created.status,200);const cid=created.data.campaign.id;
 assert.equal((await owner.call('/admin/campaigns',input,{'idempotency-key':'create-pilot-1'})).data.campaign.id,cid);
 assert.equal((await owner.call('/tasks')).data.length,0);
 const funding=(await owner.call('/admin/campaigns/'+cid+'/funding-command',{})).data;
 const signed=sign(funding.command,adminKey.seed);
 assert.equal((await owner.call('/admin/campaigns/'+cid+'/confirm-funding',{signed_command:signed},{'idempotency-key':'fund-pilot-1'})).status,200);
 await worker.tick();
 // The node already exposes the campaign via /local, but the funding job is
 // still broadcast. A public detail read must not open it before confirmation.
 assert.equal((await users[0].call('/tasks/'+cid)).data.status,'funding');
 assert.equal((await users[0].call('/tasks')).data.length,0);
 assert.equal((await users[0].call('/tasks/'+cid+'/start',{})).status,409);
 await worker.tick();assert.equal((await users[0].call('/tasks')).data.length,1);
 // Campaign row locking must allow only three simultaneous starts.
 const starts=await Promise.all(users.map(u=>u.call('/tasks/'+cid+'/start',{})));assert.equal(starts.filter(s=>s.status===200).length,3);assert.equal(starts.filter(s=>s.status===409).length,1);
 const participants=users.filter((u,i)=>starts[i].status===200);
 const proof={finding:'<img src=x onerror=alert(1)> A detailed finding from the local pilot.',private_link:'https://private.example/secret-screenshot'};
 const submissions=[];for(const u of participants){const r=await u.call('/tasks/'+cid+'/submit',{proof,public_consent:true});assert.equal(r.status,200);submissions.push(r.data);}
 assert.equal((await owner.call('/reviewer/submissions')).data.length,0);await worker.tick();await worker.tick();assert.equal((await owner.call('/reviewer/submissions')).data.length,3);
 assert.equal((await owner.call('/submissions/'+submissions[1].id+'/request-changes',{note:'Please add more detail'})).status,200);
 assert.equal((await owner.call('/submissions/'+submissions[1].id+'/approve',{})).status,409);
 assert.equal((await participants[1].call('/tasks/'+cid+'/submit',{proof,public_consent:true})).status,200);
 assert.equal((await owner.call('/submissions/'+submissions[2].id+'/reject',{note:'Insufficient supporting proof'})).status,200);
 for(const s of submissions.slice(0,2))assert.equal((await owner.call('/submissions/'+s.id+'/approve',{})).status,200);
 assert.equal((await owner.call('/submissions/'+submissions[0].id+'/approve',{})).status,409);
 const payouts=(await owner.call('/admin/payouts')).data;const payout=payouts.find(p=>p.sub===submissions[0].id),other=payouts.find(p=>p.sub===submissions[1].id);
 // Two concurrent sends must persist one command, even with different idempotency keys.
 const sent=await Promise.all(['send-key-one','send-key-two'].map(k=>owner.call('/admin/payouts/'+payout.id+'/send',{},{'idempotency-key':k})));assert.equal(sent[0].data.request_key,sent[1].data.request_key);
 await worker.tick();await worker.tick();assert.equal((await participants[0].call('/me/tasks')).data[0].s,'paid');
 const work=(await owner.call('/work')).data;assert.equal(work.length,1);assert.equal(JSON.stringify(work).includes('secret-screenshot'),false);assert.equal(work[0].f,proof.finding);
 assert.equal((await owner.call('/leaderboard')).data[0].done,'1');assert.equal((await owner.call('/stats')).data.paid_submissions,'1');
 // A conclusively failed payout may retry, and reconciliation confirms the new command.
 chain.failNext=true;await owner.call('/admin/payouts/'+other.id+'/send',{},{'idempotency-key':'send-failing-one'});await worker.tick();await worker.tick();
 assert.equal((await owner.call('/admin/payouts')).data.find(p=>p.id===other.id).status,'failed');
 assert.equal((await owner.call('/admin/payouts/'+other.id+'/retry',{},{'idempotency-key':'retry-failing-one'})).status,200);await worker.tick();await worker.tick();
 assert.equal((await owner.call('/stats')).data.paid_submissions,'2');
 // Sign the emergency pause with the owner, then verify both API and worker gate.
 const pause=(await owner.call('/admin/pause-command',{paused:true})).data;await owner.call('/admin/pause',{signed_command:sign(pause.command,adminKey.seed)},{'idempotency-key':'pause-one'});
 assert.equal((await owner.call('/admin/campaigns',campaignInput(),{'idempotency-key':'paused-create'})).status,409);await worker.tick();await worker.tick();assert.equal(chain.paused,true);
 const resume=(await owner.call('/admin/pause-command',{paused:false})).data;await owner.call('/admin/pause',{signed_command:sign(resume.command,adminKey.seed)},{'idempotency-key':'resume-one'});await worker.tick();await worker.tick();
 await db.query("UPDATE task_campaigns SET deadline=now()-interval '1 second' WHERE id=$1",[cid]);await worker.tick();await worker.tick();await worker.tick();
 assert.equal((await owner.call('/admin/campaigns')).data[0].status,'settled');assert.equal(chain.campaigns.values().next().value.refunded,'0.100000');
 assert.equal((await db.query('SELECT count(*) n FROM campaign_ledger WHERE event_type=\'paid\'')).rows[0].n,'2');assert.ok((await db.query('SELECT count(*) n FROM audit_log')).rows[0].n>15);
 // Unknown results are never retried with a new payout command.
 const count=chain.sends;await worker.tick();assert.equal(chain.sends,count);
 // Retry maintenance only after a conclusive failure; preserve the attempt ceiling.
 const refundJob=(await db.query("SELECT * FROM chain_jobs WHERE kind='refund' LIMIT 1")).rows[0];
 await db.query("UPDATE chain_jobs SET status='failed',attempts=1,confirmed_at=now()-interval '60 seconds' WHERE id=$1",[refundJob.id]);
 await worker.retryMaintenance();await worker.retryMaintenance();
 assert.equal((await db.query("SELECT count(*) n FROM chain_jobs WHERE kind='refund' AND dedupe_key LIKE '%:retry:%'")).rows[0].n,'1');
 }finally{await new Promise(r=>server.close(r));await db.close();}
});
