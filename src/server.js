import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { database } from './db.js';
import { Chain } from './pact.js';
import { Worker } from './jobs.js';
import { ReviewAgent } from './agent.js';
import { Notifier } from './notify.js';
import { extraRoutes, GamesDaily } from './games-extra.js';
import { authRoutes } from './auth.js';
import { apiRoutes } from './api.js';
import { setupRoutes } from './setup.js';
import { gameRoutes } from './games-api.js';
import { requireValue } from './validation.js';

export function createApp(db,chain,c,worker=new Worker(db,chain,c)) {
 if(worker.agent===undefined)worker.agent=c.ai?.apiKey?new ReviewAgent(db,chain,c):null;
 if(worker.notifier===undefined)worker.notifier=new Notifier(db,c,c.sendTelegram);
 if(worker.gamesDaily===undefined)worker.gamesDaily=new GamesDaily(db,chain,c);
 const app=express();app.disable('x-powered-by');if(c.production)app.set('trust proxy',1);
 app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["'self'","https://fonts.gstatic.com"],imgSrc:["'self'","data:"],connectSrc:["'self'",'wss://relay.walletconnect.org','wss://relay.walletconnect.com','https://*.walletconnect.org','https://*.walletconnect.com'],frameSrc:['https://verify.walletconnect.org','https://verify.walletconnect.com'],objectSrc:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:c.production?[]:null}},strictTransportSecurity:c.production?undefined:false}));
 app.use(express.json({limit:'128kb'}));app.use(cookieParser());
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 app.use('/api',rateLimit({windowMs:60000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
 app.use('/api/auth',rateLimit({windowMs:60000,limit:20,standardHeaders:'draft-8',legacyHeaders:false}));
 app.use('/api',(req,res,next)=>{
   if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
     const origin=req.get('origin');requireValue(!origin||origin===c.origin,403,'Request origin does not match this application');
     requireValue(!req.get('sec-fetch-site')||['same-origin','none'].includes(req.get('sec-fetch-site')),403,'Cross-site writes are forbidden');
   }next();
 });
 app.get('/healthz',async(req,res)=>{try{await db.query('SELECT 1');res.json({ok:true});}catch{res.status(503).json({ok:false});}});
 authRoutes(app,db,c);setupRoutes(app,db,chain,c,worker);apiRoutes(app,db,chain,c,worker);gameRoutes(app,db,chain,c,{sendMail:c.sendMail,sendTelegram:c.sendTelegram});extraRoutes(app,db,chain,c);
 app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found'}));
 app.get('/transactions/:key',(req,res)=>{
   requireValue(/^[A-Za-z0-9_-]{43}$/.test(req.params.key),400,'Invalid transaction request key');
   res.sendFile(fileURLToPath(new URL('../public/transaction.html',import.meta.url)));
 });
 app.get('/games',(req,res)=>res.redirect(301,'/games.html'));
 app.get('/ai-receipts/:id',(req,res)=>{
   requireValue(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id),400,'Invalid receipt id');
   res.sendFile(fileURLToPath(new URL('../public/ai-receipt.html',import.meta.url)));
 });
 // Wallet extensions (Ecko) show the site icon in their own popup, a different origin. Helmet's
 // Cross-Origin-Resource-Policy: same-origin blocks that, so allow cross-origin loads for icon files only.
 app.use(['/favicon.ico','/favicon.svg','/nexus-mark.png','/apple-touch-icon.png','/earn-icon.png','/earn-icon-square.png'],(req,res,next)=>{res.setHeader('Cross-Origin-Resource-Policy','cross-origin');next();});
 // Pages and scripts are revalidated on every load (a cheap 304 when unchanged), so a deploy
 // reaches phones at once; script modules import each other without version tags. Images,
 // fonts and the pinned vendor bundle keep the 1-hour cache.
 app.use(express.static(fileURLToPath(new URL('../public',import.meta.url)),{maxAge:c.production?'1h':0,setHeaders:(res,file)=>{if(/\.(html|js|css)$/.test(file)&&!/[\\/]vendor[\\/]/.test(file))res.setHeader('Cache-Control','no-cache');}}));
 app.use((error,req,res,next)=>{
   const status=error.name==='ZodError'?400:error.status||500;
   if(status>=500)console.error(JSON.stringify({event:'request_error',method:req.method,path:req.path,error:error.message}));
   res.status(status).json({error:status===400&&error.issues?error.issues.map(i=>i.message).join('; '):status>=500?'Service temporarily unavailable. Your transaction state is preserved.':error.message});
 });return {app,worker};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
 const c=config(),db=database(c.database),chain=new Chain(c);const {app,worker}=createApp(db,chain,c);
 const server=app.listen(c.port,'0.0.0.0',()=>{console.log(JSON.stringify({event:'listening',port:c.port,network:c.network,writes:c.writes}));worker.start();});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{worker.stop();server.close(async()=>{await db.close();process.exit(0);});});
}
