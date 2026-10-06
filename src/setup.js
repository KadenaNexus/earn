import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { admin } from './auth.js';
import { audit } from './db.js';
import { deploymentPlan } from './deployment.js';
import { command, hashCommand, quote, verifySignature } from './pact.js';
import { enqueue, unwrap } from './jobs.js';
import { requireValue } from './validation.js';

// Changing the reviewed escrow requires a new review before setup can sign it.
export const reviewedEscrowHash = 'fdf806b5064fade82f71f11941e091cfeb0e87d9f5efe776d4aa4f6763047d32';
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const guard = (value,key) => value?.pred === 'keys-all' && value.keys?.length === 1 && value.keys[0] === key;
const view = job => job ? {status:job.status,request_key:job.request_key,error:job.error} : null;
const kinds = {install:'setup_install',gas:'setup_gas'};

export function contractSetup(db,chain,c) {
  const prepared = new Map();
  let contextPromise;
  async function context() {
    requireValue(c.setup && c.reviewed && !c.writes,409,'Contract setup is disabled');
    if (!contextPromise) contextPromise = (async()=>{
      const raw = await readFile(new URL('../contracts/escrow.pact',import.meta.url),'utf8');
      requireValue(sha(raw) === reviewedEscrowHash,409,'Escrow source differs from the reviewed contract');
      const namespace = await chain.local('(ns.create-principal-namespace (read-keyset "admin-keyset"))',{'admin-keyset':{keys:[c.admin.slice(2)],pred:'keys-all'}});
      requireValue(/^n_[0-9a-f]{40}$/.test(namespace),409,'Unexpected owner namespace');
      const module = namespace+'.kadena-earn';
      const source = `(define-namespace ${quote(namespace)} (read-keyset "admin-keyset") (read-keyset "admin-keyset"))\n(namespace ${quote(namespace)})\n`+raw.replaceAll('__ESCROW_ACCOUNT__',module.replace('.','-')+'-escrow');
      return {module,source,family:'owner-setup:'+sha([c.admin,module,c.opsAccount,reviewedEscrowHash].join('|'))+':'};
    })().catch(error=>{contextPromise=null;throw error;});
    return contextPromise;
  }
  async function latest(kind,tx=db) {
    const {family}=await context();
    return (await tx.query('SELECT * FROM chain_jobs WHERE starts_with(dedupe_key,$1) AND kind=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[family,kinds[kind]])).rows[0];
  }
  async function count(kind,tx=db) {
    const {family}=await context();
    return Number((await tx.query('SELECT count(*) n FROM chain_jobs WHERE starts_with(dedupe_key,$1) AND kind=$2',[family,kinds[kind]])).rows[0].n);
  }
  function gasCommand() {
    const source=`(coin.transfer-create ${quote(c.admin)} ${quote(c.opsAccount)} (read-keyset "recipient") 0.05)`;
    return command(c,source,{recipient:{keys:[c.opsPublic],pred:'keys-all'}},c.admin.slice(2),[{name:'coin.GAS',args:[]},{name:'coin.TRANSFER',args:[c.admin,c.opsAccount,0.05]}]);
  }
  async function validate(job,tx=db) {
    const ctx=await context(),kind=Object.keys(kinds).find(key=>kinds[key]===job.kind);
    requireValue(kind && job.dedupe_key.startsWith(ctx.family+kinds[kind]+':'),409,'Unrecognized setup transaction');
    requireValue(job.request_key===job.command.hash && verifySignature(job.command,c.admin.slice(2)),409,'Saved setup signature mismatch');
    const body=JSON.parse(job.command.cmd),gas=JSON.parse(gasCommand().cmd);
    const expectedPayload=kind==='install'?{exec:{code:ctx.source,data:{'admin-keyset':{keys:[c.admin.slice(2)],pred:'keys-all'},'ops-keyset':{keys:[c.opsPublic],pred:'keys-all'},sponsor:c.admin}}}:gas.payload;
    const expectedSigners=kind==='install'?[{pubKey:c.admin.slice(2),clist:[]}]:gas.signers;
    requireValue(body.networkId===c.network && same(body.payload,expectedPayload) && same(body.signers,expectedSigners) && same({...body.meta,creationTime:0},{...gas.meta,gasLimit:kind==='install'?100000:15000,creationTime:0}) && Number.isInteger(body.meta.creationTime) && /^kadena-earn:[0-9a-f-]{36}$/.test(body.nonce),409,'Saved setup authority differs from the reviewed transaction');
    const meta=(await tx.query("SELECT metadata FROM audit_log WHERE action='owner_setup_signed' AND entity_id=$1 ORDER BY id DESC LIMIT 1",[job.id])).rows[0]?.metadata;
    requireValue(meta?.owner===c.admin && meta.operations===c.opsAccount && meta.module===ctx.module && meta.source_sha256===reviewedEscrowHash && meta.setup_source_sha256===sha(body.payload.exec.code) && /^[A-Za-z0-9_-]{43}$/.test(meta.expected_module_hash),409,'Saved setup review metadata mismatch');
    return meta;
  }
  async function installation(tx=db) {
    const {module}=await context(),job=await latest('install',tx);
    if(job?.status!=='confirmed')return null;
    const meta=await validate(job,tx);
    requireValue(job.result?.reqKey===job.request_key && job.result?.result?.status==='success' && Number.isFinite(job.result?.metaData?.blockHeight),409,'Installation confirmation is incomplete');
    const state=await chain.local(`(${module}.get-config)`),installed=await chain.local(`(describe-module ${quote(module)})`);
    requireValue(guard(state.admin,c.admin.slice(2)) && guard(state.ops,c.opsPublic) && state.sponsor===c.admin && installed.hash===meta.expected_module_hash,409,'Installed escrow hash, sponsor or guards do not match the signed setup');
    return meta;
  }
  async function status() {
    const base={enabled:!!c.setup,active:!!c.writes,owner:c.admin,module:c.module||null,operations_account:c.opsAccount||null,network:c.network,chain:c.chain,ready:false,install:null,gas:null,operations_balance_kda:null};
    if(!c.setup)return base;
    const ctx=await context(),install=await latest('install'),gas=await latest('gas');
    const installed=await installation();
    let balance=null,ready=false;
    if(installed && gas?.status==='confirmed') {
      const meta=await validate(gas);
      requireValue(meta.expected_module_hash===installed.expected_module_hash && gas.result?.reqKey===gas.request_key && gas.result?.result?.status==='success' && Number.isFinite(gas.result?.metaData?.blockHeight),409,'Gas funding confirmation is incomplete');
      const details=unwrap(await chain.local(`(coin.details ${quote(c.opsAccount)})`));
      requireValue(guard(details.guard,c.opsPublic),409,'Operations gas account guard does not match');
      balance=String(details.balance);
      ready=Number(balance)>0;
    }
    return {...base,module:ctx.module,install:view(install),gas:view(gas),operations_balance_kda:balance,ready};
  }
  async function prepare(kind) {
    requireValue(Object.hasOwn(kinds,kind),400,'Choose installation or gas funding');
    const ctx=await context(),previous=await latest(kind);
    requireValue(!previous || previous.status==='failed',409,'Check the saved setup transaction; pending or confirmed transactions cannot be replaced');
    requireValue(await count(kind)<2,409,'Reconcile setup before further attempts');
    let tx,expectedHash;
    if(kind==='install') {
      try {
        await chain.local(`(describe-module ${quote(ctx.module)})`);
        requireValue(false,409,'The escrow module already exists; setup never upgrades it');
      } catch(error) {
        requireValue(/Cannot find module|not found|does not exist/i.test(error.message),409,error.message);
      }
      const plan=await deploymentPlan(c,chain);
      requireValue(plan.module===ctx.module && plan.source===ctx.source && plan.source_sha256===reviewedEscrowHash,409,'Deployment plan differs from reviewed source');
      tx=plan.command;
      // Rollback-only inspection computes the module hash without changing the
      // source signed by the owner or broadcasting any installation.
      const body=JSON.parse(tx.cmd);body.payload.exec.code+=`\n(at 'hash (describe-module ${quote(ctx.module)}))`;
      const cmd=JSON.stringify(body),outer=await chain.post('local?signatureVerification=false',{cmd,hash:hashCommand(cmd),sigs:[{sig:'0'.repeat(128)}]});
      const result=outer.preflightResult||outer;
      requireValue(result.result?.status==='success' && /^[A-Za-z0-9_-]{43}$/.test(result.result.data),409,'Installation hash simulation failed');
      expectedHash=result.result.data;
    } else {
      const installed=await installation();
      requireValue(installed,409,'Wait for installation to confirm before funding operations gas');
      expectedHash=installed.expected_module_hash;tx=gasCommand();
    }
    const outer=await chain.post('local?preflight=true&signatureVerification=false',{...tx,sigs:[{sig:'0'.repeat(128)}]}),simulation=outer.preflightResult||outer;
    requireValue(simulation.result?.status==='success',409,'Setup simulation failed; no transaction was sent');
    const body=JSON.parse(tx.cmd),id=randomUUID();
    prepared.clear();prepared.set(id,{kind,tx,expectedHash});
    return {id,command:tx,source:body.payload.exec.code,review:{purpose:kind==='install'?'Install production escrow':'Fund operations gas',owner:c.admin,module:ctx.module,operations_account:c.opsAccount,network:c.network,chain:c.chain,amount_transferred_kda:kind==='gas'?'0.05':'0',maximum_gas_kda:(body.meta.gasLimit*body.meta.gasPrice).toFixed(6),signature_authority:kind==='install'?'Unscoped owner signature':'coin.GAS and 0.05 KDA coin.TRANSFER',source_sha256:reviewedEscrowHash,expected_module_hash:expectedHash,request_key:tx.hash,expires_at:new Date((body.meta.creationTime+body.meta.ttl)*1000).toISOString(),data:body.payload.exec.data,signers:body.signers,meta:body.meta}};
  }
  async function accept(id,signed,actor) {
    const ctx=await context(),plan=prepared.get(id);
    requireValue(plan && signed?.cmd===plan.tx.cmd && signed.hash===plan.tx.hash && verifySignature(signed,c.admin.slice(2)),400,'Exact owner-signed prepared command required');
    const body=JSON.parse(signed.cmd);
    requireValue(body.meta.creationTime+body.meta.ttl>Math.floor(Date.now()/1000)+15,409,'Unsigned preparation expired; prepare again');
    if(plan.kind==='gas')requireValue(await installation(),409,'Installation must remain verified before funding gas');
    return db.tx(async tx=>{
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[ctx.family]);
      const previous=await latest(plan.kind,tx);
      if(previous && previous.status!=='failed')return view(previous);
      const attempt=await count(plan.kind,tx);
      requireValue(attempt<2,409,'Reconcile setup before further attempts');
      const job=await enqueue(tx,{key:ctx.family+kinds[plan.kind]+':'+attempt,kind:kinds[plan.kind],actor,command:signed});
      await audit(tx,actor,'owner_setup_signed','contract',job.id,{owner:c.admin,operations:c.opsAccount,module:ctx.module,source_sha256:reviewedEscrowHash,setup_source_sha256:sha(body.payload.exec.code),expected_module_hash:plan.expectedHash});
      return view(job);
    });
  }
  async function send(tx,job) {
    const meta=await validate(job,tx);
    if(job.kind==='setup_gas') {
      const installed=await installation(tx);
      requireValue(installed?.expected_module_hash===meta.expected_module_hash,409,'Installation must be verified before gas broadcast');
    }
    // Only these two exact, signed, audited setup commands reach this dedicated
    // sender. Ordinary chain.send and chain.ops still require c.writes=true.
    const result=await chain.post('send',{cmds:[job.command]});
    requireValue(result.requestKeys?.length===1 && result.requestKeys[0]===job.request_key,502,'Unexpected setup request key');
  }
  return {status,prepare,accept,send};
}

export function setupRoutes(app,db,chain,c,worker) {
  const setup=contractSetup(db,chain,c);
  if(c.setup)worker.setupSender=setup.send;
  app.get('/api/admin/setup/status',admin(c),async(req,res)=>res.json(await setup.status()));
  const ownerWrite=(req,res,next)=>{requireValue(req.get('origin')===c.origin,403,'Exact application origin required');next();};
  app.post('/api/admin/setup/prepare',admin(c),ownerWrite,async(req,res)=>{
    const {kind}=z.object({kind:z.enum(['install','gas'])}).strict().parse(req.body);
    res.json(await setup.prepare(kind));
  });
  app.post('/api/admin/setup/signed',admin(c),ownerWrite,async(req,res)=>{
    const {id,signed_command}=z.object({id:z.string().uuid(),signed_command:z.object({cmd:z.string(),hash:z.string(),sigs:z.array(z.object({sig:z.string()}))}).strict()}).strict().parse(req.body);
    res.json(await setup.accept(id,signed_command,req.user.id));
  });
}
