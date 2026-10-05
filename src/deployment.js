import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { command, hashCommand, quote, signingRequest } from './pact.js';
import { keyPattern } from './config.js';

export async function deploymentPlan(c,chain) {
 if(!keyPattern.test(c.opsPublic||''))throw new Error('A separate operations public key is required');
 const namespace=await chain.local('(ns.create-principal-namespace (read-keyset "admin-keyset"))',{'admin-keyset':{keys:[c.admin.slice(2)],pred:'keys-all'}});
 if(!/^n_[0-9a-f]{40}$/.test(namespace))throw new Error('Unexpected principal namespace');
 const module=namespace+'.kadena-earn';
 const raw=await readFile(new URL('../contracts/escrow.pact',import.meta.url),'utf8');
 const source=`(define-namespace ${quote(namespace)} (read-keyset "admin-keyset") (read-keyset "admin-keyset"))\n(namespace ${quote(namespace)})\n`+raw.replaceAll('__ESCROW_ACCOUNT__',module.replace('.','-')+'-escrow');
 const data={'admin-keyset':{keys:[c.admin.slice(2)],pred:'keys-all'},'ops-keyset':{keys:[c.opsPublic],pred:'keys-all'},sponsor:c.admin};
 // Namespace installation needs an unscoped owner signature. Show the entire
 // source for review; this helper only prepares the installation transaction.
 const tx=command(c,source,data,c.admin.slice(2),[]);
 const body=JSON.parse(tx.cmd);body.meta.gasLimit=100000;
 tx.cmd=JSON.stringify(body);tx.hash=hashCommand(tx.cmd);
 return {kind:'deploy',module,review_confirmed:c.reviewed,owner:c.admin,operations_account:'k:'+c.opsPublic,source_sha256:createHash('sha256').update(raw).digest('hex'),deployment_source_sha256:createHash('sha256').update(source).digest('hex'),max_deployment_gas_kda:(body.meta.gasLimit*body.meta.gasPrice).toFixed(6),command:tx,signing_request:signingRequest(tx),source};
}
