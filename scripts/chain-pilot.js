import assert from 'node:assert/strict';
import { writeFile,mkdir } from 'node:fs/promises';
import { config } from '../src/config.js';
import { Chain,command,sign,quote } from '../src/pact.js';
import { Worker,unwrap } from '../src/jobs.js';
import { createApp } from '../src/server.js';
import { deploymentPlan } from '../src/deployment.js';
import { testDatabase,testKey,client,campaignInput } from '../tests/helpers.js';

if(process.env.KADENA_NETWORK_ID!=='development'||!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.KADENA_NODE_URL||''))throw new Error('This test only runs against a local development Chainweb node');
const ownerKey=testKey(),opsKey=testKey(),contributors=[testKey(),testKey(),testKey()];
const c=config({...process.env,NODE_ENV:'test',ADMIN_ACCOUNT:ownerKey.account,OPS_PUBLIC_KEY:opsKey.publicKey,OPS_SECRET_KEY:opsKey.seed,OPS_ACCOUNT:opsKey.account,ENABLE_CHAIN_WRITES:'true',CONFIRMATION_DEPTH:'1'});
const chain=new Chain(c),db=await testDatabase('ke_chain_pilot');
c.database=db.url;
let server;
const proofKeys=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function confirmed(tx) {
  await chain.send(tx);
  for(let i=0;i<90;i++){const result=await chain.poll(tx.hash);if(result){assert.equal(result.result.status,'success',JSON.stringify(result.result));return result;}await wait(1000);}
  throw new Error('Local Chainweb transaction timed out: '+tx.hash);
}
async function settleJobs() {
  for(let i=0;i<90;i++){
    await worker.tick();const jobs=(await db.query("SELECT kind,status,error,request_key FROM chain_jobs WHERE status IN ('prepared','broadcast','failed')")).rows;
    const failure=jobs.find(j=>j.status==='failed');if(failure)throw new Error(JSON.stringify(failure));
    if(!jobs.length)return;await wait(1000);
  }throw new Error('Local jobs did not settle');
}
const minerPublic='f89ef46927f506c70b6a58fd322450a936311dc6ac91f4ec3d8ef949608dbf1f';
// Public fixture key shipped in the official Kadena devnet repository. Never mainnet.
const minerSecret='da81490c7efd5a95398a3846fa57fd17339bdf1b941d102f2d3217ad29785ff0';
const minerAccount='k:'+minerPublic;
let worker;
try{
  console.log('Funding two local fixture accounts from devnet mining rewards…');
  for(const key of [ownerKey,opsKey]) {
    const code=`(coin.transfer-create ${quote(minerAccount)} ${quote(key.account)} (read-keyset "recipient") 5.0)`;
    await confirmed(sign(command(c,code,{recipient:{keys:[key.publicKey],pred:'keys-all'}},minerPublic,[{name:'coin.GAS',args:[]},{name:'coin.TRANSFER',args:[minerAccount,key.account,5]}],minerAccount),minerSecret));
  }
  const plan=await deploymentPlan(c,chain);c.module=plan.module;
  const deploy=plan.command;
  console.log('Deploying escrow to the mined local chain…');const deployment=await confirmed(sign(deploy,ownerKey.seed));
  worker=new Worker(db,chain,c);const {app}=createApp(db,chain,c,worker);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base='http://127.0.0.1:'+server.address().port,owner=await client(base,ownerKey),users=await Promise.all(contributors.map(key=>client(base,key)));
  const input={...campaignInput(),max_rewards:4,deadline:new Date(Date.now()+180000).toISOString()};
  const created=await owner.call('/admin/campaigns',input,{'idempotency-key':'local-chain-create'});assert.equal(created.status,200,JSON.stringify(created.data));const cid=created.data.campaign.id;
  const fund=(await owner.call('/admin/campaigns/'+cid+'/funding-command',{})).data;
  const funding=await owner.call('/admin/campaigns/'+cid+'/confirm-funding',{signed_command:sign(fund.command,ownerKey.seed)},{'idempotency-key':'local-chain-fund'});assert.equal(funding.status,200,JSON.stringify(funding.data));
  await settleJobs();assert.equal((await users[0].call('/tasks')).data.length,1);
  console.log('Submitting proof from three independently signed local wallets…');
  for(let i=0;i<3;i++) {
    assert.equal((await users[i].call('/tasks/'+cid+'/start',{})).status,200);
    const submission=await users[i].call('/tasks/'+cid+'/submit',{proof:{finding:`Local contributor ${i+1}: the funded campaign workflow completed correctly.`,private_link:'https://private.example/proof-'+i},public_consent:true});
    assert.equal(submission.status,200,JSON.stringify(submission.data));proofKeys.push(submission.data.id);
  }
  await settleJobs();assert.equal((await owner.call('/reviewer/submissions')).data.length,3);
  console.log('Testing owner pause and operations authorization on chain…');
  const pause=(await owner.call('/admin/pause-command',{paused:true})).data;
  await owner.call('/admin/pause',{signed_command:sign(pause.command,ownerKey.seed)},{'idempotency-key':'local-pause'});await settleJobs();
  assert.equal(unwrap(await chain.state()).paused,true);
  const illegal=chain.ops(`(${c.module}.set-global-pause false)`);await chain.send(illegal);
  for(let i=0;i<90;i++){const result=await chain.poll(illegal.hash);if(result){assert.equal(result.result.status,'failure');break;}await wait(1000);}
  const resume=(await owner.call('/admin/pause-command',{paused:false})).data;
  await owner.call('/admin/pause',{signed_command:sign(resume.command,ownerKey.seed)},{'idempotency-key':'local-resume'});await settleJobs();
  for(const sid of proofKeys)assert.equal((await owner.call('/submissions/'+sid+'/approve',{})).status,200);
  const payouts=(await owner.call('/admin/payouts')).data;
  console.log('Waiting for deadline: refunding the unused slot while keeping three approved rewards reserved…');
  while(Date.now()<Date.parse(input.deadline)+2500)await wait(1000);
  await worker.tick();await settleJobs();await worker.tick();
  console.log('Sending three real 0.1 KDA escrow payouts after the campaign deadline…');
  assert.equal((await owner.call('/admin/payouts/send-all',{},{'idempotency-key':'local-send-all'})).status,200);await settleJobs();
  for(const key of contributors)assert.equal(unwrap(await chain.local(`(coin.get-balance ${quote(key.account)})`)),0.1);
  assert.equal((await owner.call('/work')).data.length,3);assert.equal(JSON.stringify((await owner.call('/work')).data).includes('private.example'),false);
  const campaign=(await db.query('SELECT * FROM task_campaigns WHERE id=$1',[cid])).rows[0];
  const duplicate=chain.ops(`(${c.module}.pay-reward ${quote(campaign.pact_campaign_id)} ${quote(proofKeys[0])} ${quote(contributors[0].account)})`,{'recipient-keyset':{keys:[contributors[0].publicKey],pred:'keys-all'}});
  await chain.send(duplicate);let duplicateResult;
  for(let i=0;i<90;i++){duplicateResult=await chain.poll(duplicate.hash);if(duplicateResult)break;await wait(1000);}assert.equal(duplicateResult?.result.status,'failure');
  await worker.tick();
  const snapshot=unwrap(await chain.campaign(campaign.pact_campaign_id));assert.equal(snapshot.refunded,0.1);assert.equal(snapshot.paid,0.3);assert.equal(snapshot['paid-count'],3);
  assert.equal(unwrap(await chain.local(`(coin.get-balance ${quote(c.module.replace('.','-')+'-escrow')})`)),0);
  assert.equal((await owner.call('/stats')).data.paid_submissions,'3');
  const report={network:c.network,chain:c.chain,module:c.module,deployment_tx:deployment.reqKey||deploy.hash,campaign_id:campaign.pact_campaign_id,funding_tx:fund.command.hash,payout_txs:payouts.map(p=>p.id),snapshot,duplicate_tx:duplicate.hash,duplicate_status:duplicateResult.result.status,generated_at:new Date().toISOString()};
  report.payout_txs=(await owner.call('/admin/payouts')).data.map(p=>p.request_key);report.refund_tx=(await db.query("SELECT tx FROM campaign_ledger WHERE event_type='refunded'")).rows[0]?.tx;
  await mkdir(new URL('../output/verification/',import.meta.url),{recursive:true});await writeFile(new URL('../output/verification/local-chain-pilot.json',import.meta.url),JSON.stringify(report,null,2));
  await mkdir(new URL('../.local/',import.meta.url),{recursive:true});await writeFile(new URL('../.local/pilot-keys.json',import.meta.url),JSON.stringify({ownerKey,opsKey,contributors,c},null,2),{mode:0o600});
  console.log('Local Chainweb pilot passed: 3 confirmed payouts, duplicate blocked, automatic refund confirmed.');
}finally{if(server)await new Promise(r=>server.close(r));await db.close();}
