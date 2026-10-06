import { z } from 'zod';
import nacl from 'tweetnacl';

export const accountPattern = /^k:[0-9a-f]{64}$/;
export const accountSchema = z.string().regex(accountPattern, 'A single-key k: account is required');
export const keyPattern = /^[0-9a-f]{64}$/;
export const requestKeyPattern = /^[A-Za-z0-9_-]{43}$/;

export function config(env = process.env) {
  const c = {
    production: env.NODE_ENV === 'production', port: Number(env.PORT || 3000),
    origin: env.APP_ORIGIN || 'http://localhost:3000', database: env.DATABASE_URL,
    admin: env.ADMIN_ACCOUNT || 'k:d70371113e84a5e5216c2a24b7e245049712d2c3f0d93ac77a40caf37f0f8d75',
    network: env.KADENA_NETWORK_ID || 'development', chain: env.KADENA_CHAIN_ID || '1',
    node: (env.KADENA_NODE_URL || 'http://127.0.0.1:8080').replace(/\/$/, ''),
    module: env.PACT_MODULE || ((env.KADENA_NETWORK_ID || 'development') === 'development' ? 'kadena-earn' : ''), opsPublic: env.OPS_PUBLIC_KEY,
    opsSecret: env.OPS_SECRET_KEY, opsAccount: env.OPS_ACCOUNT,
    writes: env.ENABLE_CHAIN_WRITES === 'true', reviewed: env.CONTRACT_REVIEW_CONFIRMED === 'true',
    pilotMax: env.PILOT_MAX_POOL_KDA || '0.3', depth: Number(env.CONFIRMATION_DEPTH || 6),
    gasPrice: Number(env.GAS_PRICE || '0.0000001'), workerMs: Number(env.WORKER_INTERVAL_MS || 10000),
    sessionHours: Number(env.SESSION_HOURS || 24),
  };
  accountSchema.parse(c.admin);
  if (!c.database) throw new Error('DATABASE_URL is required');
  if (c.module && !/^(?:[a-zA-Z][\w-]*\.)?[a-zA-Z][\w-]*$/.test(c.module)) throw new Error('Invalid PACT_MODULE');
  if (c.chain !== '1') throw new Error('Kadena Earn must use chain 1');
  if (!Number.isInteger(c.depth) || c.depth < 1) throw new Error('Invalid confirmation depth');
  if (c.production && (!c.origin.startsWith('https://') || !c.node.startsWith('https://'))) throw new Error('Production requires HTTPS origins and nodes');
  if (c.network === 'mainnet01' && c.writes && !c.reviewed) throw new Error('Mainnet writes require CONTRACT_REVIEW_CONFIRMED=true');
  if (c.writes && !c.module) throw new Error('Chain writes require PACT_MODULE');
  if (c.writes && (!keyPattern.test(c.opsPublic || '') || !/^[0-9a-f]{64}(?:[0-9a-f]{64})?$/.test(c.opsSecret || '') || !accountPattern.test(c.opsAccount || ''))) throw new Error('Chain writes require valid operations keys and gas account');
  if (c.opsPublic === c.admin.slice(2)) throw new Error('The operations key must be separate from the owner key');
  if (c.writes && Buffer.from(nacl.sign.keyPair.fromSeed(Buffer.from(c.opsSecret.slice(0,64),'hex')).publicKey).toString('hex')!==c.opsPublic) throw new Error('Operations secret and public key do not match');
  if (c.pilotMax && !/^\d+(?:\.\d{1,6})?$/.test(c.pilotMax)) throw new Error('Invalid pilot pool cap');
  return c;
}
