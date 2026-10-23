// Question banks for Kadena Nexus Games (quiz, written answers, riddles, hidden
// words, Pact bugs). The built-in banks ship with the code, which is public. The
// owner can upload private banks from the Games page; they are stored in the
// database (game_content) and replace the built-in bank of that kind. Each
// round copies the items it uses into the session secret, so changing a bank
// never breaks a round in progress.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { QUIZ, WRITTEN, RIDDLES, WORDS, PACT_BUGS } from './game-content.js';

export const KINDS = ['quiz', 'written', 'riddles', 'words', 'pactbugs'];
export const BUILT_IN = { quiz: QUIZ, written: WRITTEN, riddles: RIDDLES, words: WORDS, pactbugs: PACT_BUGS };

const text = (min, max) => z.string().trim().min(min).max(max);
const SCHEMAS = {
  quiz: z.array(z.object({ q: text(10, 300), o: z.array(text(1, 160)).min(3).max(5), a: z.number().int().min(0) }).strict()
    .refine(x => x.a < x.o.length, 'a must point at one of the options').refine(x => new Set(x.o).size === x.o.length, 'options must be different')).min(10).max(2000),
  written: z.array(z.object({ q: text(20, 400), guide: text(20, 600) }).strict()).min(3).max(500),
  riddles: z.array(z.object({ q: text(10, 400), answers: z.array(text(1, 60)).min(1).max(12) }).strict()).min(10).max(2000),
  words: z.array(z.string().trim().toLowerCase().regex(/^[a-z]{5}$/, 'words must be 5 letters a to z')).min(20).max(5000)
    .transform(w => [...new Set(w)]),
  pactbugs: z.array(z.object({ code: text(30, 2500), o: z.array(text(5, 220)).min(3).max(5), a: z.number().int().min(0), guide: text(20, 600) }).strict()
    .refine(x => x.a < x.o.length, 'a must point at one of the options')).min(3).max(500),
};
export function validateBank(kind, items) {
  if (!SCHEMAS[kind]) throw Object.assign(new Error(`Unknown bank: ${kind}`), { status: 400 });
  return SCHEMAS[kind].parse(items);
}

// A stable key per item, used to avoid showing a wallet the same item again soon.
export const itemKey = item => createHash('sha256').update(typeof item === 'string' ? item : (item.q || item.code)).digest('hex').slice(0, 16);

let cache = null, cachedAt = 0;
export function clearBankCache() { cache = null; }
export async function loadBanks(db) {
  if (cache && Date.now() - cachedAt < 60000) return cache;
  const rows = (await db.query('SELECT kind,items,updated_at FROM game_content')).rows;
  const custom = Object.fromEntries(rows.map(r => [r.kind, r]));
  const banks = {};
  for (const k of KINDS) banks[k] = custom[k]?.items?.length ? custom[k].items : BUILT_IN[k];
  cache = { banks, custom: Object.fromEntries(rows.map(r => [r.kind, { count: r.items.length, updated_at: r.updated_at }])) };
  cachedAt = Date.now();
  return cache;
}

// Picks n items, preferring ones this wallet has not seen recently (seen: Map key -> last seen time).
export function pickFresh(list, n, rand, seen = new Map()) {
  const idx = [...list.keys()];
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const at = i => seen.get(itemKey(list[i])) || 0;
  // Unseen first (shuffled), then the least recently seen.
  return idx.sort((a, b) => at(a) - at(b)).slice(0, n);
}
