import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentPlan } from '../src/deployment.js';
import { config } from '../src/config.js';
import { hashCommand,sign,verifySignature } from '../src/pact.js';
import { testKey } from './helpers.js';

test('Unsigned production installation is bound to Naif, the separate operations key and the prepared source',async()=>{
 const ops=testKey(),other=testKey();
 const c=config({DATABASE_URL:'postgres://unused',KADENA_NETWORK_ID:'mainnet01',OPS_PUBLIC_KEY:ops.publicKey});
 const namespace='n_f18e05b3cc09a13606f4c05946e2f6c69f73cad8';
 const chain={async local(code,data){assert.match(code,/ns.create-principal-namespace/);assert.deepEqual(data['admin-keyset'],{keys:[c.admin.slice(2)],pred:'keys-all'});return namespace;}};
 const plan=await deploymentPlan(c,chain),body=JSON.parse(plan.command.cmd);
 assert.equal(c.admin,'k:d70371113e84a5e5216c2a24b7e245049712d2c3f0d93ac77a40caf37f0f8d75');
 assert.equal(plan.module,namespace+'.kadena-earn');assert.equal(plan.review_confirmed,false);
 assert.equal(plan.command.hash,hashCommand(plan.command.cmd));assert.deepEqual(plan.command.sigs,[{sig:null}]);
 assert.equal(body.networkId,'mainnet01');assert.equal(body.meta.chainId,'1');assert.equal(body.meta.sender,c.admin);
 assert.deepEqual(body.signers,[{pubKey:c.admin.slice(2),clist:[]}]);
 assert.deepEqual(body.payload.exec.data['ops-keyset'],{keys:[ops.publicKey],pred:'keys-all'});
 assert.equal(body.payload.exec.data.sponsor,c.admin);assert.equal(body.payload.exec.code,plan.source);
 assert.equal(plan.max_deployment_gas_kda,'0.010000');
 assert.equal(body.payload.exec.code.includes('__ESCROW_ACCOUNT__'),false);
 assert.equal(verifySignature(sign(plan.command,other.seed),c.admin.slice(2)),false);
 await assert.rejects(()=>deploymentPlan({...c,opsPublic:undefined},chain),/operations public key/);
 await assert.rejects(()=>deploymentPlan(c,{local:async()=> 'untrusted.namespace'}),/principal namespace/);
});
