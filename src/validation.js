import { z } from 'zod';
import { micros } from './pact.js';
export class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
export function requireValue(ok,status,message) { if (!ok) throw new HttpError(status,message); }
const text = (min,max) => z.string().trim().min(min).max(max);
export const categories = ['Testing','Ecosystem','Social','Community'];
export const templates = ['Try & Review','Fix the Ecosystem','Discover & List','Create & Share','AMA'];
const field = z.object({key:z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),label:text(1,100),type:z.enum(['text','url']),min_len:z.number().int().min(0).max(2000).default(0),required:z.boolean().default(true),private:z.boolean().default(false)}).strict();
export const maxTaskRewardKda = '5000';
export const rewardSchema = z.union([z.string(),z.number()]).transform(String).refine(s=>/^\d+(?:\.\d{1,6})?$/.test(s)&&micros(s)>0n&&micros(s)<=micros(maxTaskRewardKda),'Reward must be greater than 0 and at most 5,000 KDA per completed task, with at most six decimal places');
export const campaignSchema = z.object({
 title:text(8,180),summary:text(20,3000),sponsor_name:text(2,100),category:z.enum(categories),template:z.enum(templates),
 reward_kda:rewardSchema,
 max_rewards:z.number().int().min(1).max(10000),minutes_estimate:z.number().int().min(1).max(600),
 deadline:z.iso.datetime().refine(s=>Date.parse(s)>Date.now()+60000&&Date.parse(s)<Date.now()+366*86400000,'Deadline must be between one minute and one year from now').transform(s=>new Date(s).toISOString().replace(/\.\d{3}Z$/,'Z')),
 steps:z.array(text(1,500)).min(1).max(20),proof_schema:z.array(field).min(1).max(20),featured:z.boolean().default(false),
}).strict().refine(c=>new Set(c.proof_schema.map(f=>f.key)).size===c.proof_schema.length,'Proof field keys must be unique');
export function safeUrl(value) { try { const u=new URL(value); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password; } catch { return false; } }
export function proofData(schema,body) {
 const { proof, public_consent=false }=z.object({proof:z.record(z.string(),z.string().max(12000)),public_consent:z.boolean().optional()}).strict().parse(body);
 requireValue(Object.keys(proof).every(key=>schema.some(f=>f.key===key)),400,'Unknown proof field');
 const cleaned={};
 for(const f of schema) {
   const value=(proof[f.key]||'').trim();
   requireValue(!f.required||value.length>0,400,`${f.label} is required`);
   requireValue(!value||value.length>=f.min_len,400,`${f.label} requires at least ${f.min_len} characters`);
   requireValue(!value||f.type!=='url'||safeUrl(value),400,`${f.label} must be an HTTP or HTTPS link`);
   cleaned[f.key]=value;
 }
 return {proof:cleaned,consent:public_consent};
}
export function publicProof(schema,proof,consent) {
 if (!consent) return {finding:'Contributor completed this task. Proof is private.',links:[]};
 const publicFields=schema.filter(f=>!f.private);
 return {finding:publicFields.filter(f=>f.type==='text').map(f=>proof[f.key]).find(Boolean)||'Contributor completed this task.',links:publicFields.filter(f=>f.type==='url'&&safeUrl(proof[f.key])).map(f=>[f.label,proof[f.key]])};
}
