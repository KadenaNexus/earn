import { randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import { database } from '../src/db.js';
import { config } from '../src/config.js';
import { migrate } from '../scripts/migrate.js';
import { command, sign } from '../src/pact.js';
export function testKey(seed=randomBytes(32).toString('hex')) {const pair=nacl.sign.keyPair.fromSeed(Buffer.from(seed,'hex'));const publicKey=Buffer.from(pair.publicKey).toString('hex');return {seed,publicKey,account:'k:'+publicKey};}
export async function testDatabase(schema) {
 const base=process.env.TEST_DATABASE_URL||'postgres://kadena_earn@127.0.0.1:55432/kadena_earn';
 if(!/^[a-z_]+$/.test(schema))throw new Error('Invalid test schema');
 const setup=database(base);await setup.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.query(`CREATE SCHEMA ${schema}`);await setup.close();
 const url=new URL(base);url.searchParams.set('options','-c search_path='+schema);
 const db=database(url.href);db.url=url.href;await migrate(db);return db;
}
export function testConfig(adminKey,opsKey,databaseUrl='postgres://unused') {return config({DATABASE_URL:databaseUrl,NODE_ENV:'test',ADMIN_ACCOUNT:adminKey.account,KADENA_NETWORK_ID:'development',OPS_PUBLIC_KEY:opsKey.publicKey,OPS_SECRET_KEY:opsKey.seed,OPS_ACCOUNT:opsKey.account,ENABLE_CHAIN_WRITES:'true',CONFIRMATION_DEPTH:'1',APP_ORIGIN:'http://localhost:3000'});}
// Deterministic node transport fixture. Actual Pact safety is tested against Pact 5,
// and the same API workflow also runs against a mined Chainweb node in test:chain.
export class TestChain {
 constructor(c){this.c=c;this.results=new Map();this.campaigns=new Map();this.paused=false;this.failNext=false;this.unknown=false;this.sends=0;}
 ops(code,data={}) {return sign(command(this.c,code,data,this.c.opsPublic,[{name:'coin.GAS',args:[]},{name:`${this.c.module}.OPS`,args:[]}],this.c.opsAccount),this.c.opsSecret);}
 async send(tx) {
   this.sends++;if(this.unknown)return tx.hash;
   const b=JSON.parse(tx.cmd),code=b.payload.exec.code;
   let data=true,failed=this.failNext;this.failNext=false;
   if(!failed) {
     const strings=[...code.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map(m=>m[1]);
     if(code.includes('create-and-fund')) {
       const [,sponsor]=strings;const nums=code.match(/"\s+(\d+(?:\.\d+)?)\s+(\d+)\s+\(time/);const reward=nums[1],slots=Number(nums[2]);
       this.campaigns.set(strings[0],{sponsor,reward,slots,funded:(Number(reward)*slots).toFixed(6),paid:'0',refunded:'0','paid-count':0,'reserved-count':0});
     } else if(code.includes('reserve-claim'))this.campaigns.get(strings[0])['reserved-count']++;
     else if(code.includes('pay-reward')){const s=this.campaigns.get(strings[0]);s.paid=(Number(s.paid)+Number(s.reward)).toFixed(6);s['paid-count']++;s['reserved-count']--;}
     else if(code.includes('release-claim'))this.campaigns.get(strings[0])['reserved-count']--;
     else if(code.includes('refund-unused')){const s=this.campaigns.get(strings[0]);data=(Number(s.funded)-Number(s.paid)-Number(s.refunded)-Number(s.reward)*s['reserved-count']).toFixed(6);s.refunded=(Number(s.refunded)+Number(data)).toFixed(6);}
     else if(code.includes('set-global-pause'))this.paused=b.payload.exec.data.paused;
   }
   this.results.set(tx.hash,{reqKey:tx.hash,result:failed?{status:'failure',error:{message:'Injected node failure'}}:{status:'success',data},metaData:{blockHeight:1}});return tx.hash;
 }
 async poll(key){return this.results.get(key)||null;}
 async campaign(id){return structuredClone(this.campaigns.get(id));}
 async state(){return {paused:this.paused};}
}
export async function client(base,key) {
 const call=async(path,body,headers={})=>{
   const res=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
   return {status:res.status,data:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
 };
 const n=await call('/auth/nonce',{account:key.account});
 const v=await call('/auth/verify',{account:key.account,nonce:n.data.nonce,signed_command:sign(n.data.command,key.seed)});
 if(v.status!==200)throw new Error(JSON.stringify(v));
 return {session:v,nonce:n,call:(path,body,headers={})=>call(path,body,{cookie:v.cookie,'x-csrf-token':v.data.csrf,...headers}),raw:call};
}
export const campaignInput=()=>({title:'Local pilot feedback campaign',summary:'Complete a real local workflow and report what confused you.',sponsor_name:'Kadena Earn',category:'Testing',template:'Try & Review',reward_kda:'0.1',max_rewards:3,minutes_estimate:5,deadline:new Date(Date.now()+86400000).toISOString(),steps:['Complete the local pilot','Write your findings'],proof_schema:[{key:'finding',label:'Finding',type:'text',min_len:40,private:false,required:true},{key:'private_link',label:'Private evidence',type:'url',min_len:0,private:true,required:true}]});
