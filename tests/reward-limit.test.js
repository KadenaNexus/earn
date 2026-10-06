import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { campaignSchema, rewardSchema, maxTaskRewardKda } from '../src/validation.js';
import { createApp } from '../src/server.js';
import { command, quote, sign } from '../src/pact.js';
import { testDatabase, testKey, TestChain, client, campaignInput } from './helpers.js';

test('Each task reward is bounded at exactly 5,000 KDA with six-decimal precision',()=>{
  assert.equal(maxTaskRewardKda,'5000');
  for(const value of ['0.000001','4999.999999','5000','5000.000000',5000])assert.equal(rewardSchema.parse(value),String(value));
  for(const value of ['0','-1','5000.000001','5001','100000','0.0000001','5000.0000000','1e3','Infinity','NaN'])assert.equal(rewardSchema.safeParse(value).success,false,value);
  assert.equal(campaignSchema.parse({...campaignInput(),reward_kda:'5000',max_rewards:10000}).max_rewards,10000,'No separate pool cap');
  assert.equal(campaignSchema.safeParse({...campaignInput(),max_rewards:10001}).success,false,'Existing slot bound remains');
});

test('Mainnet campaign creation and funding accept larger pools and reject rewards above 5,000 KDA',async()=>{
  const db=await testDatabase('ke_reward_limit_tests'),ownerKey=testKey(),opsKey=testKey();
  const c=config({DATABASE_URL:db.url,ADMIN_ACCOUNT:ownerKey.account,KADENA_NETWORK_ID:'mainnet01',PACT_MODULE:'n_rewards.kadena-earn',ENABLE_CHAIN_WRITES:'true',CONTRACT_REVIEW_CONFIRMED:'true',OPS_PUBLIC_KEY:opsKey.publicKey,OPS_SECRET_KEY:opsKey.seed,OPS_ACCOUNT:opsKey.account,PILOT_MAX_POOL_KDA:'0.3'});
  // The mainnet application rules run against an isolated deterministic node
  // transport. Preparing these boundary commands never transfers real KDA.
  const chain=new TestChain(c),{app}=createApp(db,chain,c),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const owner=await client('http://127.0.0.1:'+server.address().port,ownerKey);
    const limits=(await owner.call('/config')).data;
    assert.equal(limits.task_reward_cap_kda,'5000');assert.equal(limits.campaign_pool_cap_kda,null);
    const created=await owner.call('/admin/campaigns',{...campaignInput(),reward_kda:'5000',max_rewards:3},{'idempotency-key':'reward-boundary-5000'});
    assert.equal(created.status,200);const cid=created.data.campaign.id;
    const preparation=await owner.call(`/admin/campaigns/${cid}/funding-command`,{});assert.equal(preparation.status,200);
    const body=JSON.parse(preparation.data.command.cmd);
    assert.match(body.payload.exec.code,/5000\.000000 3/);
    assert.deepEqual(body.signers[0].clist.find(cap=>cap.name==='coin.TRANSFER').args,[c.admin,'n_rewards-kadena-earn-escrow',15000]);
    const large=await owner.call('/admin/campaigns',{...campaignInput(),reward_kda:'5000',max_rewards:10000},{'idempotency-key':'reward-boundary-large-pool'});
    assert.equal(large.status,200);
    const largePlan=(await owner.call(`/admin/campaigns/${large.data.campaign.id}/funding-command`,{})).data;
    assert.equal(JSON.parse(largePlan.command.cmd).signers[0].clist.find(cap=>cap.name==='coin.TRANSFER').args[2],50000000);
    for(const [index,reward] of ['5000.000001','5001'].entries()) {
      const response=await owner.call('/admin/campaigns',{...campaignInput(),reward_kda:reward},{'idempotency-key':'reward-boundary-invalid-'+index});
      assert.equal(response.status,400);assert.match(response.data.error,/5,000 KDA/);
    }
    // Previously saved drafts cannot bypass the new per-task reward cap by
    // requesting or submitting a funding command directly.
    await db.query('UPDATE task_campaigns SET reward_kda=5001 WHERE id=$1',[cid]);
    assert.equal((await owner.call(`/admin/campaigns/${cid}/funding-command`,{})).status,400);
    const row=(await db.query('SELECT * FROM task_campaigns WHERE id=$1',[cid])).rows[0];
    const code=`(${c.module}.create-and-fund ${quote(row.pact_campaign_id)} ${quote(c.admin)} 5001.000000 3 (time ${quote(new Date(row.deadline).toISOString().replace(/\.\d{3}Z$/,'Z'))}))`;
    const signed=sign(command(c,code,{'recipient-keyset':{keys:[ownerKey.publicKey],pred:'keys-all'}},ownerKey.publicKey),ownerKey.seed);
    const rejected=await owner.call(`/admin/campaigns/${cid}/confirm-funding`,{signed_command:signed},{'idempotency-key':'reward-boundary-legacy-draft'});
    assert.equal(rejected.status,400);assert.match(rejected.data.error,/5,000 KDA/);
    assert.equal((await db.query('SELECT count(*) n FROM chain_jobs')).rows[0].n,'0');assert.equal(chain.sends,0);
  } finally {await new Promise(resolve=>server.close(resolve));await db.close();}
});
