import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import nacl from 'tweetnacl';
import { config } from '../src/config.js';
import { database } from '../src/db.js';
import { Chain } from '../src/pact.js';
import { contractSetup, reviewedEscrowHash } from '../src/setup.js';

// These commands edit only the local protected .env. They never sign or send KDA.
const mode=process.argv[2];
if(!['prepare','activate'].includes(mode))throw new Error('Use setup-contract.js prepare REVIEWED_SHA256 or activate');
let text=readFileSync('.env','utf8');
const env=parseEnv(text);
for(const key of ['NODE_ENV','ADMIN_ACCOUNT','KADENA_NETWORK_ID','KADENA_CHAIN_ID','PACT_MODULE','OPS_PUBLIC_KEY','OPS_SECRET_KEY','OPS_ACCOUNT','CONTRACT_REVIEW_CONFIRMED','ENABLE_CHAIN_WRITES','ENABLE_CONTRACT_SETUP','CONFIRMATION_DEPTH','GAS_PRICE']) {
  const assignments=[...text.matchAll(new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=`,'gm'))];
  if(assignments.length>1)throw new Error(`Duplicate ${key} assignments; no configuration changed`);
}
const source=readFileSync(new URL('../contracts/escrow.pact',import.meta.url),'utf8');
if(createHash('sha256').update(source).digest('hex')!==reviewedEscrowHash)throw new Error('Escrow source differs from the reviewed contract');
const changes={};
if(mode==='prepare') {
  if(process.argv[3]!==reviewedEscrowHash)throw new Error('Pass the accepted review SHA256 explicitly');
  if(env.ENABLE_CHAIN_WRITES==='true' || env.PACT_MODULE)throw new Error('Preparation requires ordinary writes disabled and PACT_MODULE blank');
  const keys=['OPS_PUBLIC_KEY','OPS_SECRET_KEY','OPS_ACCOUNT'];
  if(keys.every(key=>env[key]==='')) {
    const seed=randomBytes(32),pair=nacl.sign.keyPair.fromSeed(seed),publicKey=Buffer.from(pair.publicKey).toString('hex');
    Object.assign(changes,{OPS_PUBLIC_KEY:publicKey,OPS_SECRET_KEY:seed.toString('hex'),OPS_ACCOUNT:'k:'+publicKey});
  } else if(keys.some(key=>!env[key]))throw new Error('Operations keys are incomplete; no keys were changed');
  Object.assign(changes,{CONTRACT_REVIEW_CONFIRMED:'true',ENABLE_CHAIN_WRITES:'false',ENABLE_CONTRACT_SETUP:'true'});
  const c=config({...env,...changes});
  console.log(`Setup owner: ${c.admin}\nOperations gas account: ${c.opsAccount}`);
} else {
  const c=config(env);
  if(!c.setup)throw new Error('Enable owner setup first; no configuration changed');
  const db=database(c.database);
  try {
    const chain=new Chain(c),status=await contractSetup(db,chain,c).status();
    if(!status.ready)throw new Error('Installation and 0.05 KDA operations funding must both confirm first');
    for(const job of [status.install,status.gas]) {
      const result=await chain.poll(job.request_key);
      if(result?.result?.status!=='success')throw new Error('Native depth-6 confirmation is still pending; no configuration changed');
    }
    Object.assign(changes,{PACT_MODULE:status.module,ENABLE_CONTRACT_SETUP:'false',ENABLE_CHAIN_WRITES:'true'});
    config({...env,...changes});
    console.log(`Verified production escrow: ${status.module}\nOperations gas remaining: ${status.operations_balance_kda} KDA`);
  } finally {await db.close();}
}
for(const [key,value] of Object.entries(changes)) {
  const pattern=new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*$`,'gm');
  const assignments=[...text.matchAll(pattern)];
  if(assignments.length>1 || (!assignments.length && key!=='ENABLE_CONTRACT_SETUP'))throw new Error(`Expected exactly one ${key} assignment; no configuration changed`);
  if(assignments.length)text=text.replace(pattern,`${key}=${value}`);
  else text+='\n'+key+'='+value+'\n';
}
const backup=`.env.before-${mode}.${new Date().toISOString().replace(/[^0-9TZ]/g,'')}`;
writeFileSync(backup,readFileSync('.env'),{mode:0o600,flag:'wx'});
const temporary=`.env.setup.${process.pid}`;
try {
  writeFileSync(temporary,text,{mode:0o600,flag:'wx'});
  renameSync(temporary,'.env');
} catch(error) {try{unlinkSync(temporary);}catch{}throw error;}
console.log(`${mode==='prepare'?'Owner setup enabled; campaign writes remain disabled':'Production writes enabled after verified setup'}. Restart only kadena-earn with --update-env.`);
