import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createApp } from '../src/server.js';
import { contractSetup } from '../src/setup.js';
import { Worker, enqueue } from '../src/jobs.js';
import { command, hashCommand, sign } from '../src/pact.js';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { reviewedEscrowHash } from '../src/setup.js';
import { testDatabase, testKey, client } from './helpers.js';

const namespace='n_'+'a'.repeat(40),module=namespace+'.kadena-earn',moduleHash='M'.repeat(43);
function setupConfig(owner,ops,extra={}) {
  return config({DATABASE_URL:'postgres://unused',ADMIN_ACCOUNT:owner.account,KADENA_NETWORK_ID:'mainnet01',APP_ORIGIN:'http://localhost:3000',ENABLE_CHAIN_WRITES:'false',ENABLE_CONTRACT_SETUP:'true',CONTRACT_REVIEW_CONFIRMED:'true',OPS_PUBLIC_KEY:ops.publicKey,OPS_SECRET_KEY:ops.seed,OPS_ACCOUNT:ops.account,...extra});
}
class SetupChain {
  constructor(c){this.c=c;this.results=new Map();this.sends=[];this.installed=false;this.hash=moduleHash;this.balance='0.05';this.guardKey=c.opsPublic;this.conclusive=true;}
  async local(code) {
    if(code.includes('ns.create-principal-namespace'))return namespace;
    if(code.includes('describe-module')){if(!this.installed)throw new Error('Cannot find module');return {hash:this.hash};}
    if(code.includes('get-config'))return {admin:{keys:[this.c.admin.slice(2)],pred:'keys-all'},ops:{keys:[this.c.opsPublic],pred:'keys-all'},sponsor:this.c.admin};
    if(code.includes('coin.details'))return {balance:this.balance,guard:{keys:[this.guardKey],pred:'keys-all'}};
    throw new Error('Unexpected read');
  }
  async post(path,tx) {
    if(path.startsWith('local'))return {result:{status:'success',data:JSON.parse(tx.cmd).payload.exec.code.includes("(at 'hash")?moduleHash:true},gas:14649};
    assert.equal(path,'send');const signed=tx.cmds[0];this.sends.push(signed);
    if(JSON.parse(signed.cmd).payload.exec.code.includes('define-namespace'))this.installed=true;
    this.results.set(signed.hash,{reqKey:signed.hash,result:{status:'success',data:true},metaData:{blockHeight:10}});
    return {requestKeys:[signed.hash]};
  }
  async poll(key){return this.conclusive?this.results.get(key)||null:null;}
  async send(){throw new Error('Ordinary sends must stay disabled');}
}
async function fixture(schema) {
  const db=await testDatabase(schema),owner=testKey(),ops=testKey(),c=setupConfig(owner,ops),chain=new SetupChain(c),worker=new Worker(db,chain,c);
  const {app}=createApp(db,chain,c,worker),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port,ownerClient=await client(base,owner);
  return {db,owner,ops,c,chain,worker,base,ownerClient,close:async()=>{await new Promise(resolve=>server.close(resolve));await db.close();}};
}
const origin={origin:'http://localhost:3000'};

test('Production setup requires separate matching operations keys, review, six confirmations and disabled ordinary writes',()=>{
  const owner=testKey(),ops=testKey();
  assert.equal(setupConfig(owner,ops).setup,true);
  for(const extra of [{CONTRACT_REVIEW_CONFIRMED:'false'},{CONFIRMATION_DEPTH:'1'},{GAS_PRICE:'0.01'},{OPS_ACCOUNT:testKey().account},{OPS_SECRET_KEY:testKey().seed},{PACT_MODULE:module},{ENABLE_CHAIN_WRITES:'true',PACT_MODULE:module}])assert.throws(()=>setupConfig(owner,ops,extra));
  assert.throws(()=>setupConfig(owner,owner),/separate/);
});

test('Owner setup authenticates each request and binds exact signatures, source, scope and gas limits',async()=>{
  const f=await fixture('ke_setup_authority_tests');
  try {
    const other=await client(f.base,testKey());
    assert.equal((await other.call('/admin/setup/status')).status,403);
    assert.equal((await f.ownerClient.raw('/admin/setup/prepare',{kind:'install'},origin)).status,403);
    assert.equal((await f.ownerClient.call('/admin/setup/prepare',{kind:'install'})).status,403,'Exact Origin is required');
    assert.equal((await f.ownerClient.call('/admin/setup/prepare',{kind:'install'},{...origin,'x-csrf-token':'bad'})).status,403);
    assert.equal((await f.ownerClient.call('/admin/setup/prepare',{kind:'gas'},origin)).status,409,'Gas waits for installation');
    const response=await f.ownerClient.call('/admin/setup/prepare',{kind:'install'},origin);assert.equal(response.status,200);
    const plan=response.data,body=JSON.parse(plan.command.cmd);
    assert.equal(plan.review.module,module);assert.equal(plan.review.maximum_gas_kda,'0.010000');assert.equal(plan.review.amount_transferred_kda,'0');
    assert.deepEqual(body.signers,[{pubKey:f.owner.publicKey,clist:[]}]);
    assert.equal(body.payload.exec.code,plan.source);assert.equal(plan.review.expected_module_hash,moduleHash);
    assert.equal(JSON.stringify(plan).includes(f.ops.seed),false,'No operations secret in response');
    const foreign=sign(plan.command,testKey().seed);
    assert.equal((await f.ownerClient.call('/admin/setup/signed',{id:plan.id,signed_command:foreign},origin)).status,400);
    body.meta.gasLimit*=10;const cmd=JSON.stringify(body),altered=sign({cmd,hash:hashCommand(cmd),sigs:[{sig:null}]},f.owner.seed);
    assert.equal((await f.ownerClient.call('/admin/setup/signed',{id:plan.id,signed_command:altered},origin)).status,400);
    const signed=sign(plan.command,f.owner.seed),accepted=await f.ownerClient.call('/admin/setup/signed',{id:plan.id,signed_command:signed},origin);
    assert.equal(accepted.status,200);assert.equal(accepted.data.status,'prepared');
    assert.equal((await f.ownerClient.call('/admin/setup/signed',{id:plan.id,signed_command:signed},origin)).data.request_key,signed.hash);
    assert.equal((await f.db.query("SELECT count(*) n FROM chain_jobs WHERE kind='setup_install'")).rows[0].n,'1');
    assert.equal((await f.ownerClient.call('/admin/setup/prepare',{kind:'install'},origin)).status,409);
    await f.db.tx(tx=>enqueue(tx,{key:'ordinary-held',kind:'payout',command:sign(command(f.c,'(+ 1 1)',{},f.ops.publicKey),f.ops.seed)}));
    await f.worker.tick();assert.equal(f.chain.sends.length,1);
    assert.equal((await f.ownerClient.call('/admin/setup/prepare',{kind:'gas'},origin)).status,409,'Broadcast is insufficient');
    await f.worker.tick();
    assert.equal((await f.ownerClient.call('/admin/setup/status')).data.install.status,'confirmed');
    assert.equal((await f.db.query("SELECT status FROM chain_jobs WHERE dedupe_key='ordinary-held'")).rows[0].status,'prepared');
    const gas=(await f.ownerClient.call('/admin/setup/prepare',{kind:'gas'},origin)).data,gasBody=JSON.parse(gas.command.cmd);
    assert.equal(gas.review.maximum_gas_kda,'0.001500');assert.equal(gas.review.amount_transferred_kda,'0.05');
    assert.deepEqual(gasBody.signers[0].clist,[{name:'coin.GAS',args:[]},{name:'coin.TRANSFER',args:[f.owner.account,f.ops.account,0.05]}]);
    assert.equal((await f.ownerClient.call('/admin/setup/signed',{id:gas.id,signed_command:sign(gas.command,f.owner.seed)},origin)).status,200);
    await f.worker.tick();await f.worker.tick();
    const ready=(await f.ownerClient.call('/admin/setup/status')).data;
    assert.equal(ready.ready,true);assert.equal(f.c.writes,false);assert.equal(f.chain.sends.length,2);
    f.chain.balance='0.0499';assert.equal((await f.ownerClient.call('/admin/setup/status')).data.ready,true,'Consumed gas does not invalidate confirmed funding');
    f.chain.guardKey=testKey().publicKey;assert.equal((await f.ownerClient.call('/admin/setup/status')).status,409);
    f.chain.guardKey=f.ops.publicKey;f.chain.hash='X'.repeat(43);assert.equal((await f.ownerClient.call('/admin/setup/status')).status,409);
  } finally {await f.close();}
});

test('Setup broadcast validates saved provenance after restart and never replaces an unknown expired transfer',async()=>{
  const f=await fixture('ke_setup_recovery_tests');
  try {
    const plan=(await f.ownerClient.call('/admin/setup/prepare',{kind:'install'},origin)).data;
    await f.ownerClient.call('/admin/setup/signed',{id:plan.id,signed_command:sign(plan.command,f.owner.seed)},origin);
    const restarted=new Worker(f.db,f.chain,f.c);restarted.setupSender=contractSetup(f.db,f.chain,f.c).send;
    await f.db.query("UPDATE audit_log SET metadata=jsonb_set(metadata,'{setup_source_sha256}','\"invalid\"') WHERE action='owner_setup_signed'");
    await restarted.tick();assert.equal(f.chain.sends.length,0,'Missing provenance holds queued installation');
    const job=(await f.db.query("SELECT * FROM chain_jobs WHERE kind='setup_install'")).rows[0];
    assert.match(job.error,/metadata/);
    const {createHash}=await import('node:crypto');
    const hash=createHash('sha256').update(plan.source).digest('hex');
    await f.db.query("UPDATE audit_log SET metadata=jsonb_set(metadata,'{setup_source_sha256}',to_jsonb($1::text)) WHERE action='owner_setup_signed'",[hash]);
    await restarted.tick();assert.equal(f.chain.sends.length,1);
    f.chain.conclusive=false;
    assert.equal((await f.ownerClient.call('/admin/setup/prepare',{kind:'install'},origin)).status,409);
    // Move the signed command's clock backward as if a corrupt/stale job were
    // recovered. It is held for reconciliation, never replaced or broadcast.
    const b=JSON.parse(plan.command.cmd);b.meta.creationTime=Math.floor(Date.now()/1000)-1000;
    const cmd=JSON.stringify(b),expired=sign({cmd,hash:hashCommand(cmd)},f.owner.seed);
    await f.db.query("UPDATE chain_jobs SET status='prepared',command=$1,request_key=$2 WHERE id=$3",[JSON.stringify(expired),expired.hash,job.id]);
    await restarted.tick();assert.equal(f.chain.sends.length,1);
    assert.match((await f.db.query('SELECT error FROM chain_jobs WHERE id=$1',[job.id])).rows[0].error,/expired.*Reconciliation/);
    assert.equal((await f.ownerClient.call('/admin/setup/prepare',{kind:'install'},origin)).status,409);
    assert.equal((await f.db.query("SELECT count(*) n FROM chain_jobs WHERE kind='setup_install'")).rows[0].n,'1');
  } finally {await f.close();}
});

test('Setup verifies the installed module again immediately before gas broadcast',async()=>{
  const f=await fixture('ke_setup_live_guard_tests');
  try {
    const setup=contractSetup(f.db,f.chain,f.c),actor=f.ownerClient.session.data.user.id;
    const plan=await setup.prepare('install');await setup.accept(plan.id,sign(plan.command,f.owner.seed),actor);
    await f.worker.tick();await f.worker.tick();
    const gas=await setup.prepare('gas');await setup.accept(gas.id,sign(gas.command,f.owner.seed),actor);
    f.chain.hash='X'.repeat(43);await f.worker.tick();assert.equal(f.chain.sends.length,1);
    const job=(await f.db.query("SELECT * FROM chain_jobs WHERE kind='setup_gas'")).rows[0];assert.equal(job.status,'prepared');assert.match(job.error,/hash/);
    f.chain.hash=moduleHash;await f.worker.tick();assert.equal(f.chain.sends.length,2);
    await f.worker.tick();assert.equal((await setup.status()).ready,true);
  } finally {await f.close();}
});

test('An expired unsigned owner setup cannot enter the broadcast queue',async()=>{
  const f=await fixture('ke_setup_expiry_tests'),setup=contractSetup(f.db,f.chain,f.c);
  try {
    const plan=await setup.prepare('install'),clock=Date.now;
    try {
      Date.now=()=>clock()+700000;
      await assert.rejects(()=>setup.accept(plan.id,sign(plan.command,f.owner.seed),f.ownerClient.session.data.user.id),/expired/);
    } finally {Date.now=clock;}
    assert.equal((await f.db.query('SELECT count(*) n FROM chain_jobs')).rows[0].n,'0');
  } finally {await f.close();}
});

test('Setup CLI generates a private operations key once and refuses unsafe environment changes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'earn-setup-cli-'));
  const script=fileURLToPath(new URL('../scripts/setup-contract.js',import.meta.url));
  try {
    const initial=(await readFile(new URL('../.env.example',import.meta.url),'utf8')).replace('https://earn.example.com','https://earn.kadena.ws');
    await writeFile(join(directory,'.env'),initial,{mode:0o600});
    const run=(mode,hash)=>execFileSync(process.execPath,[script,mode,...(hash?[hash]:[])],{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    assert.throws(()=>run('prepare','0'.repeat(64)),/review SHA256/);
    assert.equal(await readFile(join(directory,'.env'),'utf8'),initial);
    const output=run('prepare',reviewedEscrowHash),first=await readFile(join(directory,'.env'),'utf8'),env=parseEnv(first),c=config(env);
    assert.equal(c.setup,true);assert.equal(c.writes,false);assert.equal(c.module,'');assert.equal(env.OPS_ACCOUNT,'k:'+env.OPS_PUBLIC_KEY);
    assert.match(output,new RegExp(env.OPS_PUBLIC_KEY));assert.equal(output.includes(env.OPS_SECRET_KEY),false);
    // Keep protected backups distinct if two commands run in the same second.
    await new Promise(resolve=>setTimeout(resolve,1100));
    run('prepare',reviewedEscrowHash);assert.equal(parseEnv(await readFile(join(directory,'.env'),'utf8')).OPS_SECRET_KEY,env.OPS_SECRET_KEY);
    await writeFile(join(directory,'.env'),first+'\nOPS_ACCOUNT=\n');
    const duplicated=await readFile(join(directory,'.env'),'utf8');assert.throws(()=>run('prepare',reviewedEscrowHash));
    assert.equal(await readFile(join(directory,'.env'),'utf8'),duplicated,'Rejected preparation is atomic');
    await writeFile(join(directory,'.env'),first.replace('ENABLE_CHAIN_WRITES=false','ENABLE_CHAIN_WRITES=true'));
    assert.throws(()=>run('prepare',reviewedEscrowHash),/writes disabled/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
