import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Chain } from '../src/pact.js';

test('Both successful and failed transactions wait for confirmation depth before reconciliation',async()=>{
 const key='A'.repeat(43);
 let height=100,status='failure',included=100,orphan=false,resultKey=key;
 const server=createServer((req,res)=>{
   res.setHeader('content-type','application/json');
   if(!req.url.endsWith('/cut'))assert.equal(new URL(req.url,'http://localhost').searchParams.get('confirmationDepth'),'6');
   res.end(JSON.stringify(req.url.endsWith('/cut')?{hashes:{'1':{height}}}:orphan?{}:{[key]:{reqKey:resultKey,result:{status},metaData:{blockHeight:included}}}));
 });
 server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const chain=new Chain({node:'http://127.0.0.1:'+server.address().port,network:'mainnet01',chain:'1',depth:6});
 try {
   assert.equal(await chain.poll(key),null,'A newly included failure cannot permit a replacement command');
   height=104;assert.equal(await chain.poll(key),null);
   height=105;assert.equal((await chain.poll(key)).result.status,'failure');
   status='success';height=104;assert.equal(await chain.poll(key),null);
   height=105;assert.equal((await chain.poll(key)).result.status,'success');
   included=undefined;assert.equal(await chain.poll(key),null,'An inclusion height is required to confirm a result');
   included=100;orphan=true;assert.equal(await chain.poll(key),null,'A node-filtered orphan result stays unconfirmed despite sufficient height');
   orphan=false;resultKey='B'.repeat(43);await assert.rejects(()=>chain.poll(key),/mismatched transaction/);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
