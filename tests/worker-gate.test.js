import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,enqueue} from '../src/jobs.js';
import {config} from '../src/config.js';
import {testDatabase,testKey,testConfig,TestChain} from './helpers.js';

test('Disabled application holds queued money jobs and allows only its own pilot installation family',async()=>{
 const db=await testDatabase('ke_worker_gate_tests'),base=testConfig(testKey(),testKey()),chain=new TestChain(base);
 const c={...base,writes:false,allowPilotInstall:false,pilotInstallFamily:'pilot-install:current:'},worker=new Worker(db,chain,c);
 try{
  const payout=chain.ops('(+ 1 1)'),foreign=chain.ops('(+ 2 2)'),own=chain.ops('(+ 3 3)');
  await db.tx(tx=>enqueue(tx,{key:'held-payout',kind:'payout',command:payout}));
  await db.tx(tx=>enqueue(tx,{key:'pilot-install:foreign:0',kind:'pilot_install',command:foreign}));
  await db.tx(tx=>enqueue(tx,{key:'pilot-install:current:0',kind:'pilot_install',command:own}));
  await worker.tick();assert.equal(chain.sends,0,'Read-only worker cannot broadcast');
  c.allowPilotInstall=true;await worker.tick();assert.equal(chain.sends,1);
  const states=(await db.query('SELECT dedupe_key,status FROM chain_jobs')).rows;
  assert.equal(states.find(j=>j.dedupe_key==='held-payout').status,'prepared');
  assert.equal(states.find(j=>j.dedupe_key==='pilot-install:foreign:0').status,'prepared');
  assert.equal(states.find(j=>j.dedupe_key==='pilot-install:current:0').status,'broadcast');
  await worker.tick();assert.equal(chain.sends,1);
 }finally{await db.close();}
});

const productionConfig=(extra={})=>config({
 DATABASE_URL:'postgres://unused',NODE_ENV:'production',KADENA_NETWORK_ID:'mainnet01',
 APP_ORIGIN:'https://earn.example.com',KADENA_NODE_URL:'https://node.example.com',
 ENABLE_CHAIN_WRITES:'false',PACT_MODULE:'',...extra,
});

test('An unconfigured mainnet worker reconciles saved transactions without reading or writing an escrow',async()=>{
 const db=await testDatabase('ke_unconfigured_worker_tests'),c=productionConfig(),ops=testKey();
 const chain=new TestChain({...c,module:'n_existing.kadena-earn',opsPublic:ops.publicKey,opsSecret:ops.seed,opsAccount:ops.account});
 const worker=new Worker(db,chain,c);let stateReads=0;
 chain.state=async()=>{stateReads++;throw new Error('No escrow is configured');};
 chain.campaign=async()=>{throw new Error('No escrow is configured');};
 try{
  const held=chain.ops('(+ 1 1)'),confirmed=chain.ops(`(${chain.c.module}.set-global-pause (read-msg "paused"))`,{paused:true});
  await db.tx(tx=>enqueue(tx,{key:'held-before-module',kind:'payout',command:held}));
  const job=await db.tx(tx=>enqueue(tx,{key:'confirmed-before-module',kind:'pause',command:confirmed}));
  chain.results.set(confirmed.hash,{result:{status:'success',data:true}});
  await worker.tick();await worker.tick();
  assert.equal(c.module,'');assert.equal(worker.lastError,null);assert.ok(worker.lastSuccess);
  assert.equal(stateReads,0);assert.equal(chain.sends,0);
  assert.equal((await db.query('SELECT status FROM chain_jobs WHERE id=$1',[job.id])).rows[0].status,'confirmed');
  assert.equal((await db.query("SELECT status FROM chain_jobs WHERE dedupe_key='held-before-module'")).rows[0].status,'prepared');
  assert.equal((await db.query("SELECT value FROM settings WHERE key='payouts_paused'")).rows[0].value,true);
 }finally{await db.close();}
});

test('A configured read-only worker still confirms saved jobs and synchronizes the live pause state',async()=>{
 const db=await testDatabase('ke_configured_readonly_worker_tests'),c=productionConfig({PACT_MODULE:'n_existing.kadena-earn'}),ops=testKey();
 const chain=new TestChain({...c,opsPublic:ops.publicKey,opsSecret:ops.seed,opsAccount:ops.account}),worker=new Worker(db,chain,c);
 const state=chain.state.bind(chain);let stateReads=0;chain.state=async()=>{stateReads++;return state();};
 try{
  const confirmed=chain.ops(`(${c.module}.set-global-pause (read-msg "paused"))`,{paused:false}),held=chain.ops('(+ 2 2)');
  const job=await db.tx(tx=>enqueue(tx,{key:'confirmed-readonly',kind:'pause',command:confirmed}));
  await db.tx(tx=>enqueue(tx,{key:'held-readonly',kind:'payout',command:held}));
  chain.results.set(confirmed.hash,{result:{status:'success',data:false}});chain.paused=true;
  await worker.tick();
  assert.equal(worker.lastError,null);assert.equal(stateReads,1);assert.equal(chain.sends,0);
  assert.equal((await db.query('SELECT status FROM chain_jobs WHERE id=$1',[job.id])).rows[0].status,'confirmed');
  assert.equal((await db.query("SELECT status FROM chain_jobs WHERE dedupe_key='held-readonly'")).rows[0].status,'prepared');
  assert.equal((await db.query("SELECT value FROM settings WHERE key='payouts_paused'")).rows[0].value,true);
 }finally{await db.close();}
});

test('Mainnet writes require an explicit escrow while development retains its local default',()=>{
 assert.equal(productionConfig().module,'');
 assert.equal(testConfig(testKey(),testKey()).module,'kadena-earn');
 assert.throws(()=>productionConfig({ENABLE_CHAIN_WRITES:'true',CONTRACT_REVIEW_CONFIRMED:'true'}),/PACT_MODULE/);
});
