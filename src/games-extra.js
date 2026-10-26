// Daily Challenge, streaks, weekly leaderboard and bonus pools for Kadena Nexus Games.
//
// Daily Challenge: one Sliding Tiles board per UTC day, the same for everyone,
// generated from the date and a server secret (so tomorrow's board cannot be
// worked out in advance). One try per wallet per day, free to play. Ranked by
// fewest moves, then fastest time; runs with bot-like flags are not ranked.
//
// Bonus pools are hidden, funded escrow campaigns (bonus_kind 'challenge' or
// 'streak'). After each day the server reserves a bonus in escrow for the top 3
// of the Daily Challenge, and for wallets that reach a 7-day playing streak.
// Each bonus then waits in the owner's Admin queue (the AI agent does not
// review bonuses). A wallet can receive one bonus per pool.
import { randomUUID, createHmac } from 'node:crypto';
import { z } from 'zod';
import { authenticated } from './auth.js';
import { audit } from './db.js';
import { quote } from './pact.js';
import { requireValue } from './validation.js';
import { enqueue, pauseState } from './jobs.js';
import { campaignQuery, taskView } from './api.js';
import { checkRound } from './games.js';
import { tilesGenerate } from '../public/games-core.js';

export const STREAK_DAYS = 7;
const PLACES = 3;
const CHALLENGE_MINUTES = 15;
const short = a => `${a.slice(0, 10)}…${a.slice(-6)}`;
const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const addDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return utcDay(d); };
const clock = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const prettyDay = day => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Seeded random numbers (mulberry32) from HMAC(secret, day).
function seeded(secret, day) {
  let a = createHmac('sha256', secret || 'kadena-nexus-games').update(`challenge:${day}`).digest().readUInt32LE(0);
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const challengeRand = (c, day) => seeded(c.opsSecret, day);
export const challengeBoard = (c, day) => tilesGenerate(challengeRand(c, day), { steps: 80 });

// Days (UTC) on which a wallet won a game (a solved round) or solved the Daily Challenge cleanly.
// Missed, expired or flagged tries do not count, so a streak cannot be built by losing on purpose.
async function activeDays(db, uid, since = 60) {
  // Dates come back as text so the server's own time zone can never shift a day.
  const rows = (await db.query(`SELECT DISTINCT d::text AS d FROM (
      SELECT (finished_at AT TIME ZONE 'UTC')::date d FROM game_sessions WHERE user_id=$1 AND status='solved' AND finished_at>now()-make_interval(days=>$2::int)
      UNION SELECT day FROM challenge_entries WHERE user_id=$1 AND moves IS NOT NULL AND coalesce(jsonb_array_length(flags),0)=0 AND day>(now() AT TIME ZONE 'UTC')::date-$2::int) x`, [uid, since])).rows;
  return new Set(rows.map(r => r.d));
}
// Current streak counts back from today, or from yesterday if today is not played yet.
export async function streakOf(db, uid) {
  const days = await activeDays(db, uid), today = utcDay();
  let day = days.has(today) ? today : addDays(today, -1), n = 0;
  while (days.has(day)) { n++; day = addDays(day, -1); }
  return { current: n, played_today: days.has(today) };
}

// Bonuses go only to wallets with at least one paid game win (reviewed and paid from escrow),
// and a confirmed email when the server requires one: free throwaway wallets cannot farm bonus pools.
async function eligible(tx, c, uid) {
  const r = (await tx.query(`SELECT u.email_verified_at, EXISTS (SELECT 1 FROM submissions s JOIN task_campaigns k ON k.id=s.campaign_id JOIN payouts p ON p.submission_id=s.id
      WHERE s.user_id=u.id AND k.game IS NOT NULL AND p.status='confirmed') AS won FROM users u WHERE u.id=$1`, [uid])).rows[0];
  return !!r?.won && (!c.games?.requireEmail || !!r.email_verified_at);
}

async function openPool(tx, kind) {
  const r = (await tx.query(`${campaignQuery} WHERE c.bonus_kind=$1 AND c.status='open' AND c.deadline>now() ORDER BY c.created_at LIMIT 1`, [kind])).rows[0];
  if (!r) return null;
  const v = taskView(r);
  return v.left > 0 ? { row: r, reward: r.reward_kda, left: v.left } : null;
}

// Reserves one bonus for a wallet in a pool, like a game win: the submission waits in Admin once the reservation confirms.
async function reserveBonus(tx, chain, c, pool, user, result, detail) {
  if ((await tx.query('SELECT 1 FROM submissions WHERE campaign_id=$1 AND user_id=$2', [pool.row.id, user.id])).rowCount) return null;
  const subId = randomUUID();
  await tx.query(`INSERT INTO submissions(id,campaign_id,user_id,proof_json,public_consent,status) VALUES($1,$2,$3,$4,true,'reserving')`,
    [subId, pool.row.id, user.id, JSON.stringify({ result, play: JSON.stringify(detail) })]);
  await enqueue(tx, { key: `reserve:${subId}:${randomUUID()}`, kind: 'reserve', campaign: pool.row.id, submission: subId, actor: null,
    command: chain.ops(`(${c.module}.reserve-claim ${quote(pool.row.pact_campaign_id)} ${quote(subId)} ${quote(user.kadena_account)})`, { 'recipient-keyset': { keys: [user.kadena_account.slice(2)], pred: 'keys-all' } }) });
  await audit(tx, null, 'bonus_reserved', 'submission', subId, { pool: Number(pool.row.id), kind: pool.row.bonus_kind, user: Number(user.id) });
  return subId;
}

async function ranking(db, day, limit = 10) {
  return (await db.query(`SELECT e.user_id,e.moves,e.seconds,u.kadena_account FROM challenge_entries e JOIN users u ON u.id=e.user_id
    WHERE e.day=$1 AND e.finished_at IS NOT NULL AND e.moves IS NOT NULL AND coalesce(jsonb_array_length(e.flags),0)=0
    ORDER BY e.moves, e.seconds, e.finished_at LIMIT $2`, [day, limit])).rows;
}

// Runs from the worker about once a minute: settles finished challenge days and streak bonuses.
export class GamesDaily {
  constructor(db, chain, c) { this.db = db; this.chain = chain; this.c = c; }
  async run() {
    if (!this.c.writes || !this.c.module) return { days: 0, streaks: 0 };
    let days = 0, streaks = 0;
    // Reservations queued while payouts are paused simply wait (the worker does not send them), so this
    // does not take the pause-row lock that every play request uses; one runner at a time via an advisory lock.
    if ((await pauseState(this.db)).paused) return { days: 0, streaks: 0 };
    const scanStreaks = Date.now() - (this.streakAt || 0) >= 10 * 60000;
    if (scanStreaks) this.streakAt = Date.now();
    await this.db.tx(async tx => {
      await tx.query('SELECT pg_advisory_xact_lock(827127)');
      const today = utcDay();
      // Challenge days that have ended and are not settled yet (last 7 days).
      const open = (await tx.query(`SELECT DISTINCT e.day::text AS day FROM challenge_entries e LEFT JOIN challenge_days d ON d.day=e.day
        WHERE d.day IS NULL AND e.day<$1::date AND e.day>=$1::date-7 ORDER BY 1`, [today])).rows.map(r => r.day);
      for (const day of open) {
        const pool = await openPool(tx, 'challenge'), winners = [];
        const ranked = await ranking(tx, day, 25);
        let place = 0;
        for (const e of ranked) {
          if (place >= PLACES) break;
          if (!(await eligible(tx, this.c, e.user_id))) continue;
          place++;
          const entry = { place, who: short(e.kadena_account), moves: e.moves, seconds: Math.round(e.seconds) };
          if (pool && pool.left > 0) {
            const sub = await reserveBonus(tx, this.chain, this.c, pool, { id: e.user_id, kadena_account: e.kadena_account },
              `#${place} in the Daily Challenge for ${prettyDay(day)}: ${e.moves} moves in ${clock(e.seconds)}.`,
              { bonus: 'daily_challenge', day, place, moves: e.moves, seconds: Math.round(e.seconds) });
            if (sub) { entry.bonus_kda = pool.reward; pool.left--; }
          }
          winners.push(entry);
        }
        await tx.query('INSERT INTO challenge_days(day,winners) VALUES($1,$2) ON CONFLICT(day) DO NOTHING', [day, JSON.stringify(winners)]);
        days++;
      }
      // Streak bonuses: wallets active yesterday or today with a streak of 7+ and no bonus from the open pool yet.
      const pool = scanStreaks ? await openPool(tx, 'streak') : null;
      if (pool) {
        const users = (await tx.query(`SELECT DISTINCT u.id,u.kadena_account FROM users u WHERE u.id IN (
            SELECT user_id FROM game_sessions WHERE finished_at>now()-interval '2 days'
            UNION SELECT user_id FROM challenge_entries WHERE finished_at>now()-interval '2 days')
          AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.campaign_id=$1 AND s.user_id=u.id)`, [pool.row.id])).rows;
        for (const u of users) {
          if (pool.left < 1) break;
          const s = await streakOf(tx, u.id);
          if (s.current < STREAK_DAYS || !(await eligible(tx, this.c, u.id))) continue;
          if (await reserveBonus(tx, this.chain, this.c, pool, u, `Played Kadena Nexus Games ${s.current} days in a row.`, { bonus: 'streak', days: s.current })) { pool.left--; streaks++; }
        }
      }
    });
    return { days, streaks };
  }
}

export function extraRoutes(app, db, chain, c) {
  const assertWrites = () => requireValue(c.writes, 503, 'Blockchain writes are disabled until deployment and review are ready');
  const nextDay = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return d.toISOString(); };
  async function pools() {
    const out = {};
    for (const kind of ['challenge', 'streak']) { const p = await openPool(db, kind); out[kind] = p ? { reward: p.reward, left: p.left } : null; }
    return out;
  }

  // Today's challenge: leaderboard, your entry, yesterday's winners and the bonus on offer.
  app.get('/api/games/challenge', async (req, res) => {
    const today = utcDay(), yesterday = addDays(today, -1);
    const top = (await ranking(db, today)).map((e, i) => ({ place: i + 1, who: short(e.kadena_account), moves: e.moves, seconds: Math.round(e.seconds) }));
    const players = Number((await db.query('SELECT count(*) n FROM challenge_entries WHERE day=$1 AND finished_at IS NOT NULL', [today])).rows[0].n);
    const done = (await db.query('SELECT winners FROM challenge_days WHERE day=$1', [yesterday])).rows[0];
    let mine = null;
    if (req.user) {
      const e = (await db.query('SELECT * FROM challenge_entries WHERE day=$1 AND user_id=$2', [today, req.user.id])).rows[0];
      if (e) {
        const place = e.finished_at && e.moves != null && !(e.flags || []).length
          ? Number((await db.query(`SELECT count(*) n FROM challenge_entries WHERE day=$1 AND finished_at IS NOT NULL AND coalesce(jsonb_array_length(flags),0)=0
              AND (moves<$2 OR (moves=$2 AND seconds<$3))`, [today, e.moves, e.seconds])).rows[0].n) + 1 : null;
        mine = { started: true, finished: !!e.finished_at, solved: e.moves != null, moves: e.moves, seconds: e.seconds == null ? null : Math.round(e.seconds), place, flagged: !!(e.flags || []).length,
          active: !e.finished_at && Date.parse(e.started_at) + CHALLENGE_MINUTES * 60000 > Date.now(), started_at: e.started_at };
      }
    }
    res.json({ day: today, ends_at: nextDay(), places: PLACES, top, players, yesterday: done ? done.winners : null, pool: (await pools()).challenge, mine });
  });

  app.post('/api/games/challenge/start', authenticated, async (req, res) => {
    assertWrites();
    const today = utcDay();
    const e = (await db.query(`INSERT INTO challenge_entries(day,user_id) VALUES($1,$2) ON CONFLICT(day,user_id) DO UPDATE SET day=excluded.day RETURNING *`, [today, req.user.id])).rows[0];
    requireValue(!e.finished_at, 409, "You already played today's challenge. A new board opens at 03:00 Riyadh (00:00 UTC).");
    const expires = new Date(Date.parse(e.started_at) + CHALLENGE_MINUTES * 60000);
    requireValue(expires > new Date(), 409, "Your time for today's challenge ran out. A new board opens tomorrow.");
    res.json({ day: today, puzzle: challengeBoard(c, today), started_at: e.started_at, expires_at: expires.toISOString() });
  });

  app.post('/api/games/challenge/finish', authenticated, async (req, res) => {
    assertWrites();
    const { play } = z.object({ play: z.record(z.string(), z.unknown()) }).strict().parse(req.body || {});
    res.json(await db.tx(async tx => {
      // The entry is found by start time, not today's date, so a try started just before 00:00 UTC still counts for its own day.
      const e = (await tx.query(`SELECT *,day::text AS dayk,extract(epoch FROM now()-started_at)::float AS secs FROM challenge_entries
        WHERE user_id=$1 AND finished_at IS NULL AND started_at>now()-make_interval(mins=>$2::int) ORDER BY started_at DESC LIMIT 1 FOR UPDATE`, [req.user.id, CHALLENGE_MINUTES + 1])).rows[0];
      requireValue(e, 404, "Start today's challenge first");
      const today = e.dayk;
      if (e.secs > CHALLENGE_MINUTES * 60) {
        await tx.query('UPDATE challenge_entries SET finished_at=now() WHERE day=$1 AND user_id=$2', [today, req.user.id]);
        return { solved: false, message: 'Time ran out for today\'s challenge.' };
      }
      const r = checkRound('tiles', challengeBoard(c, today), {}, play, e.secs);
      if (!r.solved) return { solved: false, message: r.message, retry: true };
      await tx.query('UPDATE challenge_entries SET finished_at=now(),moves=$3,seconds=$4,flags=$5 WHERE day=$1 AND user_id=$2',
        [today, req.user.id, r.review.moves, e.secs, JSON.stringify(r.flags)]);
      await audit(tx, req.user.id, 'challenge_finished', 'challenge', today, { moves: r.review.moves, seconds: Math.round(e.secs), flags: r.flags.length });
      const place = r.flags.length ? null : Number((await tx.query(`SELECT count(*) n FROM challenge_entries WHERE day=$1 AND finished_at IS NOT NULL AND coalesce(jsonb_array_length(flags),0)=0
        AND (moves<$2 OR (moves=$2 AND seconds<$3))`, [today, r.review.moves, e.secs])).rows[0].n) + 1;
      return { solved: true, moves: r.review.moves, seconds: Math.round(e.secs), place, flagged: !!r.flags.length };
    }));
  });

  // Streak and bonuses for the signed-in wallet.
  app.get('/api/me/streak', authenticated, async (req, res) => {
    const s = await streakOf(db, req.user.id);
    const bonuses = (await db.query(`SELECT s.id,s.status,s.proof_json->>'result' result,c.reward_kda,c.bonus_kind,p.request_key tx FROM submissions s JOIN task_campaigns c ON c.id=s.campaign_id
      LEFT JOIN payouts p ON p.submission_id=s.id WHERE s.user_id=$1 AND c.bonus_kind IS NOT NULL ORDER BY s.submitted_at DESC LIMIT 20`, [req.user.id])).rows;
    res.json({ ...s, goal: STREAK_DAYS, pool: (await pools()).streak, bonuses });
  });

  // This week's top players (since Monday 00:00 UTC), by KDA won in games and bonuses, and last week's top 3
  // (shown while the new week has no wins yet, so the board never just disappears on Monday).
  const weekTop = (from, to, limit) => db.query(`SELECT u.kadena_account, count(*) FILTER (WHERE c.game IS NOT NULL) wins, sum(p.amount_kda) kda, bool_or(p.paid_at>now()-interval '24 hours') hot
      FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN task_campaigns c ON c.id=s.campaign_id JOIN users u ON u.id=s.user_id
      WHERE p.status='confirmed' AND (c.game IS NOT NULL OR c.bonus_kind IS NOT NULL)
        AND p.paid_at>=(date_trunc('week', now() AT TIME ZONE 'UTC') - make_interval(days => $1::int)) AT TIME ZONE 'UTC'
        AND p.paid_at<(date_trunc('week', now() AT TIME ZONE 'UTC') - make_interval(days => $2::int)) AT TIME ZONE 'UTC'
      GROUP BY u.kadena_account ORDER BY sum(p.amount_kda) DESC, count(*) DESC LIMIT $3`, [from, to, limit]).then((r) => r.rows);
  app.get('/api/games/leaderboard', async (req, res) => {
    const [rows, prev] = await Promise.all([weekTop(0, -7, 10), weekTop(7, 0, 3)]);
    const mine = req.user?.kadena_account;
    const view = (r, i) => ({ place: i + 1, who: short(r.kadena_account), wins: Number(r.wins), kda: r.kda, hot: !!r.hot, you: r.kadena_account === mine });
    res.json({ since: new Date(new Date().setUTCHours(0, 0, 0, 0) - ((new Date().getUTCDay() + 6) % 7) * 86400000).toISOString(),
      top: rows.map(view), last: prev.map((r, i) => ({ ...view(r, i), hot: false })) });
  });
}
