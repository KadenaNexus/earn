import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { accountSchema } from './config.js';
import { quote, command, verifySignature, signingRequest } from './pact.js';
import { requireValue } from './validation.js';
import { audit } from './db.js';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const userView = (user,c) => ({id:user.id,account:user.kadena_account,display_name:user.display_name,role:user.kadena_account===c.admin?'admin':'contributor'});
const cookieOptions = c => ({httpOnly:true,secure:c.production,sameSite:'strict',path:'/'});
export function authRoutes(app,db,c) {
 app.post('/api/auth/nonce',async(req,res)=>{
   const {account}=z.object({account:accountSchema}).strict().parse(req.body);
   const nonce=randomBytes(32).toString('hex');
   const expires=new Date(Date.now()+5*60000);
   const data={account,'login-keyset':{keys:[account.slice(2)],pred:'keys-all'},challenge:`Sign in to Kadena Earn at ${c.origin}. Nonce: ${nonce}. Expires: ${expires.toISOString()}`};
   const code=`(enforce (= (read-string "account") ${quote(account)}) "Account mismatch") (enforce-guard (read-keyset "login-keyset")) (read-string "challenge")`;
   const tx=command(c,code,data,account.slice(2),[]);
   await db.query('INSERT INTO auth_nonces(nonce,account,signing_request,expires_at) VALUES($1,$2,$3,$4)',[nonce,account,JSON.stringify(tx),expires]);
   res.json({nonce,command:tx,signing_request:signingRequest(tx),expires_at:expires,message:data.challenge});
 });
 app.post('/api/auth/verify',async(req,res)=>{
   const {account,nonce,signed_command}=z.object({account:accountSchema,nonce:z.string().regex(/^[0-9a-f]{64}$/),signed_command:z.object({cmd:z.string(),hash:z.string(),sigs:z.array(z.object({sig:z.string()}))})}).strict().parse(req.body);
   const result=await db.tx(async tx=>{
     const n=(await tx.query('SELECT * FROM auth_nonces WHERE nonce=$1 FOR UPDATE',[nonce])).rows[0];
     requireValue(n&&n.account===account&&!n.used_at&&new Date(n.expires_at)>new Date(),401,'Challenge expired or already used');
     const expected=JSON.parse(n.signing_request.cmd), actual=JSON.parse(signed_command.cmd);
     // Ecko requestSign may choose a fresh nonce/creation time. Bind every authority-bearing field.
     const normalize=b=>({networkId:b.networkId,payload:b.payload,signers:b.signers,meta:{...b.meta,creationTime:0},nonce:''});
     requireValue(JSON.stringify(normalize(actual))===JSON.stringify(normalize(expected))&&verifySignature(signed_command,account.slice(2)),401,'Invalid wallet signature');
     await tx.query('UPDATE auth_nonces SET used_at=now() WHERE nonce=$1',[nonce]);
     const user=(await tx.query('INSERT INTO users(kadena_account) VALUES($1) ON CONFLICT(kadena_account) DO UPDATE SET kadena_account=excluded.kadena_account RETURNING *',[account])).rows[0];
     const token=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');
     await tx.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+($4||' hours')::interval)",[digest(token),user.id,csrf,c.sessionHours]);
     await audit(tx,user.id,'login','user',user.id);
     return {token,csrf,user:userView(user,c)};
   });
   res.cookie('ke_session',result.token,{...cookieOptions(c),maxAge:c.sessionHours*3600000});
   res.json({user:result.user,csrf:result.csrf});
 });
 app.use('/api',async(req,res,next)=>{
   const token=req.cookies.ke_session;
   if(token) {
     const s=(await db.query('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now()',[digest(token)])).rows[0];
     if(s) {req.user=s;req.csrf=s.csrf;}
   }
   if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.user) requireValue(req.get('x-csrf-token')===req.csrf,403,'Session CSRF token required');
   next();
 });
 app.get('/api/auth/session',(req,res)=>res.json({user:req.user?userView(req.user,c):null,csrf:req.csrf||null}));
 app.post('/api/auth/logout',async(req,res)=>{
   if(req.cookies.ke_session)await db.query('DELETE FROM sessions WHERE token_hash=$1',[digest(req.cookies.ke_session)]);
   res.clearCookie('ke_session',cookieOptions(c)).json({ok:true});
 });
}
export const authenticated=(req,res,next)=>{requireValue(req.user,401,'Connect your wallet first');next();};
export const admin=c=>(req,res,next)=>{requireValue(req.user?.kadena_account===c.admin,403,'Owner access required');next();};
