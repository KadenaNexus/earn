import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase,testKey,testConfig,TestChain } from './helpers.js';
import { Worker,enqueue } from '../src/jobs.js';
test('Recovery polls saved commands first and never replaces unknown transactions',async()=>{
 const db=await testDatabase('ke_recovery_tests');const c=testConfig(testKey(),testKey()),chain=new TestChain(c),worker=new Worker(db,chain,c);
 try{
 const tx=chain.ops(`(${c.module}.set-global-pause (read-msg "paused"))`,{paused:false});
 const job=await db.tx(t=>enqueue(t,{key:'crash-after-send',kind:'pause',command:tx}));
 // Simulate process failure between /send acceptance and saving broadcast status.
 chain.results.set(tx.hash,{result:{status:'success',data:false}});
 await worker.tick();assert.equal(chain.sends,0);assert.equal((await db.query('SELECT status FROM chain_jobs WHERE id=$1',[job.id])).rows[0].status,'confirmed');
 const unknown=chain.ops(`(${c.module}.pay-reward "campaign" "proof" "${c.admin}")`);chain.unknown=true;
 const held=await db.tx(t=>enqueue(t,{key:'unknown-payout',kind:'payout',command:unknown}));
 await worker.tick();await worker.tick();assert.equal(chain.sends,1);
 const expired=JSON.parse(unknown.cmd);expired.meta.creationTime=Math.floor(Date.now()/1000)-1000;
 await db.query('UPDATE chain_jobs SET command=$2 WHERE id=$1',[held.id,JSON.stringify({...unknown,cmd:JSON.stringify(expired)})]);
 await worker.tick();assert.equal(chain.sends,1);
 const row=(await db.query('SELECT status,request_key,error FROM chain_jobs WHERE id=$1',[held.id])).rows[0];
 assert.equal(row.status,'broadcast');assert.equal(row.request_key,unknown.hash);assert.match(row.error,/Reconciliation required/);
 // A failed maintenance transaction accepted before a crash still counts as
 // the initial attempt, so recovery cannot grant an extra retry.
 const refund=chain.ops(`(${c.module}.refund-unused "missing-campaign")`);
 const maintenance=await db.tx(t=>enqueue(t,{key:'refund:crash-test',kind:'refund',command:refund}));
 chain.results.set(refund.hash,{result:{status:'failure',error:{message:'Recovered conclusive failure'}}});
 await worker.tick();
 assert.equal((await db.query('SELECT attempts FROM chain_jobs WHERE id=$1',[maintenance.id])).rows[0].attempts,1);
 await db.query("UPDATE chain_jobs SET confirmed_at=now()-interval '60 seconds' WHERE id=$1",[maintenance.id]);
 await worker.retryMaintenance();
 const retry=(await db.query('SELECT * FROM chain_jobs WHERE dedupe_key=$1',['refund:crash-test:retry:1'])).rows[0];
 assert.ok(retry);assert.equal(retry.attempts,1);
 // The retry was accepted before broadcast status was saved. Recovery must
 // count it as attempt two, allowing only the final third attempt.
 chain.results.set(retry.request_key,{result:{status:'failure',error:{message:'Recovered retry failure'}}});
 await worker.tick();
 assert.equal((await db.query('SELECT attempts FROM chain_jobs WHERE id=$1',[retry.id])).rows[0].attempts,2);
 await db.query("UPDATE chain_jobs SET confirmed_at=now()-interval '60 seconds' WHERE id=$1",[retry.id]);
 await worker.retryMaintenance();
 const final=(await db.query('SELECT * FROM chain_jobs WHERE dedupe_key=$1',['refund:crash-test:retry:2'])).rows[0];
 assert.ok(final);assert.equal(final.attempts,2);
 chain.results.set(final.request_key,{result:{status:'failure',error:{message:'Final failure'}}});
 await worker.tick();
 assert.equal((await db.query('SELECT attempts FROM chain_jobs WHERE id=$1',[final.id])).rows[0].attempts,3);
 await db.query("UPDATE chain_jobs SET confirmed_at=now()-interval '60 seconds' WHERE id=$1",[final.id]);
 await worker.retryMaintenance();
 assert.equal((await db.query("SELECT count(*) n FROM chain_jobs WHERE dedupe_key LIKE 'refund:crash-test%'")).rows[0].n,'3');
 }finally{await db.close();}
});
