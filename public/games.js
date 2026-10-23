// Kadena Nexus Games page. Paid rounds are generated and checked by the
// server; practice rounds run here with the same puzzle code.
import { chooseWallet, restoreWallet, forgetWallet } from './wallets.js';
import { setupAmbience } from './ambience.js?v=20261019s';
import { tilesGenerate, tilesSolved, tileNeighbors, logicGenerate, logicCheck, memoryGenerate, memoryFlip, MINES, minesPlace, minesReveal } from './games-core.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 6 });
const short = s => s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '';
const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const state = { config: null, user: null, csrf: null, data: null, me: null, stage: null };
let wallet, timer, tracker, livePoll;

const PRACTICE = ['tiles', 'logic', 'memory', 'mines'];
const ICON = {
  word: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="6" height="7" rx="1"/><rect x="9" y="7" width="6" height="7" rx="1"/><rect x="16" y="7" width="6" height="7" rx="1"/><path d="M4 18h16"/></svg>',
  memory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="8" height="11" rx="1.5"/><rect x="13" y="9" width="8" height="11" rx="1.5"/><path d="M17 13l1 1.5-1 1.5-1-1.5z"/></svg>',
  mines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="6"/><path d="M12 3v4M4 13H2M22 13h-2M6.3 7.3 5 6M17.7 7.3 19 6"/></svg>',
  pactbug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="14" rx="5" ry="6"/><path d="M12 8V5M9 5l-2-2M15 5l2-2M7 12H3M21 12h-4M7 17l-3 2M17 17l3 2M12 8v12"/></svg>',
  tiles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M15 17.5h5m-2.5-2.5 2.5 2.5-2.5 2.5"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.5" r=".6" fill="currentColor"/></svg>',
  logic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M12 3v18"/></svg>',
  riddle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  k2048: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8.5 9.5 12 7l3.5 2.5M8.5 14.5 12 17l3.5-2.5M12 7v10"/></svg>',
};
const ROBOT = '<svg class="ai-bot" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M12 2.5v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="2.6" r="1.6" fill="currentColor"/><rect x="3.5" y="6.5" width="17" height="13" rx="4" fill="currentColor"/><circle class="ai-bot-face" cx="9" cy="12.2" r="1.9"/><circle class="ai-bot-face" cx="15" cy="12.2" r="1.9"/><path class="ai-bot-mouth" d="M9.2 16.2h5.6" stroke-width="1.6" stroke-linecap="round"/><path d="M1.8 11v4M22.2 11v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const txLink = key => key && /^[\w-]{43}$/.test(key) ? `<a href="/transactions/${encodeURIComponent(key)}?chain=1" target="_blank" rel="noopener noreferrer">Transaction ${esc(short(key))}</a>` : '';

function notify(message) { const n = $('#notice'); n.className = 'notice'; n.textContent = message; n.hidden = false; clearTimeout(notify.t); notify.t = setTimeout(() => n.hidden = true, 9000); }
async function api(path, body, options = {}) {
  const headers = {};
  if (body !== undefined) { headers['content-type'] = 'application/json'; if (state.csrf) headers['x-csrf-token'] = state.csrf; }
  if (options.money) headers['idempotency-key'] = options.key || crypto.randomUUID();
  const r = await fetch('/api' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = await r.json(); if (!r.ok) { const e = new Error(data.error || 'Request failed'); e.status = r.status; throw e; } return data;
}
async function action(button, fn) {
  if (button?.disabled) return; const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Working…'; }
  try { await fn(); } catch (e) { notify(e.message); } finally { if (button?.isConnected) { button.disabled = false; if (button.textContent === 'Working…') button.textContent = old; } }
}

// ---------- Wallet ----------
function sessionUI() {
  $('#networkLabel').textContent = (state.config.network === 'mainnet01' ? 'Kadena mainnet' : state.config.network === 'development' ? 'Local development chain' : 'Kadena ' + state.config.network) + ' · Chain ' + state.config.chain;
  $('#walletBtn').textContent = state.user ? short(state.user.account) : 'Connect wallet';
  $('#walletAcct').textContent = state.user?.account || '';
  if (!state.user) walletMenu(false);
}
function walletMenu(open) { $('#walletMenu').hidden = !open; $('#walletBtn').setAttribute('aria-expanded', String(open)); }
async function connect() {
  wallet = await chooseWallet(); const account = await wallet.connect(state.config.network);
  const challenge = await api('/auth/nonce', { account });
  const signed_command = await wallet.sign(challenge.command);
  const session = await api('/auth/verify', { account, nonce: challenge.nonce, signed_command });
  state.user = session.user; state.csrf = session.csrf; sessionUI(); await load();
  notify('Wallet connected. Sign-in does not send a transaction or spend KDA.');
}
$('#walletBtn').onclick = () => state.user ? walletMenu($('#walletMenu').hidden) : action($('#walletBtn'), connect);
$('#walletCopy').onclick = async () => { walletMenu(false); try { await navigator.clipboard.writeText(state.user.account); notify('Address copied.'); } catch { notify(state.user.account); } };
$('#walletOut').onclick = () => action($('#walletOut'), async () => { walletMenu(false); await api('/auth/logout', {}); if (wallet?.kind === 'phone') wallet.disconnect().catch(() => {}); wallet = null; forgetWallet(); state.user = null; state.csrf = null; state.me = null; sessionUI(); await load(); });
document.addEventListener('click', e => { if (!e.target.closest('.wallet-wrap')) walletMenu(false); });

// ---------- Lobby ----------
async function load() {
  const [data, me, challenge, weekly, streak] = await Promise.all([api('/games'), state.user ? api('/me/games') : null,
    api('/games/challenge').catch(() => null), api('/games/leaderboard').catch(() => null), state.user ? api('/me/streak').catch(() => null) : null]);
  Object.assign(state, { data, me, challenge, weekly, streak });
  renderLobby(); renderDaily(); renderWeekly();
}
const myRound = id => state.me?.rounds.find(r => Number(r.campaign_id) === Number(id));
function playButton(r) {
  const rules = state.data.rules, mine = myRound(r.id);
  if (!rules.writes) return '<button class="btn" disabled>Opens soon</button>';
  if (!state.user) return `<button class="btn" data-connect>Connect wallet to play</button>`;
  if (rules.email_required && !state.me.email_verified) return `<button class="btn" data-email>Confirm email to play</button>`;
  if (mine?.submission_id && mine.status !== 'reservation_failed') {
    if (mine.status === 'paid') return `<span class="badge ok">Won · paid</span><button class="btn ghost sm" data-share="${esc(mine.submission_id)}">Share</button>`;
    if (mine.status === 'rejected') return '<span class="badge warn">Not approved</span>';
    return `<button class="btn ghost" data-track="${r.id}">Won · see payout</button>`;
  }
  if (mine?.active_session) return `<button class="btn orange" data-play="${r.id}">Resume</button>`;
  if (mine && Number(mine.attempts_used) >= rules.attempts) return '<button class="btn" disabled>No tries left</button>';
  if (rules.wins_per_day_total && (state.me.wins_today_total || 0) >= rules.wins_per_day_total) return '<button class="btn" disabled>Daily win limit reached · back tomorrow</button>';
  if ((state.me.wins_today[r.game] || 0) >= rules.wins_per_day) return '<button class="btn" disabled>Won today · back tomorrow</button>';
  if (r.left < 1) return '<button class="btn" disabled>All prizes taken</button>';
  if (r.daily_release && r.left_today < 1) return `<button class="btn" disabled>Next prizes in <span data-countdown="${esc(r.next_release_at)}">${untilText(r.next_release_at)}</span></button>`;
  const triesLeft = rules.attempts - Number(mine?.attempts_used || 0);
  return `<button class="btn orange" data-play="${r.id}">Play for ${fmt(r.reward)} KDA</button><span class="state">${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left</span>`;
}
// Live activity: who is mid-round right now, and how many wallets played in the last 24 hours.
function liveLine(l) {
  if (!l || (!l.playing.length && !l.today)) return '';
  const now = l.playing.length ? `<span class="live-now"><i class="live-dot" aria-hidden="true"></i>${l.playing.length} playing now</span>` : '';
  const today = l.today ? `<span>${l.today} ${l.today === 1 ? 'player' : 'players'} today</span>` : '';
  return `<div class="gc-live" title="${esc(l.playing.join(', '))}">${now}${today}</div>`;
}
function liveStrip(l) {
  const mine = state.user ? short(state.user.account) : null;
  const others = (l?.playing || []).filter(w => w !== mine);
  if (!others.length) return `<i class="live-dot quiet" aria-hidden="true"></i>No one else is on this game right now${l?.today ? ` · ${l.today} ${l.today === 1 ? 'player' : 'players'} today` : ''}`;
  return `<i class="live-dot" aria-hidden="true"></i><b>${others.length} ${others.length === 1 ? 'other player' : 'other players'} solving now:</b> ${others.map(w => `<span class="live-who">${esc(w)}</span>`).join('')}`;
}
async function pollLive(game) {
  const draw = l => { const el = $('#gLive'); if (el) el.innerHTML = liveStrip(l); };
  draw(state.data.live?.[game]);
  const run = async () => { if (document.hidden) return; try { const all = await api('/games/live'); state.data.live = all; draw(all[game]); } catch { /* keep the last view */ } };
  run(); livePoll = setInterval(run, 15000);
}
function untilText(at) {
  const ms = Math.max(0, Date.parse(at) - Date.now()), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${Math.max(1, m)}m`;
}
function prizeLine(r) {
  if (!r.daily_release) return `${r.left} of ${r.max} prizes left`;
  return `${r.left_today} left today · ${r.left} in the pool`;
}
function endsIn(deadline) { const h = (Date.parse(deadline) - Date.now()) / 3600000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`; }
function renderLobby() {
  const d = state.data, rules = d.rules;
  $('#gWins').textContent = fmt(d.stats.wins); $('#gKda').textContent = fmt(d.stats.kda);
  $('#gOpen').textContent = fmt(d.rounds.reduce((s, r) => s + Number(r.reward) * r.left, 0));
  $('#gFeed').innerHTML = d.recent.length ? d.recent.map(p => `<li><span class="who">${esc(p.who)}</span><b class="kda">${fmt(p.reward)}</b><span class="what">Won ${esc(d.games.find(g => g.id === p.game)?.name || 'a game')}</span><span class="tx">${p.tx ? `<a href="/transactions/${esc(p.tx)}?chain=1" target="_blank" rel="noopener noreferrer">${esc(short(p.tx))}</a>` : ''}</span>${p.ai ? `<a class="badge ai feed-ai" href="/ai-receipts/${esc(p.receipt)}">${ROBOT} Reviewed &amp; paid by AI agent</a>` : ''}</li>`).join('') : '<li class="empty">No wins paid yet. Be the first.</li>';
  const total = rules.wins_per_day_total || 20;
  $('#rulesLine').textContent = `${total >= d.games.length ? 'One win per game per day' : `One win per game, ${total} wins a day`} · ${rules.attempts} tries per round${rules.email_required ? ' · confirmed email needed' : ''}`;
  renderEmail(); renderOwner();
  $('#rounds').innerHTML = d.rounds.length ? d.rounds.map(r => `<article class="game-card">
      <div class="gc-top"><span class="gc-icon">${ICON[r.game]}</span><div><h3>${esc(r.game_name)}${r.difficulty === 'expert' ? ' <span class="badge expert">Expert</span>' : ''}</h3><span class="kda">${fmt(r.reward)}</span></div></div>
      <p>${esc(r.title)}</p>
      <div class="meta"><span>${prizeLine(r)}</span><span>Ends in ${endsIn(r.deadline)}</span><span>${r.minutes} min per try</span></div>
      ${liveLine(d.live?.[r.game])}
      <div class="foot">${playButton(r)}</div></article>`).join('')
    : `<div class="empty-card">No rounds are open right now. New rounds are announced on <a href="https://t.me/KadenaNexus">Telegram</a> and <a href="https://x.com/KadenaNexus">@KadenaNexus</a>.</div>`;
  $$('[data-connect]').forEach(b => b.onclick = () => action(b, connect));
  $$('[data-email]').forEach(b => b.onclick = () => { $('#emailCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#gEmail')?.focus(); });
  $$('[data-play]').forEach(b => b.onclick = () => action(b, () => playPaid(Number(b.dataset.play))));
  $$('[data-share]').forEach(b => b.onclick = () => action(b, () => shareWin(b.dataset.share)));
  $$('[data-track]').forEach(b => b.onclick = () => showWin(d.rounds.find(r => Number(r.id) === Number(b.dataset.track)), null));
}
function renderEmail() {
  const card = $('#emailCard'), me = state.me;
  card.hidden = !state.user || me?.email_verified || !state.data.rules.email_required;
  if (card.hidden) return;
  if (!state.data.rules.email_ready) { card.innerHTML = '<h3>Email confirmation opens soon</h3><p>Paid rounds need a confirmed email. This is being switched on.</p>'; return; }
  card.innerHTML = `<h3>Confirm your email to play for KDA</h3>
    <p>One email per wallet keeps prizes for real players. We only use it for this confirmation and game notices.</p>
    ${me.pending_email ? `<p>We sent a link to <b>${esc(me.pending_email)}</b>. Open it to confirm, then come back here.</p>` : ''}
    <div class="g-row"><div class="field"><label for="gEmail">Email</label><input id="gEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(me.pending_email || '')}"></div><button class="btn" id="gEmailBtn">${me.pending_email ? 'Send again' : 'Send confirmation'}</button></div>`;
  $('#gEmailBtn').onclick = () => action($('#gEmailBtn'), async () => { const r = await api('/me/email', { email: $('#gEmail').value.trim() }); notify(`Confirmation sent to ${r.email}. Check your inbox and spam folder.`); await load(); });
}
function renderOwner() {
  const card = $('#ownerCard'); card.hidden = state.user?.role !== 'admin';
  if (card.hidden || card.dataset.ready) return; card.dataset.ready = '1';
  card.innerHTML = `<h3>Open a game round (owner)</h3>
    <p>Funds the prize pool in escrow from your owner wallet. Winners are reviewed and paid by the AI agent, within the server's daily games limit.</p>
    <div class="g-row">
      <div class="field"><label for="oGame">Game</label><select id="oGame">${state.data.games.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="oReward">Prize per win (KDA)</label><input id="oReward" type="number" min="0.1" step="0.1" value="5"></div>
      <div class="field"><label for="oCount">Number of prizes</label><input id="oCount" type="number" min="1" max="1000" value="30"></div>
      <div class="field"><label for="oLevel">Difficulty</label><select id="oLevel"><option value="normal">Normal</option><option value="expert">Expert (harder, bigger prize)</option></select></div>
      <div class="field"><label for="oDaily">Prizes per day</label><input id="oDaily" type="number" min="1" max="1000" value="5" placeholder="All at once"></div>
      <div class="field"><label for="oDays">Open for (days)</label><input id="oDays" type="number" min="1" max="60" value="10"></div>
      <button class="btn" id="oGo">Fund round</button>
    </div><p id="oNote"></p>
    <details class="g-refill"><summary>Refill every empty game at once</summary>
      <p>Opens one round for each game that has no prizes left, using its last prize amount and the numbers above. Your wallet asks you to sign once per game.</p>
      <button class="btn ghost" id="oRefill">Refill empty games</button><p id="oRefillNote"></p>
    </details>
    <details class="g-refill"><summary>Prizes per day for open rounds</summary><div id="oRelease"></div></details>
    <details class="g-refill"><summary>Bonus pools (Daily Challenge and streaks)</summary>
      <p>Bonus prizes are reserved in escrow automatically and wait for your approval in Admin. Each wallet can get one bonus per pool.</p>
      <div class="g-row"><div class="field"><label for="bKind">Pool</label><select id="bKind"><option value="challenge">Daily Challenge: top 3 each day</option><option value="streak">7-day streak</option></select></div>
        <div class="field"><label for="bReward">Bonus (KDA)</label><input id="bReward" type="number" min="0.1" step="0.1" value="10"></div>
        <div class="field"><label for="bCount">Number of bonuses</label><input id="bCount" type="number" min="1" max="1000" value="21"></div>
        <button class="btn" id="bGo">Fund bonus pool</button></div><p id="bNote"></p>
    </details>
    <details class="g-refill" id="oBank"><summary>Question banks (private)</summary>
      <p>The built-in questions are public on GitHub. Upload a private bank file (JSON with any of: quiz, written, riddles, words, pactbugs) to replace them. Items are never shown back here, and each wallet is shown questions it has not seen first.</p>
      <div id="bankStatus" class="bank-status"></div>
      <div class="g-row"><div class="field"><label for="bankFile">Bank file (.json)</label><input id="bankFile" type="file" accept="application/json,.json"></div><button class="btn" id="bankGo">Upload</button></div><p id="bankNote"></p>
    </details>
    <details class="g-refill" id="oTg"><summary>Telegram alerts</summary>
      <p>Posts a short summary of wins, new prizes and the Daily Challenge to your Telegram group or channel, 1 to 3 times a day (or every win, for a games-only channel). Create a bot with @BotFather, add it to the group as admin, then paste its token and the chat id or @channel.</p>
      <div class="g-row"><div class="field"><label for="tgToken">Bot token</label><input id="tgToken" type="password" autocomplete="off" placeholder="123456:ABC…"></div>
        <div class="field"><label for="tgChat">Chat id or @channel</label><input id="tgChat" placeholder="@KadenaNexus or -100…"></div>
        <div class="field"><label for="tgMode">How often</label><select id="tgMode"><option value="1">1 summary a day (9 AM Riyadh)</option><option value="2">2 summaries a day (9 AM, 7 PM)</option><option value="3">3 summaries a day (9 AM, 3 PM, 9 PM)</option><option value="every">Every win and new round</option></select></div>
        <label class="g-check"><input type="checkbox" id="tgOn"> Alerts on</label>
        <button class="btn" id="tgSave">Save and send test</button></div><p id="tgNote"></p>
    </details>`;
  const note = () => {
    const total = Number($('#oReward').value) * Number($('#oCount').value), daily = Number($('#oDaily').value) || 0;
    const days = daily ? Math.ceil(Number($('#oCount').value) / daily) : 0;
    $('#oNote').textContent = `Total to fund: ${fmt(total)} KDA.${daily ? ` ${daily} prizes open each day (new ones at 03:00 Riyadh / 00:00 UTC), lasting about ${days} ${days === 1 ? 'day' : 'days'}.` : ' All prizes open at once.'} AI payouts for games are limited to ${fmt(state.data.rules.ai_max_reward_kda)} KDA per win; larger prizes wait for you in Admin.`;
  };
  ['#oReward', '#oCount', '#oDaily'].forEach(s => $(s).oninput = note); note();
  $('#oGo').onclick = () => action($('#oGo'), () => openRound($('#oGame').value, String($('#oReward').value)));
  $('#oRefill').onclick = () => action($('#oRefill'), refillAll);
  renderReleaseEditor();
  const bNote = () => { $('#bNote').textContent = `Total to fund: ${fmt(Number($('#bReward').value) * Number($('#bCount').value))} KDA.${$('#bKind').value === 'challenge' ? ` ${$('#bCount').value} bonuses cover about ${Math.ceil(Number($('#bCount').value) / 3)} days of top-3 prizes.` : ''}`; };
  ['#bKind', '#bReward', '#bCount'].forEach(s => $(s).oninput = bNote); bNote();
  $('#bGo').onclick = () => action($('#bGo'), fundBonus);
  const bankStatus = async () => {
    const s = await api('/admin/games/content');
    const names = { quiz: 'Quiz questions', written: 'Written questions', riddles: 'Riddles', words: 'Hidden words', pactbugs: 'Pact bugs' };
    $('#bankStatus').innerHTML = Object.entries(s).map(([k, v]) => `<span class="${v.source === 'private' ? 'ok' : ''}">${names[k]}: <b>${v.count}</b> · ${v.source === 'private' ? 'private' : 'built-in (public)'}</span>`).join('');
  };
  $('#oBank').ontoggle = () => { if ($('#oBank').open) bankStatus().catch(e => { $('#bankNote').textContent = e.message; }); };
  $('#bankGo').onclick = () => action($('#bankGo'), async () => {
    const f = $('#bankFile').files[0]; if (!f) throw new Error('Choose the bank file first.');
    let body; try { body = JSON.parse(await f.text()); } catch { throw new Error('That file is not valid JSON.'); }
    const r = await api('/admin/games/content', body);
    $('#bankNote').textContent = `Uploaded: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ')}. New rounds use them right away.`; $('#bankFile').value = '';
    await bankStatus();
  });
  $('#oTg').ontoggle = async () => {
    if (!$('#oTg').open || $('#oTg').dataset.loaded) return; $('#oTg').dataset.loaded = '1';
    try { const t = await api('/admin/telegram'); $('#tgChat').value = t.chat; $('#tgOn').checked = t.enabled; $('#tgMode').value = t.mode === 'every' ? 'every' : String(t.per_day || 2); $('#tgNote').textContent = t.token_set ? 'A bot token is saved. Leave the token empty to keep it.' : 'No bot token saved yet.'; } catch (e) { $('#tgNote').textContent = e.message; }
  };
  $('#tgSave').onclick = () => action($('#tgSave'), async () => {
    const m = $('#tgMode').value;
    const body = { enabled: $('#tgOn').checked, chat: $('#tgChat').value.trim(), test: true, ...(m === 'every' ? { mode: 'every' } : { mode: 'digest', per_day: Number(m) }), ...($('#tgToken').value.trim() ? { token: $('#tgToken').value.trim() } : {}) };
    const r = await api('/admin/telegram', body); $('#tgToken').value = '';
    $('#tgNote').textContent = `Saved. Test message sent to ${r.chat}. Alerts are ${r.enabled ? 'on' : 'off'}, ${r.mode === 'every' ? 'every win' : `${r.per_day} ${r.per_day === 1 ? 'summary' : 'summaries'} a day`}.`;
  });
}
// Owner: change prizes-per-day on rounds that are already open.
function renderReleaseEditor() {
  const box = $('#oRelease'); if (!box) return;
  const rounds = state.data.rounds.filter(r => r.left > 0);
  box.innerHTML = rounds.length ? rounds.map(r => `<div class="g-row rel-row"><span>${esc(r.game_name)} · ${fmt(r.reward)} KDA · ${r.left} left</span>
      <div class="field"><label for="rel${r.id}">Per day</label><input id="rel${r.id}" type="number" min="1" max="1000" value="${r.daily_release || ''}" placeholder="All"></div>
      <button class="btn ghost" data-rel="${r.id}">Save</button></div>`).join('') : '<p>No open rounds with prizes left.</p>';
  $$('[data-rel]').forEach(b => b.onclick = () => action(b, async () => {
    const v = Number($(`#rel${b.dataset.rel}`).value) || null;
    await api(`/admin/games/${b.dataset.rel}/daily-release`, { daily_release: v });
    notify(v ? `Saved: ${v} prizes per day.` : 'Saved: all prizes open at once.'); await load(); renderReleaseEditor();
  }));
}
async function refillAll() {
  const empty = state.data.games.filter(g => !state.data.rounds.some(r => r.game === g.id && r.left > 0));
  if (!empty.length) return notify('Every game still has prizes.');
  const last = Object.fromEntries((state.data.recent || []).map(p => [p.game, p.reward]));
  const done = [];
  for (const g of empty) {
    const reward = String(Number(last[g.id] || (g.id === 'pactbug' ? 20 : ['tiles', 'quiz'].includes(g.id) ? 5 : 10)));
    $('#oRefillNote').textContent = `Funding ${g.name} (${done.length + 1} of ${empty.length}): confirm in your wallet…`;
    await openRound(g.id, reward, { quiet: true }); done.push(g.name);
  }
  $('#oRefillNote').textContent = `Funding sent for ${done.join(', ')}. Rounds open once Chainweb confirms them.`;
}
async function fundBonus() {
  const kind = $('#bKind').value, label = kind === 'challenge' ? 'Daily Challenge bonus pool' : 'Streak bonus pool';
  const body = { title: `${label} – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, summary: `Bonus prizes for Kadena Nexus Games players: ${kind === 'challenge' ? 'the top 3 in each Daily Challenge' : 'wallets that play 7 days in a row'}.`,
    sponsor_name: 'Kadena Nexus Games', category: 'Games', template: 'Game', reward_kda: String($('#bReward').value), max_rewards: Number($('#bCount').value), minutes_estimate: 1,
    deadline: new Date(Date.now() + 60 * 86400000).toISOString(), steps: ['Bonus'], proof_schema: [{ key: 'result', label: 'Result', type: 'text' }], bonus_kind: kind, featured: false };
  wallet ||= restoreWallet(); const connected = await wallet.connect(state.config.network);
  if (connected !== state.user.account) throw new Error('Select the signed-in owner account in your wallet.');
  const id = (await api('/admin/campaigns', body, { money: true })).campaign.id;
  const prepared = await api(`/admin/campaigns/${id}/funding-command`, {});
  await api(`/admin/campaigns/${id}/confirm-funding`, { signed_command: await wallet.sign(prepared.command) }, { money: true });
  $('#bNote').textContent = `${label} funding sent. It starts once Chainweb confirms it.`;
}
async function openRound(game, reward, { quiet = false } = {}) {
  const g = state.data.games.find(x => x.id === game);
  const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const expert = !quiet && $('#oLevel').value === 'expert';
  const body = { title: `${g.name}${expert ? ' Expert' : ''} round – ${day}`, summary: `${g.blurb} Win KDA paid from escrow by the AI agent.`, sponsor_name: 'Kadena Nexus Games', category: 'Games', template: 'Game',
    reward_kda: reward, max_rewards: Number($('#oCount').value), minutes_estimate: g.minutes, ...(Number($('#oDaily').value) ? { daily_release: Number($('#oDaily').value) } : {}), ...(quiet ? {} : { difficulty: $('#oLevel').value }),
    deadline: new Date(Date.now() + Number($('#oDays').value) * 86400000).toISOString(), steps: ['Play'], proof_schema: [{ key: 'result', label: 'Game result', type: 'text' }], game, featured: false, ai_review: true };
  wallet ||= restoreWallet(); const connected = await wallet.connect(state.config.network);
  if (connected !== state.user.account) throw new Error('Select the signed-in owner account in your wallet.');
  const same = state.draftRound && state.draftRound.game === game && state.draftRound.reward === body.reward_kda && state.draftRound.count === body.max_rewards;
  const id = same ? state.draftRound.id : (await api('/admin/campaigns', body, { money: true })).campaign.id;
  state.draftRound = { id, game, reward: body.reward_kda, count: body.max_rewards };
  const prepared = await api(`/admin/campaigns/${id}/funding-command`, {});
  const signed_command = await wallet.sign(prepared.command);
  await api(`/admin/campaigns/${id}/confirm-funding`, { signed_command }, { money: true });
  state.draftRound = null;
  if (!quiet) notify('Funding sent. The round opens once Chainweb confirms it, usually within a few minutes.');
  await load();
}

// ---------- Stage ----------
function openStage(html) { document.onkeydown = null; clearInterval(timer); clearInterval(tracker); clearInterval(livePoll); $('#lobby').hidden = true; const s = $('#stage'); s.hidden = false; s.innerHTML = html; scrollTo({ top: 0 }); }
function closeStage() { document.onkeydown = null; clearInterval(timer); clearInterval(tracker); clearInterval(livePoll); state.stage = null; $('#stage').hidden = true; $('#lobby').hidden = false; load().catch(e => notify(e.message)); }
function bar(title, pills) {
  return `<div class="g-bar"><h2>${esc(title)}</h2><button class="g-back" id="gClose" aria-label="Back to games">← Games</button></div><div class="g-status">${pills}</div>`;
}
function startClock(el, mode, expiresAt) {
  const t0 = Date.now();
  const tick = () => {
    if (mode === 'paid' || mode === 'challenge') { const left = Date.parse(expiresAt) - Date.now(); el.textContent = `Time left ${clock(left)}`; el.classList.toggle('hot', left < 60000); if (left <= 0) { clearInterval(timer); finish(); } }
    else el.textContent = `Time ${clock(Date.now() - t0)}`;
  };
  tick(); timer = setInterval(tick, 500);
}

async function playPaid(cid) {
  const round = state.data.rounds.find(r => Number(r.id) === cid);
  const s = await api(`/games/${cid}/play`, {});
  begin({ mode: 'paid', round, session: s, game: s.game, puzzle: s.puzzle });
}
function practice(game) {
  if (game === 'memory') return begin({ mode: 'practice', game, puzzle: { cards: 16 }, secret: { cards: memoryGenerate(Math.random) }, local: { flips: 0, matched: [], open: null, times: [] } });
  if (game === 'mines') return begin({ mode: 'practice', game, puzzle: { ...MINES }, secret: { mines: null }, local: { revealed: [], moves: 0, times: [] } });
  const puzzle = game === 'tiles' ? tilesGenerate(Math.random) : logicGenerate(Math.random).puzzle;
  begin({ mode: 'practice', game, puzzle });
}
function begin(st) {
  const since = st.session?.started_at ? Math.max(0, Date.now() - Date.parse(st.session.started_at)) : 0;
  state.stage = { ...st, t0: performance.now() - since, done: false };
  const name = state.data.games.find(g => g.id === st.game).name;
  const pills = st.mode === 'challenge' ? '<span class="g-pill" id="gClock"></span><span class="g-pill">Daily Challenge</span><span class="g-pill">Same board for everyone · fewest moves wins</span>' : `<span class="g-pill" id="gClock"></span>${st.mode === 'paid' ? `<span class="g-pill">Prize ${fmt(st.round?.reward)} KDA</span>${st.puzzle?.expert ? '<span class="g-pill expert">Expert</span>' : ''}<span class="g-pill">${st.session.attempts_left} more ${st.session.attempts_left === 1 ? 'try' : 'tries'} after this</span>` : '<span class="g-pill">Practice</span>'}`;
  openStage(bar(name, pills) + '<p class="g-live" id="gLive" aria-live="polite"></p><div id="gBoard"></div>');
  if (st.mode !== 'challenge') pollLive(st.game); else $('#gLive').remove();
  $('#gClose').onclick = () => { if (state.stage?.mode === 'paid' && !state.stage.done && !confirm(['word', 'memory', 'mines', 'k2048'].includes(state.stage.game) ? 'Leave this puzzle? Your timer keeps running, and you can resume it from the games list.' : 'Leave this puzzle? Your timer keeps running. If you resume, this puzzle starts again from the beginning.')) return; closeStage(); };
  startClock($('#gClock'), st.mode, st.session?.expires_at);
  ({ tiles: renderTiles, logic: renderLogic, quiz: renderQuiz, riddle: renderRiddle, word: renderWord, memory: renderMemory, mines: renderMines, pactbug: renderPactbug, k2048: renderK2048 })[st.game]();
}

// Sliding tiles
function renderTiles() {
  const st = state.stage; st.board = [...st.puzzle.board]; st.moves = []; st.times = [];
  const draw = () => {
    const solved = tilesSolved(st.puzzle.size);
    $('#gBoard').innerHTML = `<p class="g-help">Tap a tile next to the gap to slide it. Put 1 to 15 in order. Moves: <b id="gMoves">${st.moves.length}</b></p>
      <div class="tiles" role="grid" aria-label="Sliding tiles">${st.board.map((v, i) => v ? `<button data-i="${i}" class="${v === solved[i] ? 'home' : ''}" aria-label="Tile ${v}">${v}</button>` : '<button class="gap" tabindex="-1" aria-hidden="true"></button>').join('')}</div>`;
    $$('.tiles [data-i]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.i), gap = st.board.indexOf(0);
      if (!tileNeighbors(gap, st.puzzle.size).includes(i)) return;
      st.moves.push(st.board[i]); st.times.push(Math.round(performance.now() - st.t0));
      [st.board[gap], st.board[i]] = [st.board[i], st.board[gap]]; draw();
      if (st.board.every((v, k) => v === solved[k])) finish();
    });
  };
  draw();
}

// Logic grid
function renderLogic() {
  const st = state.stage; st.grid = [...st.puzzle.givens]; st.entries = 0; st.sel = st.grid.indexOf(0);
  const clash = i => { const v = st.grid[i]; if (!v) return false; const g = [...st.grid]; g[i] = 0; const r = Math.floor(i / 6), c = i % 6, r0 = r - r % 2, c0 = c - c % 3;
    for (let k = 0; k < 6; k++) if (g[r * 6 + k] === v || g[k * 6 + c] === v) return true;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 3; b++) if (g[(r0 + a) * 6 + c0 + b] === v) return true; return false; };
  const draw = () => {
    $('#gBoard').innerHTML = `<p class="g-help">Every row, column and 2×3 box needs 1 to 6 once. Tap a square, then a number.</p>
      <div class="lgrid" role="grid" aria-label="Logic grid">${st.grid.map((v, i) => { const r = Math.floor(i / 6), c = i % 6;
        return `<button data-i="${i}" class="${st.puzzle.givens[i] ? 'given' : ''} ${c === 2 ? 'c2' : ''} ${r % 2 === 1 && r < 5 ? 'r1' : ''} ${i === st.sel ? 'sel' : ''} ${!st.puzzle.givens[i] && clash(i) ? 'bad' : ''}" aria-label="Row ${r + 1} column ${c + 1}${v ? ', ' + v : ', empty'}">${v || ''}</button>`; }).join('')}</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6].map(n => `<button data-n="${n}">${n}</button>`).join('')}<button data-n="0" aria-label="Clear">⌫</button></div>`;
    $$('.lgrid [data-i]').forEach(b => b.onclick = () => { const i = Number(b.dataset.i); if (!st.puzzle.givens[i]) { st.sel = i; draw(); } });
    $$('.pad [data-n]').forEach(b => b.onclick = () => {
      if (st.sel < 0 || st.puzzle.givens[st.sel]) return; const n = Number(b.dataset.n);
      st.grid[st.sel] = n; if (n) st.entries++; draw();
      if (st.grid.every(Boolean) && logicCheck(st.puzzle, st.grid).solved) finish();
    });
  };
  draw();
}

// Quiz
function renderQuiz() {
  const st = state.stage;
  $('#gBoard').innerHTML = `<form class="gq" id="gForm">${st.puzzle.questions.map((q, i) => `<fieldset class="qn"><p>${i + 1}. ${esc(q.q)}</p>${q.o.map((o, k) => `<label><input type="radio" name="q${i}" value="${k}" required> ${esc(o)}</label>`).join('')}</fieldset>`).join('')}
    <div class="qn"><p>${st.puzzle.questions.length + 1}. ${esc(st.puzzle.written)}</p><textarea id="gWritten" maxlength="1200" placeholder="Answer in your own words. A sentence or two is enough." required></textarea></div>
    <div class="g-actions"><button class="btn orange" type="submit">Finish quiz</button></div></form>`;
  $('#gForm').onsubmit = e => { e.preventDefault(); if ($('#gWritten').value.trim().length < 20) return notify('Write at least a full sentence for the last question.'); finish(); };
}

// Riddles
function renderRiddle() {
  const st = state.stage;
  $('#gBoard').innerHTML = `<form class="gq" id="gForm">${st.puzzle.riddles.map((r, i) => `<div class="qn"><p>${i + 1}. ${esc(r.q)}</p><input type="text" id="r${i}" maxlength="100" autocomplete="off" autocapitalize="off" placeholder="One to three words" required></div>`).join('')}
    <div class="g-actions"><button class="btn orange" type="submit">Check answers</button></div></form>`;
  $('#gForm').onsubmit = e => { e.preventDefault(); finish(); };
}

// ---------- Interactive games: each move goes to the server (paid) or runs here (practice) ----------
async function sendMove(move) {
  const st = state.stage; if (!st || st.done) return null;
  move.t = Math.round(performance.now() - st.t0);
  if (st.mode === 'practice') {
    const L = st.local;
    if (st.game === 'memory') {
      if (L.open === null) { L.open = move.card; return { card: { i: move.card, s: st.secret.cards[move.card] } }; }
      const r = memoryFlip(st.secret.cards, L, L.open, move.card); L.open = null; return r;
    }
    if (L.revealed.includes(move.cell)) return { opened: [] };
    st.secret.mines ||= minesPlace(Math.random, move.cell); L.moves++;
    const r = minesReveal(st.secret.mines, L.revealed, move.cell);
    if (r.boom) { st.done = true; clearInterval(timer); practiceOver(st, 'Boom! You hit a mine.', r.mines); return null; }
    return r;
  }
  try {
    const r = await api(`/games/sessions/${st.session.id}/move`, { move });
    if (r.over) {
      st.done = true; clearInterval(timer);
      (r.mines || []).forEach(m => { const b = document.querySelector(`.mgrid [data-i="${m}"]`); if (b) { b.classList.add('mine'); b.textContent = '✹'; } });
      if (r.word) notify(`The word was ${r.word.toUpperCase()}.`);
      setTimeout(() => showMiss(st, r), r.mines || r.word ? 1400 : 0);
      return null;
    }
    return r;
  } catch (e) { notify(e.message); return null; }
}
function practiceOver(st, message, mines) {
  if (mines) mines.forEach(i => { const b = document.querySelector(`.mgrid [data-i="${i}"]`); if (b) { b.classList.add('mine'); b.textContent = '✹'; } });
  setTimeout(() => {
    openStage(`<div class="g-result"><h3>${esc(message)}</h3><p>Practice round over. Try again with a new board.</p>
      <div class="g-actions" style="width:100%;max-width:380px"><button class="btn ghost" id="gBack">Back to games</button><button class="btn" id="gAgain">Play again</button></div></div>`);
    $('#gBack').onclick = closeStage; $('#gAgain').onclick = () => practice(st.game);
  }, 1400);
}

// Kadena Word
function renderWord() {
  const st = state.stage; st.rows = [...(st.session?.state?.guesses || [])]; st.typed = ''; st.keys = {};
  const rank = { miss: 1, near: 2, hit: 3 };
  for (const r of st.rows) [...r.g].forEach((ch, i) => { if ((rank[r.score[i]] || 0) > (rank[st.keys[ch]] || 0)) st.keys[ch] = r.score[i]; });
  const KB = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const draw = () => {
    const rows = [...st.rows.map(r => ({ letters: r.g, score: r.score })), ...(st.rows.length < 6 ? [{ letters: st.typed.padEnd(5), score: null, now: true }] : [])];
    while (rows.length < 6) rows.push({ letters: '     ', score: null });
    $('#gBoard').innerHTML = `<p class="g-help">Guess the hidden 5-letter word. <b class="wk hit">Green</b> right place, <b class="wk near">gold</b> in the word, gray not in it.</p>
      <div class="wgrid" aria-live="polite">${rows.map(r => `<div class="wrow ${r.now ? 'now' : ''}">${[...r.letters].map((ch, i) => `<span class="wc ${r.score ? r.score[i] : ''}">${esc(ch.trim().toUpperCase())}</span>`).join('')}</div>`).join('')}</div>
      <div class="kb">${KB.map((row, k) => `<div>${k === 2 ? '<button data-k="enter" class="wide">Enter</button>' : ''}${[...row].map(ch => `<button data-k="${ch}" class="${st.keys[ch] || ''}">${ch.toUpperCase()}</button>`).join('')}${k === 2 ? '<button data-k="back" class="wide" aria-label="Delete">⌫</button>' : ''}</div>`).join('')}</div>`;
    $$('.kb [data-k]').forEach(b => b.onclick = () => key(b.dataset.k));
  };
  let busy = false;
  const key = async k => {
    if (busy || st.done) return;
    if (k === 'back') { st.typed = st.typed.slice(0, -1); return draw(); }
    if (k === 'enter') {
      if (st.typed.length !== 5) return notify('Type 5 letters first.');
      busy = true; const guess = st.typed;
      const r = await sendMove({ guess }); busy = false;
      if (!r || r.error) return;
      st.rows.push({ g: guess, score: r.score }); st.typed = '';
      [...guess].forEach((ch, i) => { if ((rank[r.score[i]] || 0) > (rank[st.keys[ch]] || 0)) st.keys[ch] = r.score[i]; });
      draw();
      if (r.word) notify(`The word was ${r.word.toUpperCase()}.`);
      if (r.solved) finish();
      return;
    }
    if (/^[a-z]$/.test(k) && st.typed.length < 5) { st.typed += k; draw(); }
  };
  document.onkeydown = e => { if (state.stage !== st || st.done) return; if (e.key === 'Enter') key('enter'); else if (e.key === 'Backspace') key('back'); else if (/^[a-zA-Z]$/.test(e.key)) key(e.key.toLowerCase()); };
  draw();
  if (st.rows.at(-1)?.score.every(x => x === 'hit')) finish();
}

// Memory Match
function renderMemory() {
  const st = state.stage, saved = st.session?.state;
  st.face = {}; st.matched = new Set(); st.flips = saved?.flips || 0; st.open = null; st.lock = false;
  (saved?.matched || []).forEach(([i, sym]) => { st.face[i] = sym; st.matched.add(i); });
  if (saved?.open) { st.face[saved.open[0]] = saved.open[1]; st.open = saved.open[0]; }
  const draw = () => {
    $('#gBoard').innerHTML = `<p class="g-help">Tap two cards. Find all 8 pairs. Flips: <b>${st.flips}</b></p>
      <div class="memgrid">${[...Array(16).keys()].map(i => `<button data-i="${i}" class="${st.matched.has(i) ? 'done' : st.face[i] ? 'up' : ''}" aria-label="${st.face[i] ? 'Card ' + st.face[i] : 'Face-down card'}">${st.face[i] ? esc(st.face[i]) : ''}</button>`).join('')}</div>`;
    $$('.memgrid [data-i]').forEach(b => b.onclick = () => tap(Number(b.dataset.i)));
  };
  const tap = async i => {
    if (st.lock || st.done || st.matched.has(i) || i === st.open) return;
    st.lock = true;
    const r = await sendMove({ card: i });
    if (!r || r.error) { st.lock = false; return; }
    if (r.card) { st.open = i; st.face[i] = r.card.s; st.lock = false; return draw(); }
    st.flips++; st.face[r.a.i] = r.a.s; st.face[r.b.i] = r.b.s; st.open = null; draw();
    if (r.match) { st.matched.add(r.a.i); st.matched.add(r.b.i); st.lock = false; draw(); if (r.solved) finish(); return; }
    setTimeout(() => { delete st.face[r.a.i]; delete st.face[r.b.i]; st.lock = false; draw(); }, 900);
  };
  draw();
  if (st.matched.size === 16) finish();
}

// Minesweeper
function renderMines() {
  const st = state.stage, w = MINES.w, h = MINES.h;
  st.cells = {}; (st.session?.state?.revealed || []).forEach(([i, n]) => { st.cells[i] = n; });
  st.flags = new Set(); st.flagMode = false; st.busy = false;
  const draw = () => {
    $('#gBoard').innerHTML = `<p class="g-help">Open every square without a mine. Numbers count the mines touching a square. Press and hold a square to flag it. Mines: ${st.puzzle.n || MINES.n} · Flags: ${st.flags.size}</p>
      <div class="mgrid" style="grid-template-columns:repeat(${w},1fr)">${[...Array(w * h).keys()].map(i => {
        const n = st.cells[i];
        return n !== undefined ? `<button data-i="${i}" class="open n${n}" disabled>${n || ''}</button>` : `<button data-i="${i}" class="${st.flags.has(i) ? 'flag' : ''}" aria-label="Closed square">${st.flags.has(i) ? '⚑' : ''}</button>`;
      }).join('')}</div>
      <div class="g-actions"><button class="btn ghost" id="gFlag" aria-pressed="${st.flagMode}">${st.flagMode ? '⚑ Flag mode on: tap to flag' : '⚑ Flag mode off: tap to open'}</button></div>`;
    $$('.mgrid [data-i]:not(.open)').forEach(b => {
      const i = Number(b.dataset.i);
      // Press and hold (about half a second) flags a square on phones; right-click flags on a computer.
      // The board is redrawn after a flag, so the click that follows a hold is ignored by time, not by element.
      let hold = null;
      b.onpointerdown = e => { if (e.pointerType === 'mouse' && e.button !== 0) return; clearTimeout(hold); hold = setTimeout(() => { st.ignoreClickUntil = Date.now() + 800; navigator.vibrate?.(30); flag(i); }, 450); };
      b.onpointerup = b.onpointerleave = b.onpointercancel = () => clearTimeout(hold);
      b.onclick = () => { if (Date.now() < (st.ignoreClickUntil || 0)) return; tap(i); };
      b.oncontextmenu = e => { e.preventDefault(); if (Date.now() < (st.ignoreClickUntil || 0)) return; flag(i); };
    });
    $('#gFlag').onclick = () => { st.flagMode = !st.flagMode; draw(); };
  };
  const flag = i => { st.flags.has(i) ? st.flags.delete(i) : st.flags.add(i); draw(); };
  const tap = async i => {
    if (st.busy || st.done) return;
    if (st.flagMode) return flag(i);
    if (st.flags.has(i)) return;
    st.busy = true;
    const r = await sendMove({ cell: i }); st.busy = false;
    if (!r || r.error) return;
    if (r.lost) { (r.mines || []).forEach(m => { const b = document.querySelector(`.mgrid [data-i="${m}"]`); if (b) { b.classList.add('mine'); b.textContent = '✹'; } }); return; }
    (r.opened || []).forEach(([k, n]) => { st.cells[k] = n; st.flags.delete(k); });
    draw();
    if (r.solved) finish();
  };
  draw();
  if (Object.keys(st.cells).length === MINES.w * MINES.h - (st.puzzle.n || MINES.n)) finish();
}

// Kadena 2048: every swipe goes to the server, which slides, merges and adds the new tile.
function renderK2048() {
  const st = state.stage, saved = st.session?.state;
  st.board = saved?.board || Array(16).fill(0); st.score = saved?.score || 0; st.busy = false;
  const target = st.puzzle.target;
  const draw = () => {
    const best = Math.max(...st.board);
    $('#gBoard').innerHTML = `<p class="g-help">Swipe, or use the arrow keys. Equal tiles merge. Build a <b>${target}</b> tile to win. Score: <b>${st.score}</b> · Best tile: <b>${best}</b></p>
      <div class="k2048" role="grid" aria-label="2048 board">${st.board.map(v => `<div class="t v${Math.min(v, 4096)}">${v ? (v >= target ? 'K ' + v : v) : ''}</div>`).join('')}</div>
      <div class="k2048-pad" aria-label="Move"><button data-dir="up" aria-label="Up">▲</button><div><button data-dir="left" aria-label="Left">◀</button><button data-dir="down" aria-label="Down">▼</button><button data-dir="right" aria-label="Right">▶</button></div></div>`;
    $$('.k2048-pad [data-dir]').forEach(b => b.onclick = () => go(b.dataset.dir));
  };
  const go = async dir => {
    if (st.busy || st.done) return; st.busy = true;
    const r = await sendMove({ dir }); st.busy = false;
    if (!r || r.error) return;
    st.board = r.board; st.score = r.score; draw();
    if (r.solved) finish();
  };
  draw();
  document.onkeydown = e => { const d = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]; if (d) { e.preventDefault(); go(d); } };
  let sx = 0, sy = 0;
  const board = $('#gBoard');
  board.ontouchstart = e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; };
  board.ontouchend = e => { const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')); };
  if (Math.max(...st.board) >= target) finish();
}

// Spot the Pact Bug
function renderPactbug() {
  const st = state.stage;
  $('#gBoard').innerHTML = `<form class="gq" id="gForm">
    <div class="qn"><p>This Pact function has one security mistake. Which is it?</p><pre class="pact"><code>${esc(st.puzzle.code)}</code></pre></div>
    <fieldset class="qn">${st.puzzle.options.map((o, k) => `<label><input type="radio" name="bug" value="${k}" required> ${esc(o)}</label>`).join('')}</fieldset>
    <div class="qn"><p>In your own words: why is it dangerous, or how would you fix it?</p><textarea id="gWritten" maxlength="1200" placeholder="A sentence or two is enough." required></textarea></div>
    <div class="g-actions"><button class="btn orange" type="submit">Submit answer</button></div></form>`;
  $('#gForm').onsubmit = e => { e.preventDefault(); if ($('#gWritten').value.trim().length < 20) return notify('Write at least a full sentence.'); finish(); };
}

function playData() {
  const st = state.stage;
  if (st.game === 'pactbug') { const c = document.querySelector('input[name=bug]:checked'); return { choice: c ? Number(c.value) : -1, written: $('#gWritten').value }; }
  if (['word', 'memory', 'mines', 'k2048'].includes(st.game)) return {};
  if (st.game === 'tiles') return { moves: st.moves, times: st.times };
  if (st.game === 'logic') return { grid: st.grid, entries: st.entries };
  if (st.game === 'quiz') return { choices: st.puzzle.questions.map((_, i) => { const c = document.querySelector(`input[name=q${i}]:checked`); return c ? Number(c.value) : -1; }), written: $('#gWritten').value };
  return { answers: st.puzzle.riddles.map((_, i) => $('#r' + i).value) };
}
async function finish() {
  const st = state.stage; if (!st || st.done) return; st.done = true; clearInterval(timer);
  const ms = performance.now() - st.t0;
  if (st.mode === 'practice') {
    const extra = st.game === 'tiles' ? ` with ${st.moves.length} moves` : st.game === 'memory' ? ` with ${st.local.flips} flips` : '';
    openStage(`<div class="g-result"><h3>Solved!</h3><p>You finished in ${clock(ms)}${extra}. In a paid round, a win like this is reviewed and paid by the AI agent.</p>
      <div class="g-actions" style="width:100%;max-width:380px"><button class="btn ghost" id="gBack">Back to games</button><button class="btn" id="gAgain">Play again</button></div></div>`);
    $('#gBack').onclick = closeStage; $('#gAgain').onclick = () => practice(st.game); return;
  }
  if (st.mode === 'challenge') return finishChallenge(st);
  let r;
  try { r = await api(`/games/sessions/${st.session.id}/finish`, { play: playData() }); }
  catch (e) {
    st.done = false; notify(e.message);
    const bar = document.getElementById('gRetry') || Object.assign(document.createElement('div'), { id: 'gRetry', className: 'g-actions' });
    bar.innerHTML = '<button class="btn orange" id="gRetryBtn">Submit again</button>';
    $('#gBoard')?.after(bar);
    $('#gRetryBtn').onclick = () => { bar.remove(); finish(); };
    return;
  }
  if (!r.solved) return showMiss(st, r);
  showWin(st.round, r.summary);
}
function showMiss(st, r) {
  {
    document.onkeydown = null;
    openStage(`<div class="g-result"><h3>Not this time</h3><p>${esc(r.message)}</p><p>${r.attempts_left > 0 ? `You have ${r.attempts_left} ${r.attempts_left === 1 ? 'try' : 'tries'} left in this round, each with a fresh puzzle.` : 'That was your last try in this round.'}</p>
      <div class="g-actions" style="width:100%;max-width:380px"><button class="btn ghost" id="gBack">Back to games</button>${r.attempts_left > 0 ? '<button class="btn orange" id="gAgain">Try again</button>' : ''}</div></div>`);
    $('#gBack').onclick = closeStage; if ($('#gAgain')) $('#gAgain').onclick = () => action($('#gAgain'), () => playPaid(st.round.id));
  }
}

// Follows a win from escrow reservation to payout.
function showWin(round, summary) {
  if (summary) coinBurst();
  openStage(`<div class="g-result"><h3>You won ${fmt(round?.reward)} KDA</h3>${summary ? `<p>${esc(summary)}</p>` : ''}
    <ul class="g-steps" id="gSteps"></ul><div class="links" id="gLinks"></div>
    <p class="note">The AI agent checks how the round was played. If anything looks unusual, a person reviews it instead, which can take longer.</p>
    <div class="g-actions" style="width:100%;max-width:380px"><button class="btn ghost" id="gBack">Back to games</button></div></div>`);
  $('#gBack').onclick = closeStage;
  const steps = [['reserving', 'Prize reserved for you in escrow'], ['in_review', 'AI agent reviewing your win'], ['approved', 'Payment sending'], ['paid', 'Paid to your wallet']];
  const order = ['reserving', 'in_review', 'approved', 'paid'];
  const update = async () => {
    try {
      state.me = await api('/me/games'); const m = myRound(round.id); if (!m) return;
      const status = m.status === 'payout_failed' ? 'approved' : m.status;
      const at = order.indexOf(status);
      $('#gSteps').innerHTML = steps.map(([k, label], i) => `<li class="${i < at || status === 'paid' ? 'done' : i === at ? 'now' : ''}">${label}</li>`).join('');
      if (m.status === 'reservation_failed') $('#gSteps').innerHTML = '<li>The escrow reservation did not go through. Play the round again while it is open.</li>';
      if (m.status === 'rejected') $('#gSteps').innerHTML = `<li>A reviewer did not approve this win.${m.review_note ? ' ' + esc(m.review_note) : ''}</li>`;
      $('#gLinks').innerHTML = m.status === 'paid' ? `${txLink(m.tx)}<a href="/ai-receipts/${esc(m.submission_id)}">AI receipt</a>` : '';
      if (m.status === 'paid' && !$('#gShare')) { $('#gLinks').insertAdjacentHTML('afterend', '<div id="gShare" class="g-share"></div>'); shareWin(m.submission_id, $('#gShare')).catch(() => {}); }
      if (['paid', 'rejected', 'reservation_failed'].includes(m.status)) clearInterval(tracker);
    } catch (e) { notify(e.message); }
  };
  update(); tracker = setInterval(update, 8000);
}

// ---------- Daily Challenge, streak, weekly top players ----------
const ord = n => { const t = n % 100, u = n % 10; return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'); };
function renderDaily() {
  const box = $('#dailyBox'), ch = state.challenge, sk = state.streak; if (!box) return;
  if (!ch) { box.innerHTML = ''; return; }
  const m = ch.mine, pool = ch.pool;
  const prize = pool ? `Top ${ch.places} win a <b>${fmt(pool.reward)} KDA</b> bonus` : `Top ${ch.places} make the leaderboard`;
  let act;
  if (!state.user) act = '<button class="btn" data-connect>Connect wallet to play</button>';
  else if (m?.finished) act = m.solved ? `<span class="badge ok">${m.place ? `You're ${ord(m.place)}` : 'Done'} · ${m.moves} moves · ${clock(m.seconds * 1000)}</span>${m.flagged ? '<span class="state">Not ranked: the run looked automated</span>' : ''}` : '<span class="badge warn">Time ran out today</span>';
  else act = `<button class="btn orange" id="chPlay">${m?.active ? 'Resume today’s challenge' : 'Play today’s challenge'}</button><span class="state">One try a day · ${CHALLENGE_MIN} min</span>`;
  const rows = ch.top.slice(0, 5).map(e => `<li><span class="pl">${e.place}</span><span class="who">${esc(e.who)}</span><span>${e.moves} moves · ${clock(e.seconds * 1000)}</span></li>`).join('');
  const yest = ch.yesterday?.length ? `<p class="note">Yesterday: ${ch.yesterday.map(w => `${ord(w.place)} ${esc(w.who)}${w.bonus_kda ? ` (+${fmt(w.bonus_kda)} KDA)` : ''}`).join(' · ')}</p>` : '';
  const streak = sk ? `<div class="g-streak"><span class="flame" aria-hidden="true">🔥</span><div>${sk.current ? `<b>${sk.current}-day streak</b>${sk.played_today ? '' : ' · win a game today to keep it'}` : '<b>Start a streak</b> · win a game or solve the Daily Challenge today'}
      <p>${sk.current >= sk.goal ? (sk.pool ? `You reached ${sk.goal} days. Your ${fmt(sk.pool.reward)} KDA streak bonus is being prepared.` : `You reached ${sk.goal} days.`) : `${sk.goal - sk.current} more ${sk.goal - sk.current === 1 ? 'day' : 'days'} to ${sk.pool ? `a <b>${fmt(sk.pool.reward)} KDA</b> streak bonus` : `a ${sk.goal}-day streak`}`}</p>
      <div class="meter" aria-hidden="true"><i style="width:${Math.min(100, sk.current / sk.goal * 100)}%"></i></div></div></div>` : '';
  box.innerHTML = `<div class="panel g-challenge"><div class="gc-top"><span class="gc-icon">${ICON.tiles}</span><div><h3>Daily Challenge</h3><p>Same Sliding Tiles board for everyone today. ${prize}. New board in <span data-countdown="${esc(ch.ends_at)}">${untilText(ch.ends_at)}</span>.</p></div></div>
      ${rows ? `<ol class="g-board">${rows}</ol>` : '<p class="note">No one has finished today’s board yet. Be the first.</p>'}
      <p class="note">${ch.players} ${ch.players === 1 ? 'player' : 'players'} today</p>${yest}<div class="foot">${act}</div></div>${streak}`;
  $$('#dailyBox [data-connect]').forEach(b => b.onclick = () => action(b, connect));
  if ($('#chPlay')) $('#chPlay').onclick = () => action($('#chPlay'), playChallenge);
}
const CHALLENGE_MIN = 15;
async function playChallenge() {
  const s = await api('/games/challenge/start', {});
  begin({ mode: 'challenge', game: 'tiles', puzzle: s.puzzle, session: { started_at: s.started_at, expires_at: s.expires_at } });
}
async function finishChallenge(st) {
  let r;
  try { r = await api('/games/challenge/finish', { play: playData() }); }
  catch (e) { st.done = false; notify(e.message); return; }
  // Not solved yet (for example the browser clock ran a moment ahead of the server): keep the board open.
  if (!r.solved && r.retry) { st.done = false; notify(r.message); return; }
  if (r.solved) coinBurst();
  openStage(`<div class="g-result"><h3>${r.solved ? (r.place ? `You're ${ord(r.place)} today` : 'Solved!') : 'Not this time'}</h3>
    <p>${r.solved ? `${r.moves} moves in ${clock(r.seconds * 1000)}.${r.flagged ? ' This run looked automated, so it is not ranked.' : ' The top 3 at 03:00 Riyadh (00:00 UTC) win the bonus.'}` : esc(r.message)}</p>
    <div class="g-actions" style="width:100%;max-width:380px"><button class="btn ghost" id="gBack">Back to games</button></div></div>`);
  $('#gBack').onclick = closeStage;
}
function renderWeekly() {
  const box = $('#weekly'), w = state.weekly; if (!box) return;
  if (!w?.top.length) { box.innerHTML = ''; return; }
  const lead = Number(w.top[0].kda) || 1, medal = ['🥇', '🥈', '🥉'];
  // TikTok-style battle bar between #1 and #2, and a little race track on every row.
  const [a, b] = w.top, battle = b ? (() => {
    const ka = Number(a.kda), kb = Number(b.kda), pa = Math.max(12, Math.min(88, ka / (ka + kb) * 100)), gap = ka - kb;
    return `<div class="g-battle" aria-label="Race for first place">
      <div class="side left"><span class="face" aria-hidden="true">👑</span><span class="who">${esc(a.who)}${a.you ? ' (you)' : ''}</span><b class="kda">${fmt(ka)}</b></div>
      <div class="bar"><i class="l" style="width:${pa}%"></i><i class="r" style="width:${100 - pa}%"></i><span class="spark" style="left:${pa}%" aria-hidden="true">⚡</span></div>
      <div class="side right"><b class="kda">${fmt(kb)}</b><span class="who">${esc(b.who)}${b.you ? ' (you)' : ''}</span><span class="face chase" aria-hidden="true">🏃‍♂️💨</span></div>
      <p class="taunt">${gap > 0 ? `${esc(b.who)} needs <b>${fmt(gap)} KDA</b> to take the crown 👀` : 'Neck and neck! Next win takes the lead 🔥'}</p>
    </div>`;
  })() : '';
  box.innerHTML = `<div class="pagehead"><div><h2>This week’s top players</h2><p>KDA won in games and bonuses since Monday (00:00 UTC).</p></div></div>${battle}
    <ol class="g-board wide race">${w.top.map((e, i) => {
      const pct = Math.max(4, Math.min(100, Number(e.kda) / lead * 100));
      return `<li class="${e.you ? 'you' : ''}"><span class="pl">${medal[i] || e.place}</span>
        <span class="who">${esc(e.who)}${e.you ? ' (you)' : ''}${e.hot ? ' <span title="Won in the last 24 hours">🔥</span>' : ''}</span>
        <span>${e.wins} ${e.wins === 1 ? 'win' : 'wins'}</span><b class="kda">${fmt(e.kda)}</b>
        <span class="track" aria-hidden="true"><i style="width:${pct}%"></i><span class="runner${i > 0 && (i - 1) % 6 < 4 ? ' flip' : ''}" style="left:${pct}%">${i === 0 ? '👑' : ['🏎️', '🐎', '🏃', '🚴', '🛹', '🐢'][(i - 1) % 6]}</span></span></li>`;
    }).join('')}</ol>`;
}

// ---------- Share a win ----------
// A paid win can be posted to X (text + link to its /win page, which shows a preview) or saved as an image.
async function shareWin(id, into) {
  let w; try { w = await api(`/games/wins/${id}`); } catch { return notify('This win is still confirming on Chainweb. Try again in a minute.'); }
  const url = `${location.origin}/win/${w.id}`;
  const text = `I solved ${w.game_name} and won ${fmt(w.reward)} KDA${w.ai ? ', reviewed and paid by an AI agent' : ''} on #Kadena 🎮\n\n${w.result}\n\nPlay Kadena Nexus Games:`;
  const x = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&via=KadenaNexus`;
  const html = `<h4>Share your win</h4><div class="g-share-row"><a class="btn orange" href="${esc(x)}" target="_blank" rel="noopener noreferrer">Post on X</a>
    <button class="btn ghost" id="gSaveImg">Save image</button><button class="btn ghost" id="gCopyLink">Copy link</button></div>`;
  let box = into;
  if (!box) { openStage(`<div class="g-result"><h3>You won ${fmt(w.reward)} KDA</h3><p>${esc(w.game_name)}: ${esc(w.result)}</p><div class="g-share" id="gShare"></div>
    <div class="g-actions" style="width:100%;max-width:380px"><button class="btn ghost" id="gBack">Back to games</button></div></div>`); $('#gBack').onclick = closeStage; box = $('#gShare'); }
  box.innerHTML = html;
  $('#gCopyLink').onclick = async () => { try { await navigator.clipboard.writeText(url); notify('Link copied.'); } catch { notify(url); } };
  $('#gSaveImg').onclick = () => { const a = document.createElement('a'); a.download = `kadena-win-${w.game}.png`; a.href = winImage(w); a.click(); };
}
function winImage(w) {
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 630; const g = cv.getContext('2d');
  g.fillStyle = '#0B2028'; g.fillRect(0, 0, 1200, 630);
  for (let k = 0; k < 12; k++) { const x = 760 + (k * 137) % 420, y = 40 + (k * 151) % 560, r = 18 + (k * 7) % 28; g.fillStyle = '#16384A'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.fillStyle = '#1F4A5C'; g.font = `700 ${r}px Inter, system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('K', x, y + 1); }
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = '#B9CDD5'; g.font = '600 34px Inter, system-ui, sans-serif'; g.fillText('Kadena Nexus Games · Confirmed on Chainweb', 80, 120);
  g.fillStyle = '#F2F6F7'; g.font = '800 84px Inter, system-ui, sans-serif'; g.fillText(`Won ${fmt(w.reward)} KDA`, 80, 250);
  g.fillStyle = '#E2710A'; g.font = '800 60px Inter, system-ui, sans-serif'; g.fillText(w.game_name, 80, 335);
  g.fillStyle = '#F2F6F7'; g.font = '500 32px Inter, system-ui, sans-serif'; g.fillText(w.result.slice(0, 70), 80, 410);
  g.fillStyle = '#B9CDD5'; g.font = '500 30px Inter, system-ui, sans-serif'; g.fillText(`${w.who}${w.ai ? ' · reviewed and paid by an AI agent' : ''}`, 80, 470);
  g.fillStyle = '#E2710A'; g.beginPath(); g.roundRect(80, 520, 470, 60, 30); g.fill();
  g.fillStyle = '#123A48'; g.font = '700 30px Inter, system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('earn.kadena.ws/games', 315, 561);
  return cv.toDataURL('image/png');
}

// ---------- Start ----------
setupAmbience($('#soundBtn'));

// Decorative floating K coins and blocks behind the page; none for people who prefer reduced motion.
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
(function sky() {
  if (calm()) return;
  const layer = document.createElement('div'); layer.className = 'g-sky'; layer.setAttribute('aria-hidden', 'true');
  const n = innerWidth < 600 ? 9 : 16, r = (a, b) => a + Math.random() * (b - a);
  for (let k = 0; k < n; k++) {
    const coin = k % 3 !== 2, el = document.createElement('span');
    el.className = 'g-float ' + (coin ? 'coin' : 'block');
    el.style.cssText = `--x:${r(0, 96)}%;--s:${Math.round(coin ? r(18, 38) : r(10, 22))}px;--o:${r(0.1, 0.22).toFixed(2)};--d:${r(18, 34).toFixed(1)}s;--delay:${-r(0, 34).toFixed(1)}s;--dx:${Math.round(r(-60, 60))}px;--f:${r(3, 7).toFixed(1)}s`;
    el.innerHTML = coin ? '<i>K</i>' : '<i></i>';
    layer.append(el);
  }
  document.body.prepend(layer);
})();
// A shower of K coins when a round is won.
function coinBurst() {
  if (calm() || !document.body.animate) return;
  const cx = innerWidth / 2, cy = innerHeight / 3;
  for (let k = 0; k < 26; k++) {
    const el = document.createElement('span'); el.className = 'g-burst'; el.textContent = 'K'; el.setAttribute('aria-hidden', 'true');
    el.style.left = cx + 'px'; el.style.top = cy + 'px'; document.body.append(el);
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 220;
    el.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d - 60}px)) scale(1) rotate(${Math.random() * 360}deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d * 1.2}px), calc(-50% + ${innerHeight}px)) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
      { duration: 1800 + Math.random() * 900, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => el.remove();
  }
}
async function init() {
  try {
    state.config = await api('/config');
    const s = await api('/auth/session'); state.user = s.user; state.csrf = s.csrf; sessionUI();
    const email = new URLSearchParams(location.search).get('email');
    if (email) { notify({ confirmed: 'Email confirmed. You can play for KDA now.', taken: 'That email is already confirmed for another wallet.', invalid: 'That confirmation link has expired or was already used.' }[email] || ''); history.replaceState(null, '', '/games.html'); }
    await load();
    setInterval(() => { if (!document.hidden && !$('#lobby').hidden) load().catch(() => {}); }, 20000);
    setInterval(() => $$('[data-countdown]').forEach(el => { el.textContent = untilText(el.dataset.countdown); if (Date.parse(el.dataset.countdown) <= Date.now()) load().catch(() => {}); }), 30000);
  } catch (e) { notify(e.message); $('#rounds').innerHTML = '<div class="empty-card">Unable to load games. Refresh in a moment.</div>'; }
}
init();
