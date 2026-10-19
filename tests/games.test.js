import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { Worker } from '../src/jobs.js';
import { ReviewAgent } from '../src/agent.js';
import { sign } from '../src/pact.js';
import { newRound, checkRound, GAMES } from '../src/games.js';
import { RIDDLES } from '../src/game-content.js';
import { emailKey, disposable } from '../src/games-api.js';
import { tilesGenerate, tilesCheck, logicGenerate, logicCheck, countSolutions, answerMatches } from '../public/games-core.js';
import { testDatabase, testKey, testConfig, TestChain, client } from './helpers.js';

test('Puzzles are solvable, unique and checked strictly', () => {
 for (let i = 0; i < 20; i++) {
   const { puzzle, solution } = logicGenerate(Math.random);
   assert.equal(countSolutions([...puzzle.givens]), 1);
   assert.equal(logicCheck(puzzle, solution).solved, true);
   const broken = [...solution]; const j = puzzle.givens.findIndex(v => !v); broken[j] = broken[j] % 6 + 1;
   assert.equal(logicCheck(puzzle, broken).solved, false);
 }
 const t = tilesGenerate(Math.random);
 assert.equal(t.board.length, 16); assert.deepEqual([...t.board].sort((a, b) => a - b), [...Array(16).keys()]);
 assert.equal(tilesCheck({ size: 4, board: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,0,15] }, [15]).solved, true);
 assert.equal(tilesCheck({ size: 4, board: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,0,15] }, [1]).solved, false);
 assert.equal(answerMatches('A keyboard!', ['keyboard']), true);
 assert.equal(answerMatches('candles', ['candle']), true);
 assert.equal(answerMatches('clock egg keyboard towel candle river', ['keyboard']), false);
 assert.equal(answerMatches('', ['egg']), false);
});

test('Quiz and riddle answers stay on the server and are graded there', () => {
 const q = newRound('quiz');
 assert.equal(q.puzzle.questions.length, 5); assert.ok(q.puzzle.written);
 assert.ok(!JSON.stringify(q.puzzle).includes('"a"'));
 const right = checkRound('quiz', q.puzzle, q.secret, { choices: q.secret.answers, written: 'A capability limits my signature to that one transfer, so it cannot be reused.' }, 120);
 assert.equal(right.solved, true); assert.equal(right.flags.length, 0); assert.match(right.review.written_answer, /capability/);
 const wrong = checkRound('quiz', q.puzzle, q.secret, { choices: q.secret.answers.map(a => (a + 1) % 4), written: 'x'.repeat(40) }, 120);
 assert.equal(wrong.solved, false); assert.match(wrong.message, /0 of 5/);
 const r = newRound('riddle');
 assert.equal(r.puzzle.riddles.length, 3); assert.ok(!JSON.stringify(r.puzzle).includes('answers'));
 const answers = r.secret.ids.map(id => RIDDLES[id].answers[0]);
 assert.equal(checkRound('riddle', r.puzzle, r.secret, { answers }, 60).solved, true);
 assert.equal(checkRound('riddle', r.puzzle, r.secret, { answers: ['no', 'no', 'no'] }, 60).solved, false);
 // Too fast for a person: still solved, but flagged for the owner.
 assert.equal(checkRound('riddle', r.puzzle, r.secret, { answers }, 3).flags.length, 1);
 assert.equal(emailKey('Jo.Hn.Doe+games@GoogleMail.com'), 'johndoe@gmail.com');
 assert.equal(emailKey('a.b+x@example.org'), 'a.b@example.org');
 assert.equal(disposable('x@mailinator.com'), true);
});

async function setup(schema) {
 const db = await testDatabase(schema), adminKey = testKey(), opsKey = testKey();
 const c = { ...testConfig(adminKey, opsKey), module: 'kadena-earn' };
 c.ai = { ...c.ai, apiKey: '', model: 'test-model', maxReward: '1', dailyKda: '10', perTick: 10 };
 const mail = []; c.sendMail = async m => { mail.push(m); };
 const chain = new TestChain(c), worker = new Worker(db, chain, c);
 const calls = []; let next = () => ({ decision: 'approve', confidence: 0.95, reasons: 'Fair play.', note_to_contributor: 'Well played.' });
 worker.agent = new ReviewAgent(db, chain, c, { review: async p => { calls.push(p); return next(p); } });
 const { app } = createApp(db, chain, c, worker); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
 const base = 'http://127.0.0.1:' + server.address().port; const owner = await client(base, adminKey);
 assert.equal((await owner.call('/admin/ai-review', { enabled: true })).status, 200);
 let n = 0;
 async function round(game, overrides = {}) {
   const r = await owner.call('/admin/campaigns', { title: `${GAMES[game].name} round for testing`, summary: 'Solve the puzzle and win KDA from escrow.', sponsor_name: 'Kadena Nexus Games',
     category: 'Testing', template: 'Try & Review', reward_kda: '5', max_rewards: 3, minutes_estimate: 5, deadline: new Date(Date.now() + 86400000).toISOString(),
     steps: ['x'], proof_schema: [{ key: 'x', label: 'X', type: 'text' }], game, ...overrides }, { 'idempotency-key': 'g-create-' + (++n) });
   assert.equal(r.status, 200, JSON.stringify(r.data)); const cid = r.data.campaign.id;
   const f = (await owner.call('/admin/campaigns/' + cid + '/funding-command', {})).data;
   assert.equal((await owner.call('/admin/campaigns/' + cid + '/confirm-funding', { signed_command: sign(f.command, adminKey.seed) }, { 'idempotency-key': 'g-fund-' + n })).status, 200);
   await worker.tick(); await worker.tick(); return cid;
 }
 async function player(email = `p${++n}@example.org`) {
   const u = await client(base, testKey());
   assert.equal((await u.call('/me/email', { email })).status, 200);
   const link = mail.at(-1).text.match(/https?:\/\/\S+/)[0];
   const confirm = await fetch(base + new URL(link).pathname + new URL(link).search, { redirect: 'manual' });
   assert.equal(confirm.status, 303); assert.match(confirm.headers.get('location'), /email=confirmed/);
   return u;
 }
 const secret = async sid => (await db.query('SELECT secret,puzzle FROM game_sessions WHERE id=$1', [sid])).rows[0];
 const ticks = async (k = 3) => { for (let i = 0; i < k; i++) await worker.tick(); };
 return { db, c, worker, owner, base, mail, calls, round, player, secret, ticks, setNext: f => { next = f; }, close: async () => { server.close(); await db.close(); } };
}

test('A logic grid win is reserved in escrow, reviewed and paid by the AI agent', async () => {
 const t = await setup('ke_games_win');
 try {
   const cid = await t.round('logic');
   const listed = (await t.owner.raw('/games')).data;
   assert.equal(listed.rounds.length, 1); assert.equal(listed.rounds[0].game, 'logic'); assert.equal(listed.rounds[0].cat, 'Games');
   assert.ok(!(await t.owner.raw('/tasks')).data.some(x => x.id === cid), 'game rounds stay off the task board');
   // Proof fields are server-written: the generic task endpoints refuse game rounds.
   const anyone = await t.player();
   assert.equal((await anyone.call('/tasks/' + cid + '/start', {})).status, 409);
   assert.equal((await anyone.call('/tasks/' + cid + '/submit', { proof: { result: 'I won', play: '{}' }, public_consent: true })).status, 409);

   // No confirmed email, no paid play.
   const stranger = await client(t.base, testKey());
   assert.equal((await stranger.call('/games/' + cid + '/play', {})).status, 403);

   const p = await t.player('Win.Ner+one@gmail.com');
   const s1 = (await p.call('/games/' + cid + '/play', {})).data;
   assert.equal(s1.attempts_left, 2); assert.ok(!('secret' in s1)); assert.ok(!JSON.stringify(s1).includes('solution'));
   const again = (await p.call('/games/' + cid + '/play', {})).data;
   assert.equal(again.id, s1.id, 'an unfinished round resumes instead of using another attempt');
   const miss = await p.call('/games/sessions/' + s1.id + '/finish', { play: { grid: Array(36).fill(1), entries: 30 } });
   assert.equal(miss.status, 200); assert.equal(miss.data.solved, false); assert.equal(miss.data.attempts_left, 2);

   const s2 = (await p.call('/games/' + cid + '/play', {})).data;
   const { secret: sec, puzzle } = await t.secret(s2.id);
   await t.db.query("UPDATE game_sessions SET started_at=now()-interval '3 minutes' WHERE id=$1", [s2.id]);
   const win = await p.call('/games/sessions/' + s2.id + '/finish', { play: { grid: sec.solution, entries: puzzle.givens.filter(v => !v).length + 4 } });
   assert.equal(win.status, 200, JSON.stringify(win.data)); assert.equal(win.data.solved, true); assert.match(win.data.summary, /Logic Grid in 3:0\d/);
   await t.ticks(4);
   const sub = (await t.db.query('SELECT s.status,s.ai_reviewed,s.proof_json,p.amount_kda FROM submissions s LEFT JOIN payouts p ON p.submission_id=s.id WHERE s.id=$1', [win.data.submission_id])).rows[0];
   assert.equal(sub.status, 'paid'); assert.equal(sub.ai_reviewed, true); assert.equal(Number(sub.amount_kda), 5, 'games have their own AI limit above the 1 KDA task limit');
   assert.equal(t.calls.length, 1); assert.match(t.calls[0].system, /Kadena Nexus Games/); assert.match(t.calls[0].user, /entries/);
   assert.ok(!t.calls[0].user.includes(JSON.stringify(sec.solution)), 'the agent judges play, it is not handed the answer grid');
   const work = (await t.owner.raw('/work')).data;
   assert.match(work[0].f, /Solved the 6×6 Logic Grid/);
   const receipt = (await t.owner.raw('/ai-receipts/' + win.data.submission_id)).data;
   assert.match(receipt.receipt, /"game": "logic"/);

   // One win per round, and one win per game per wallet per day.
   assert.equal((await p.call('/games/' + cid + '/play', {})).status, 409);
   const cid2 = await t.round('logic');
   const blocked = await p.call('/games/' + cid2 + '/play', {});
   assert.equal(blocked.status, 409); assert.match(blocked.data.error, /today/);
   const mine = (await p.call('/me/games')).data;
   assert.equal(mine.email_verified, true); assert.equal(mine.wins_today.logic, 1);

   // The same inbox (Gmail dots and +tags removed) cannot back a second wallet.
   const twin = await client(t.base, testKey());
   const dup = await twin.call('/me/email', { email: 'winner@gmail.com' });
   assert.equal(dup.status, 409);
   assert.equal((await twin.call('/me/email', { email: 'x@mailinator.com' })).status, 400);
 } finally { await t.close(); }
});

test('Bot-like play goes to the owner without the model, and attempts run out', async () => {
 const t = await setup('ke_games_bots');
 try {
   const cid = await t.round('tiles');
   const p = await t.player();
   const s = (await p.call('/games/' + cid + '/play', {})).data;
   await t.db.query("UPDATE game_sessions SET puzzle=$2 WHERE id=$1", [s.id, JSON.stringify({ size: 4, board: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,0,15] })]);
   const win = await p.call('/games/sessions/' + s.id + '/finish', { play: { moves: [15], times: [5] } });
   assert.equal(win.data.solved, true);
   await t.ticks(4);
   const sub = (await t.db.query('SELECT status FROM submissions WHERE id=$1', [win.data.submission_id])).rows[0];
   assert.equal(sub.status, 'in_review', 'flagged wins wait for the owner');
   const review = (await t.db.query('SELECT applied,skip_reason,reasons FROM ai_reviews WHERE submission_id=$1', [win.data.submission_id])).rows[0];
   assert.equal(review.skip_reason, 'bot_signals'); assert.match(review.reasons, /minimum/);
   assert.equal(t.calls.length, 0);

   // A model "request changes" on a game is turned into a hand-off to the owner.
   const quiz = await t.round('quiz');
   const q = await t.player();
   const qs = (await q.call('/games/' + quiz + '/play', {})).data;
   await t.db.query("UPDATE game_sessions SET started_at=now()-interval '2 minutes' WHERE id=$1", [qs.id]);
   const { secret: qsec } = await t.secret(qs.id);
   t.setNext(() => ({ decision: 'request_changes', confidence: 0.9, reasons: 'Thin answer.', note_to_contributor: 'Add more detail please.' }));
   const qw = await q.call('/games/sessions/' + qs.id + '/finish', { play: { choices: qsec.answers, written: 'Gas stations pay fees so new users can start without KDA.' } });
   assert.equal(qw.data.solved, true);
   await t.ticks(4);
   assert.equal((await t.db.query('SELECT skip_reason FROM ai_reviews WHERE submission_id=$1', [qw.data.submission_id])).rows[0].skip_reason, 'game_no_changes');

   // Three misses use up the round and free the reward slot.
   const riddles = await t.round('riddle');
   const r = await t.player();
   let last;
   for (let i = 0; i < 3; i++) {
     const rs = (await r.call('/games/' + riddles + '/play', {})).data;
     last = (await r.call('/games/sessions/' + rs.id + '/finish', { play: { answers: ['no', 'no', 'no'] } })).data;
   }
   assert.equal(last.attempts_left, 0);
   assert.equal((await r.call('/games/' + riddles + '/play', {})).status, 409);
   assert.equal((await t.db.query("SELECT state FROM task_starts t JOIN users u ON u.id=t.user_id WHERE t.campaign_id=$1", [riddles])).rows[0].state, 'out_of_attempts');
 } finally { await t.close(); }
});
