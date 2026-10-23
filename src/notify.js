// Telegram alerts for Kadena Nexus Games: new rounds, wins paid on Chainweb,
// and the daily prize release. Settings (bot token, chat) are entered by the
// owner in the Games page and kept in the settings table, so nothing has to be
// changed on the server. Alerts are best-effort: a Telegram error never stops
// the worker, payouts or reviews.
import { GAMES } from './games.js';

const KEY = 'telegram', CURSOR = 'telegram_cursor';
const short = a => `${a.slice(0, 10)}…${a.slice(-6)}`;
const kda = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 6 });
const html = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function telegramSettings(db) {
  const v = (await db.query('SELECT value FROM settings WHERE key=$1', [KEY])).rows[0]?.value;
  return v && typeof v === 'object' ? v : { enabled: false };
}

export function telegramSender(fetchImpl = fetch) {
  return async ({ token, chat }, text) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) throw new Error(`Telegram ${res.status}: ${body.description || 'send failed'}`);
  };
}

// Save settings; the cursor starts now so turning alerts on never floods the chat with old wins.
export async function saveTelegram(db, { token, chat, enabled }) {
  const old = await telegramSettings(db);
  const value = { token: token || old.token || '', chat: chat ?? old.chat ?? '', enabled: !!enabled };
  await db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [KEY, JSON.stringify(value)]);
  if (value.enabled && !old.enabled) await db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    [CURSOR, JSON.stringify({ paid_at: new Date().toISOString(), rounds: [], release_day: new Date().toISOString().slice(0, 10) })]);
  return value;
}

export class Notifier {
  constructor(db, c, send) { this.db = db; this.c = c; this.send = send || telegramSender(); this.lastError = null; }

  async messages(cursor) {
    const site = this.c.origin, out = [], next = { ...cursor };
    // Wins paid on Chainweb since the last alert (oldest first, at most 5 per run).
    const wins = (await this.db.query(`SELECT p.amount_kda,p.request_key,p.paid_at,p.paid_at::text AS paid_key,c.game,s.id sid,s.ai_reviewed,u.kadena_account
      FROM payouts p JOIN submissions s ON s.id=p.submission_id JOIN task_campaigns c ON c.id=s.campaign_id JOIN users u ON u.id=s.user_id
      WHERE p.status='confirmed' AND c.game IS NOT NULL AND p.paid_at>$1::timestamptz ORDER BY p.paid_at LIMIT 5`, [cursor.paid_at])).rows;
    for (const w of wins) {
      out.push(`🏆 <b>${html(short(w.kadena_account))}</b> won <b>${kda(w.amount_kda)} KDA</b> in ${html(GAMES[w.game]?.name || 'a game')}${w.ai_reviewed ? ', reviewed and paid by the AI agent' : ''}.\n`
        + `<a href="${site}/win/${w.sid}">See the win</a> · <a href="${site}/transactions/${w.request_key}?chain=${this.c.chain}">Chainweb transaction</a>\n🎮 <a href="${site}/games.html">Play Kadena Nexus Games</a>`);
      next.paid_at = w.paid_key; // full microsecond precision, so the same win is never sent twice
    }
    // Rounds that opened since the last alert.
    const seen = new Set((cursor.rounds || []).map(String));
    const opened = (await this.db.query(`SELECT id,game,reward_kda,max_rewards,daily_release FROM task_campaigns
      WHERE game IS NOT NULL AND status='open' AND NOT hidden AND deadline>now() AND created_at>now()-interval '14 days' ORDER BY id`)).rows.filter(r => !seen.has(String(r.id)));
    if (opened.length) {
      const lines = opened.map(r => `• ${html(GAMES[r.game]?.name || r.game)}: ${kda(r.reward_kda)} KDA × ${r.max_rewards}${r.daily_release ? ` (${r.daily_release} a day)` : ''}`);
      out.push(`🎮 <b>New prizes in Kadena Nexus Games</b>\n${lines.join('\n')}\n\nSolve a puzzle, and the AI agent pays you in KDA from on-chain escrow.\n<a href="${site}/games.html">Play now</a>`);
      next.rounds = [...seen, ...opened.map(r => String(r.id))].slice(-200);
    }
    // Daily release: once per UTC day, if any round opened new prizes today.
    const today = new Date().toISOString().slice(0, 10);
    if (cursor.release_day !== today) {
      next.release_day = today;
      const daily = (await this.db.query(`SELECT game,reward_kda,daily_release FROM task_campaigns WHERE game IS NOT NULL AND status='open' AND NOT hidden
        AND deadline>now() AND daily_release IS NOT NULL ORDER BY id`)).rows;
      const y = (await this.db.query("SELECT winners FROM challenge_days WHERE day=$1::date-1", [today]).catch(() => ({ rows: [] }))).rows[0]?.winners || [];
      const podium = y.length ? `\n\n🧩 <b>Yesterday's Daily Challenge</b>\n${y.map(w => `${['🥇', '🥈', '🥉'][w.place - 1] || w.place} ${html(w.who)}: ${w.moves} moves${w.bonus_kda ? `, +${kda(w.bonus_kda)} KDA` : ''}`).join('\n')}` : '';
      if (daily.length || podium) out.push(`☀️ <b>Today's prizes are open</b>\n${daily.map(r => `• ${html(GAMES[r.game]?.name || r.game)}: ${r.daily_release} × ${kda(r.reward_kda)} KDA`).join('\n')}\n• Daily Challenge: a new Sliding Tiles board${podium}\n<a href="${site}/games.html">Play now</a>`);
    }
    return { out, next };
  }

  async run() {
    const s = await telegramSettings(this.db);
    if (!s.enabled || !s.token || !s.chat) return { sent: 0 };
    const cursor = (await this.db.query('SELECT value FROM settings WHERE key=$1', [CURSOR])).rows[0]?.value || { paid_at: new Date().toISOString(), rounds: [], release_day: new Date().toISOString().slice(0, 10) };
    const { out, next } = await this.messages(cursor);
    let sent = 0;
    try { for (const text of out) { await this.send(s, text); sent++; } this.lastError = null; }
    catch (error) { this.lastError = error.message; console.error(JSON.stringify({ event: 'telegram_error', error: error.message })); }
    // Move the cursor even after an error, so one bad message never repeats forever.
    await this.db.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [CURSOR, JSON.stringify(next)]);
    return { sent };
  }
}
