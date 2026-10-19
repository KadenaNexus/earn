// Kadena Nexus Games API. A game round is a funded Earn campaign; a win goes
// through the same escrow reservation, AI review and payout as any task.
//
// What stops a prize pool being farmed (in order):
//  1. Optional (GAMES_REQUIRE_EMAIL): confirmed email, one inbox per wallet (normalized, disposable domains refused).
//  2. One win per wallet per game per 24 hours, a few attempts per round,
//     one reward per wallet per round (escrow and database both enforce it).
//  3. Puzzles are generated and checked on the server; answers never reach the
//     browser; time is measured by the server.
//  4. The AI agent reviews how each win was played, with its own daily KDA
//     budget; anything with bot-like signals goes to the owner instead.
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { authenticated } from './auth.js';
import { audit } from './db.js';
import { quote } from './pact.js';
import { requireValue } from './validation.js';
import { enqueue, pauseState } from './jobs.js';
import { campaignQuery, taskView } from './api.js';
import { GAMES, GAME_KINDS, newRound, checkRound } from './games.js';

const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', 'temp-mail.org', 'tempmail.com', 'tempmail.net',
  'yopmail.com', 'trashmail.com', 'getnada.com', 'dispostable.com', 'maildrop.cc', 'fakeinbox.com', 'throwawaymail.com', 'mintemail.com', 'emailondeck.com', 'moakt.com', 'mohmal.com', 'tempail.com', 'burnermail.io', 'mailnesia.com', 'spamgourmet.com', 'tmpmail.org', 'tmail.ws']);
export function emailKey(email) {
  const [local, domain] = String(email).toLowerCase().trim().split('@');
  const d = domain === 'googlemail.com' ? 'gmail.com' : domain;
  let l = local.split('+')[0];
  if (d === 'gmail.com') l = l.replace(/\./g, '');
  return `${l}@${d}`;
}
export const disposable = email => DISPOSABLE.has(String(email).toLowerCase().split('@')[1]);
const digest = v => createHash('sha256').update(v).digest('hex');

export function resendSender(mail, fetchImpl = fetch) {
  return async ({ to, subject, text, html }) => {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${mail.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: mail.from, to: [to], subject, text, html }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(`Email service ${res.status}: ${b.message || 'send failed'}`); }
  };
}

const sessionView = (s, attemptsLeft) => ({ id: s.id, campaign_id: Number(s.campaign_id), game: s.game, puzzle: s.puzzle, started_at: s.started_at, expires_at: s.expires_at, status: s.status, attempts_left: attemptsLeft });
const roundView = r => ({ ...taskView(r), game: r.game, game_name: GAMES[r.game]?.name, minutes: GAMES[r.game]?.minutes });

export function gameRoutes(app, db, chain, c, { sendMail } = {}) {
  const mailer = sendMail || (c.mail?.resendKey ? resendSender(c.mail) : null);
  const assertWrites = () => requireValue(c.writes, 503, 'Blockchain writes are disabled until deployment and review are ready');
  const assertRunning = async tx => requireValue(!(await pauseState(tx, { lock: true })).paused, 409, 'Payouts are paused right now. Try again later.');
  const attemptsUsed = async (tx, cid, uid) => Number((await tx.query('SELECT count(*) n FROM game_sessions WHERE campaign_id=$1 AND user_id=$2', [cid, uid])).rows[0].n);
  const winsToday = async (tx, uid, game) => Number((await tx.query(`SELECT count(*) n FROM submissions s JOIN task_campaigns c ON c.id=s.campaign_id
    WHERE s.user_id=$1 AND c.game=$2 AND s.submitted_at>now()-interval '24 hours' AND s.status NOT IN ('rejected','reservation_failed')`, [uid, game])).rows[0].n);

  app.get('/api/games', async (req, res) => {
    const rows = (await db.query(`${campaignQuery} WHERE c.status='open' AND NOT c.hidden AND c.game IS NOT NULL AND c.deadline>now() ORDER BY c.created_at DESC`)).rows;
    const paid = (await db.query(`SELECT count(*) wins, coalesce(sum(p.amount_kda),0) kda FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN task_campaigns c ON c.id=s.campaign_id WHERE p.status='confirmed' AND c.game IS NOT NULL`)).rows[0];
    const recent = (await db.query(`SELECT p.amount_kda reward,p.request_key tx,c.game,s.ai_reviewed ai,CASE WHEN s.ai_reviewed THEN s.id END receipt,u.kadena_account,p.paid_at
      FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN task_campaigns c ON c.id=s.campaign_id JOIN users u ON u.id=s.user_id
      WHERE p.status='confirmed' AND c.game IS NOT NULL ORDER BY p.paid_at DESC LIMIT 8`)).rows
      .map(({ kadena_account, ...r }) => ({ ...r, who: `${kadena_account.slice(0, 10)}…${kadena_account.slice(-6)}` }));
    res.json({
      games: GAME_KINDS.map(k => ({ id: k, ...GAMES[k] })), rounds: rows.map(roundView), stats: paid, recent,
      rules: { email_required: !!c.games.requireEmail, email_ready: !!mailer, writes: c.writes, wins_per_day: c.games.winsPerDay, attempts: c.games.attempts, ai_max_reward_kda: c.games.maxReward },
    });
  });

  app.get('/api/me/games', authenticated, async (req, res) => {
    const u = (await db.query('SELECT email,email_verified_at FROM users WHERE id=$1', [req.user.id])).rows[0];
    const pending = (await db.query('SELECT email FROM email_tokens WHERE user_id=$1 AND used_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [req.user.id])).rows[0];
    const wins = {};
    for (const g of GAME_KINDS) wins[g] = await winsToday(db, req.user.id, g);
    const rounds = (await db.query(`SELECT c.id campaign_id,c.game,
        (SELECT count(*) FROM game_sessions g WHERE g.campaign_id=c.id AND g.user_id=$1) attempts_used,
        (SELECT g.id FROM game_sessions g WHERE g.campaign_id=c.id AND g.user_id=$1 AND g.status='playing' AND g.expires_at>now() LIMIT 1) active_session,
        s.id submission_id,s.status,s.review_note,p.request_key tx
      FROM task_campaigns c LEFT JOIN submissions s ON s.campaign_id=c.id AND s.user_id=$1 LEFT JOIN payouts p ON p.submission_id=s.id
      WHERE c.game IS NOT NULL AND (s.id IS NOT NULL OR EXISTS(SELECT 1 FROM game_sessions g WHERE g.campaign_id=c.id AND g.user_id=$1))
      ORDER BY c.id DESC LIMIT 100`, [req.user.id])).rows;
    res.json({ email: u.email_verified_at ? u.email : null, email_verified: !!u.email_verified_at, pending_email: pending?.email || null, wins_today: wins, rounds });
  });

  app.post('/api/me/email', authenticated, async (req, res) => {
    const { email } = z.object({ email: z.email().max(254) }).strict().parse(req.body || {});
    requireValue(mailer, 503, 'Email confirmation is not set up on the server yet');
    requireValue(!disposable(email), 400, 'Use a permanent email address, not a temporary inbox');
    const key = emailKey(email);
    const token = randomBytes(32).toString('base64url');
    await db.tx(async tx => {
      const me = (await tx.query('SELECT email_key FROM users WHERE id=$1 FOR UPDATE', [req.user.id])).rows[0];
      requireValue(me.email_key !== key, 409, 'This email is already confirmed for your wallet');
      requireValue(!(await tx.query('SELECT 1 FROM users WHERE email_key=$1 AND id<>$2', [key, req.user.id])).rowCount, 409, 'This email is already confirmed for another wallet. Each email can back one wallet.');
      requireValue(Number((await tx.query("SELECT count(*) n FROM email_tokens WHERE user_id=$1 AND created_at>now()-interval '1 hour'", [req.user.id])).rows[0].n) < 3, 429, 'Too many confirmation emails. Try again in an hour.');
      requireValue(Number((await tx.query("SELECT count(*) n FROM email_tokens WHERE email_key=$1 AND created_at>now()-interval '24 hours'", [key])).rows[0].n) < 5, 429, 'Too many confirmation emails to this address today.');
      await tx.query("INSERT INTO email_tokens(token_hash,user_id,email,email_key,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours')", [digest(token), req.user.id, email.trim(), key]);
      await audit(tx, req.user.id, 'email_requested', 'user', req.user.id, { domain: key.split('@')[1] });
    });
    const link = `${c.origin}/api/email/confirm?token=${token}`;
    try {
      await mailer({
        to: email.trim(), subject: 'Confirm your email for Kadena Earn games',
        text: `Confirm this email to play Kadena Nexus Games for KDA with wallet ${req.user.kadena_account}:\n\n${link}\n\nThe link works for 24 hours. If you did not ask for this, ignore this email.`,
        html: `<p>Confirm this email to play Kadena Nexus Games for KDA with wallet <code>${req.user.kadena_account.slice(0, 10)}…${req.user.kadena_account.slice(-6)}</code>.</p><p><a href="${link}">Confirm my email</a></p><p>The link works for 24 hours. If you did not ask for this, ignore this email.</p>`,
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'email_send_error', error: error.message }));
      requireValue(false, 502, 'The confirmation email could not be sent. Try again in a few minutes.');
    }
    res.json({ sent: true, email: email.trim() });
  });

  app.get('/api/email/confirm', async (req, res) => {
    const token = String(req.query.token || '');
    let outcome = 'invalid';
    if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
      outcome = await db.tx(async tx => {
        const t = (await tx.query('SELECT * FROM email_tokens WHERE token_hash=$1 FOR UPDATE', [digest(token)])).rows[0];
        if (!t || t.used_at || new Date(t.expires_at) < new Date()) return 'invalid';
        if ((await tx.query('SELECT 1 FROM users WHERE email_key=$1 AND id<>$2', [t.email_key, t.user_id])).rowCount) return 'taken';
        await tx.query('UPDATE email_tokens SET used_at=now() WHERE token_hash=$1', [t.token_hash]);
        await tx.query('UPDATE users SET email=$2,email_key=$3,email_verified_at=now() WHERE id=$1', [t.user_id, t.email, t.email_key]);
        await audit(tx, t.user_id, 'email_confirmed', 'user', t.user_id, { domain: t.email_key.split('@')[1] });
        return 'confirmed';
      });
    }
    res.redirect(303, `/games.html?email=${outcome}`);
  });

  app.post('/api/games/:id/play', authenticated, async (req, res) => {
    const cid = z.coerce.number().int().positive().parse(req.params.id); assertWrites();
    res.json(await db.tx(async tx => {
      await assertRunning(tx);
      const me = (await tx.query('SELECT email_verified_at FROM users WHERE id=$1', [req.user.id])).rows[0];
      requireValue(!c.games.requireEmail || me.email_verified_at, 403, 'Confirm your email to play for KDA');
      const row = (await tx.query('SELECT * FROM task_campaigns WHERE id=$1 FOR UPDATE', [cid])).rows[0];
      requireValue(row?.game, 404, 'Game round not found');
      requireValue(row.status === 'open' && Date.parse(row.deadline) > Date.now() && !row.hidden, 409, 'This round is closed');
      const mine = (await tx.query('SELECT status FROM submissions WHERE campaign_id=$1 AND user_id=$2', [cid, req.user.id])).rows[0];
      requireValue(!mine || mine.status === 'reservation_failed', 409, 'You already won this round');
      const used = await attemptsUsed(tx, cid, req.user.id);
      const active = (await tx.query("SELECT * FROM game_sessions WHERE campaign_id=$1 AND user_id=$2 AND status='playing' AND expires_at>now() ORDER BY started_at DESC LIMIT 1", [cid, req.user.id])).rows[0];
      if (active) return sessionView(active, c.games.attempts - used);
      requireValue(used < c.games.attempts, 409, `You have used all ${c.games.attempts} attempts in this round`);
      requireValue(await winsToday(tx, req.user.id, row.game) < c.games.winsPerDay, 409, `You already won ${GAMES[row.game].name} today. Come back tomorrow.`);
      // Hold a reward slot exactly like a task start (30 minutes, bounded by the deadline).
      let start = (await tx.query('SELECT * FROM task_starts WHERE campaign_id=$1 AND user_id=$2 FOR UPDATE', [cid, req.user.id])).rows[0];
      if (!(start?.state === 'started' && Date.parse(start.expires_at) > Date.now())) {
        const occupied = Number((await tx.query(`SELECT (SELECT count(*) FROM submissions WHERE campaign_id=$1 AND status NOT IN ('rejected','reservation_failed'))+(SELECT count(*) FROM task_starts WHERE campaign_id=$1 AND state='started' AND expires_at>now()) AS n`, [cid])).rows[0].n);
        const chainOccupied = row.chain_snapshot ? Number(row.chain_snapshot['paid-count']) + Number(row.chain_snapshot['reserved-count']) : 0;
        requireValue(Math.max(occupied, chainOccupied) < row.max_rewards, 409, 'All rewards in this round are taken or being played. Try again soon.');
        start = (await tx.query(`INSERT INTO task_starts(campaign_id,user_id,expires_at) VALUES($1,$2,least(now()+interval '30 minutes',$3)) ON CONFLICT(campaign_id,user_id) DO UPDATE SET state='started',started_at=now(),expires_at=excluded.expires_at RETURNING *`, [cid, req.user.id, row.deadline])).rows[0];
      }
      const round = newRound(row.game);
      const s = (await tx.query(`INSERT INTO game_sessions(id,campaign_id,user_id,game,puzzle,secret,expires_at) VALUES($1,$2,$3,$4,$5,$6,least(now()+make_interval(mins=>$7::int),$8)) RETURNING *`,
        [randomUUID(), cid, req.user.id, row.game, JSON.stringify(round.puzzle), JSON.stringify(round.secret), GAMES[row.game].minutes, start.expires_at])).rows[0];
      await audit(tx, req.user.id, 'game_start', 'game_session', s.id, { campaign: cid, game: row.game, attempt: used + 1 });
      return sessionView(s, c.games.attempts - used - 1);
    }));
  });

  app.get('/api/games/sessions/:sid', authenticated, async (req, res) => {
    const s = (await db.query('SELECT * FROM game_sessions WHERE id=$1 AND user_id=$2', [z.uuid().parse(req.params.sid), req.user.id])).rows[0];
    requireValue(s, 404, 'Round not found');
    res.json(sessionView(s, c.games.attempts - await attemptsUsed(db, s.campaign_id, req.user.id)));
  });

  app.post('/api/games/sessions/:sid/finish', authenticated, async (req, res) => {
    const sid = z.uuid().parse(req.params.sid); assertWrites();
    const { play } = z.object({ play: z.record(z.string(), z.unknown()) }).strict().parse(req.body || {});
    res.json(await db.tx(async tx => {
      await assertRunning(tx);
      const s = (await tx.query("SELECT *,extract(epoch FROM now()-started_at)::float AS seconds,expires_at<now() AS late FROM game_sessions WHERE id=$1 AND user_id=$2 FOR UPDATE", [sid, req.user.id])).rows[0];
      requireValue(s, 404, 'Round not found');
      requireValue(s.status === 'playing', 409, 'This round is already finished');
      const campaign = (await tx.query('SELECT * FROM task_campaigns WHERE id=$1 FOR UPDATE', [s.campaign_id])).rows[0];
      const left = c.games.attempts - await attemptsUsed(tx, s.campaign_id, req.user.id);
      const out = async message => {
        if (left <= 0) await tx.query("UPDATE task_starts SET state='out_of_attempts' WHERE campaign_id=$1 AND user_id=$2 AND state='started'", [s.campaign_id, req.user.id]);
        return { solved: false, message, attempts_left: left };
      };
      if (s.late) {
        await tx.query("UPDATE game_sessions SET status='expired',finished_at=now() WHERE id=$1", [sid]);
        return out('Time ran out for this puzzle.');
      }
      const r = checkRound(s.game, s.puzzle, s.secret, play, s.seconds);
      if (!r.solved) {
        await tx.query("UPDATE game_sessions SET status='failed',finished_at=now(),play=$2,result=$3 WHERE id=$1", [sid, JSON.stringify(play), JSON.stringify({ message: r.message })]);
        await audit(tx, req.user.id, 'game_failed', 'game_session', sid, { message: r.message });
        return out(r.message);
      }
      requireValue(campaign.status === 'open' && Date.parse(campaign.deadline) > Date.now(), 409, 'This round closed before you finished');
      const start = (await tx.query('SELECT * FROM task_starts WHERE campaign_id=$1 AND user_id=$2 FOR UPDATE', [s.campaign_id, req.user.id])).rows[0];
      requireValue(start?.state === 'started' && Date.parse(start.expires_at) > Date.now(), 409, 'Your reward slot expired. Start the round again.');
      const proof = { result: r.summary, play: JSON.stringify({ ...r.review, flags: r.flags }) };
      const prior = (await tx.query('SELECT id FROM submissions WHERE campaign_id=$1 AND user_id=$2', [s.campaign_id, req.user.id])).rows[0];
      const subId = prior?.id || randomUUID();
      await tx.query(`INSERT INTO submissions(id,campaign_id,user_id,proof_json,public_consent,status) VALUES($1,$2,$3,$4,true,'reserving') ON CONFLICT(campaign_id,user_id) DO UPDATE SET proof_json=excluded.proof_json,public_consent=true,status='reserving',submitted_at=now(),review_note=NULL`, [subId, s.campaign_id, req.user.id, JSON.stringify(proof)]);
      await tx.query("UPDATE task_starts SET state='submitted' WHERE id=$1", [start.id]);
      await tx.query("UPDATE game_sessions SET status='solved',finished_at=now(),play=$2,result=$3,submission_id=$4 WHERE id=$1", [sid, JSON.stringify(play), JSON.stringify({ summary: r.summary, flags: r.flags }), subId]);
      await enqueue(tx, { key: `reserve:${subId}:${randomUUID()}`, kind: 'reserve', campaign: s.campaign_id, submission: subId, actor: req.user.id,
        command: chain.ops(`(${c.module}.reserve-claim ${quote(campaign.pact_campaign_id)} ${quote(subId)} ${quote(req.user.kadena_account)})`, { 'recipient-keyset': { keys: [req.user.kadena_account.slice(2)], pred: 'keys-all' } }) });
      await audit(tx, req.user.id, 'game_won', 'submission', subId, { session: sid, game: s.game, flags: r.flags.length });
      return { solved: true, summary: r.summary, submission_id: subId, status: 'reserving', reward: campaign.reward_kda };
    }));
  });
}
