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
    setup: env.ENABLE_CONTRACT_SETUP === 'true',
    depth: Number(env.CONFIRMATION_DEPTH || 6),
    gasPrice: Number(env.GAS_PRICE || '0.0000001'), workerMs: Number(env.WORKER_INTERVAL_MS || 10000),
    sessionHours: Number(env.SESSION_HOURS || 24),
    ai: {
      apiKey: env.ANTHROPIC_API_KEY || '', model: env.AI_REVIEW_MODEL || 'claude-sonnet-5-5',
      maxReward: env.AI_REVIEW_MAX_REWARD_KDA || '1', dailyKda: env.AI_REVIEW_DAILY_KDA || '10',
      minConfidence: Number(env.AI_REVIEW_MIN_CONFIDENCE || 0.8), maxRounds: Number(env.AI_REVIEW_MAX_ROUNDS || 2),
      perTick: Number(env.AI_REVIEW_PER_TICK || 3),
    },
    // Kadena Nexus Games: their own AI payout limits, separate from tasks.
    games: {
      maxReward: env.GAMES_MAX_REWARD_KDA || '20', dailyKda: env.GAMES_DAILY_KDA || '200',
      winsPerDay: Number(env.GAMES_WINS_PER_WALLET_PER_DAY || 1),
      // Wins per wallet per day across all games, so one player cannot sweep every round.
      winsPerDayTotal: Number(env.GAMES_TOTAL_WINS_PER_WALLET_PER_DAY || 3),
      // Off by default: the daily AI games budget caps the loss. Turn on if one person farms with many wallets.
      requireEmail: env.GAMES_REQUIRE_EMAIL === 'true', attempts: Number(env.GAMES_ATTEMPTS_PER_ROUND || 3),
    },
    // Email confirmation (required to play games for KDA), sent with Resend.
    mail: { resendKey: env.RESEND_API_KEY || '', from: env.EMAIL_FROM || 'Kadena Earn <alerts@kadena.ws>' },
  };
  accountSchema.parse(c.admin);
  if (!c.database) throw new Error('DATABASE_URL is required');
  if (c.module && !/^(?:[a-zA-Z][\w-]*\.)?[a-zA-Z][\w-]*$/.test(c.module)) throw new Error('Invalid PACT_MODULE');
  if (!(c.ai.minConfidence >= 0.5 && c.ai.minConfidence <= 1)) throw new Error('AI_REVIEW_MIN_CONFIDENCE must be between 0.5 and 1');
  if (!/^\d+(\.\d{1,6})?$/.test(c.ai.maxReward) || !/^\d+(\.\d{1,6})?$/.test(c.ai.dailyKda)) throw new Error('AI review KDA limits must be plain decimals');
  if (!/^\d+(\.\d{1,6})?$/.test(c.games.maxReward) || !/^\d+(\.\d{1,6})?$/.test(c.games.dailyKda)) throw new Error('Game KDA limits must be plain decimals');
  if (!Number.isInteger(c.games.winsPerDay) || c.games.winsPerDay < 1 || c.games.winsPerDay > 10) throw new Error('GAMES_WINS_PER_WALLET_PER_DAY must be 1–10');
  if (!Number.isInteger(c.games.winsPerDayTotal) || c.games.winsPerDayTotal < 1 || c.games.winsPerDayTotal > 20) throw new Error('GAMES_TOTAL_WINS_PER_WALLET_PER_DAY must be 1–20');
  if (!Number.isInteger(c.games.attempts) || c.games.attempts < 1 || c.games.attempts > 10) throw new Error('GAMES_ATTEMPTS_PER_ROUND must be 1–10');
  if (!Number.isInteger(c.ai.maxRounds) || c.ai.maxRounds < 1 || c.ai.maxRounds > 5) throw new Error('AI_REVIEW_MAX_ROUNDS must be 1–5');
  if (c.chain !== '1') throw new Error('Kadena Earn must use chain 1');
  if (!Number.isInteger(c.depth) || c.depth < 1) throw new Error('Invalid confirmation depth');
  if (c.production && (!c.origin.startsWith('https://') || !c.node.startsWith('https://'))) throw new Error('Production requires HTTPS origins and nodes');
  if (c.network === 'mainnet01' && c.writes && !c.reviewed) throw new Error('Mainnet writes require CONTRACT_REVIEW_CONFIRMED=true');
  if (c.writes && !c.module) throw new Error('Chain writes require PACT_MODULE');
  if ((c.writes || c.setup) && (!keyPattern.test(c.opsPublic || '') || !/^[0-9a-f]{64}(?:[0-9a-f]{64})?$/.test(c.opsSecret || '') || c.opsAccount !== 'k:'+c.opsPublic)) throw new Error('Chain writes and setup require matching operations keys and gas account');
  if (c.opsPublic === c.admin.slice(2)) throw new Error('The operations key must be separate from the owner key');
  if ((c.writes || c.setup) && Buffer.from(nacl.sign.keyPair.fromSeed(Buffer.from(c.opsSecret.slice(0,64),'hex')).publicKey).toString('hex')!==c.opsPublic) throw new Error('Operations secret and public key do not match');
  if (c.setup && (!c.reviewed || c.writes || c.network !== 'mainnet01' || c.depth < 6 || c.gasPrice !== 0.0000001)) throw new Error('Contract setup requires reviewed mainnet chain 1, depth 6, gas price 0.0000001 and ordinary writes disabled');
  if (c.setup && c.module) throw new Error('Keep PACT_MODULE blank during owner setup; configure it after installation and gas funding confirm');
  return c;
}
