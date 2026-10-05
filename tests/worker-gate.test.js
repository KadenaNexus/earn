import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker,enqueue} from '../src/jobs.js';
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
