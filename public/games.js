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
let wallet, timer, tracker;

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
  state.data = await api('/games');
  state.me = state.user ? await api('/me/games') : null;
  renderLobby();
}
const myRound = id => state.me?.rounds.find(r => Number(r.campaign_id) === Number(id));
function playButton(r) {
  const rules = state.data.rules, mine = myRound(r.id);
  if (!rules.writes) return '<button class="btn" disabled>Opens soon</button>';
  if (!state.user) return `<button class="btn" data-connect>Connect wallet to play</button>`;
  if (rules.email_required && !state.me.email_verified) return `<button class="btn" data-email>Confirm email to play</button>`;
  if (mine?.submission_id && mine.status !== 'reservation_failed') {
    if (mine.status === 'paid') return `<span class="badge ok">Won · paid</span>${mine.tx ? `<span class="state">${txLink(mine.tx)}</span>` : ''}`;
    if (mine.status === 'rejected') return '<span class="badge warn">Not approved</span>';
    return `<button class="btn ghost" data-track="${r.id}">Won · see payout</button>`;
  }
  if (mine?.active_session) return `<button class="btn orange" data-play="${r.id}">Resume</button>`;
  if (mine && Number(mine.attempts_used) >= rules.attempts) return '<button class="btn" disabled>No tries left</button>';
  if ((state.me.wins_today[r.game] || 0) >= rules.wins_per_day) return '<button class="btn" disabled>Won today · back tomorrow</button>';
  if (r.left < 1) return '<button class="btn" disabled>All prizes taken</button>';
  const triesLeft = rules.attempts - Number(mine?.attempts_used || 0);
  return `<button class="btn orange" data-play="${r.id}">Play for ${fmt(r.reward)} KDA</button><span class="state">${triesLeft} ${triesLeft === 1 ? 'try' : 'tries'} left</span>`;
}
function endsIn(deadline) { const h = (Date.parse(deadline) - Date.now()) / 3600000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`; }
function renderLobby() {
  const d = state.data, rules = d.rules;
  $('#gWins').textContent = fmt(d.stats.wins); $('#gKda').textContent = fmt(d.stats.kda);
  $('#gOpen').textContent = fmt(d.rounds.reduce((s, r) => s + Number(r.reward) * r.left, 0));
  $('#gFeed').innerHTML = d.recent.length ? d.recent.map(p => `<li><span class="who">${esc(p.who)}</span><b class="kda">${fmt(p.reward)}</b><span class="what">Won ${esc(d.games.find(g => g.id === p.game)?.name || 'a game')}</span><span class="tx">${p.tx ? `<a href="/transactions/${esc(p.tx)}?chain=1" target="_blank" rel="noopener noreferrer">${esc(short(p.tx))}</a>` : ''}</span>${p.ai ? `<a class="badge ai feed-ai" href="/ai-receipts/${esc(p.receipt)}">${ROBOT} Reviewed &amp; paid by AI agent</a>` : ''}</li>`).join('') : '<li class="empty">No wins paid yet. Be the first.</li>';
  $('#rulesLine').textContent = `One win per game per day · ${rules.attempts} tries per round${rules.email_required ? ' · confirmed email needed' : ''}`;
  renderEmail(); renderOwner();
  $('#rounds').innerHTML = d.rounds.length ? d.rounds.map(r => `<article class="game-card">
      <div class="gc-top"><span class="gc-icon">${ICON[r.game]}</span><div><h3>${esc(r.game_name)}</h3><span class="kda">${fmt(r.reward)}</span></div></div>
      <p>${esc(r.title)}</p>
      <div class="meta"><span>${r.left} of ${r.max} prizes left</span><span>Ends in ${endsIn(r.deadline)}</span><span>${r.minutes} min per try</span></div>
      <div class="foot">${playButton(r)}</div></article>`).join('')
    : `<div class="empty-card">No rounds are open right now. New rounds are announced on <a href="https://t.me/KadenaNexus">Telegram</a> and <a href="https://x.com/KadenaNexus">@KadenaNexus</a>.</div>`;
  $$('[data-connect]').forEach(b => b.onclick = () => action(b, connect));
  $$('[data-email]').forEach(b => b.onclick = () => { $('#emailCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#gEmail')?.focus(); });
  $$('[data-play]').forEach(b => b.onclick = () => action(b, () => playPaid(Number(b.dataset.play))));
  $$('[data-track]').forEach(b => b.onclick = () => showWin(d.rounds.find(r => Number(r.id) === Number(b.dataset.track)), null));
}
function renderEmail() {
  const card = $('#emailCard'), me = state.me;
  card.hidden = !state.user || me?.email_verified || !state.data.rules.email_required;
  if (card.hidden) return;
  if (!state.data.rules.email_ready) { card.innerHTML = '<h3>Email confirmation opens soon</h3><p>Paid rounds need a confirmed email. This is being switched on; practice is open now.</p>'; return; }
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
      <div class="field"><label for="oCount">Number of prizes</label><input id="oCount" type="number" min="1" max="1000" value="10"></div>
      <div class="field"><label for="oHours">Open for (hours)</label><input id="oHours" type="number" min="1" max="720" value="24"></div>
      <button class="btn" id="oGo">Fund round</button>
    </div><p id="oNote"></p>`;
  const note = () => { const total = Number($('#oReward').value) * Number($('#oCount').value); $('#oNote').textContent = `Total to fund: ${fmt(total)} KDA. AI payouts for games are limited to ${fmt(state.data.rules.ai_max_reward_kda)} KDA per win; larger prizes wait for you in Admin.`; };
  ['#oReward', '#oCount'].forEach(s => $(s).oninput = note); note();
  $('#oGo').onclick = () => action($('#oGo'), openRound);
}
async function openRound() {
  const game = $('#oGame').value, g = state.data.games.find(x => x.id === game);
  const day = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const body = { title: `${g.name} round – ${day}`, summary: `${g.blurb} Win KDA paid from escrow by the AI agent.`, sponsor_name: 'Kadena Nexus Games', category: 'Games', template: 'Game',
    reward_kda: String($('#oReward').value), max_rewards: Number($('#oCount').value), minutes_estimate: g.minutes,
    deadline: new Date(Date.now() + Number($('#oHours').value) * 3600000).toISOString(), steps: ['Play'], proof_schema: [{ key: 'result', label: 'Game result', type: 'text' }], game, featured: false, ai_review: true };
  wallet ||= restoreWallet(); const connected = await wallet.connect(state.config.network);
  if (connected !== state.user.account) throw new Error('Select the signed-in owner account in your wallet.');
  const created = await api('/admin/campaigns', body, { money: true });
  const prepared = await api(`/admin/campaigns/${created.campaign.id}/funding-command`, {});
  const signed_command = await wallet.sign(prepared.command);
  await api(`/admin/campaigns/${created.campaign.id}/confirm-funding`, { signed_command }, { money: true });
  notify('Funding sent. The round opens once Chainweb confirms it, usually within a few minutes.');
  await load();
}

// ---------- Stage ----------
function openStage(html) { clearInterval(timer); clearInterval(tracker); $('#lobby').hidden = true; const s = $('#stage'); s.hidden = false; s.innerHTML = html; scrollTo({ top: 0 }); }
function closeStage() { document.onkeydown = null; clearInterval(timer); clearInterval(tracker); state.stage = null; $('#stage').hidden = true; $('#lobby').hidden = false; load().catch(e => notify(e.message)); }
function bar(title, pills) {
  return `<div class="g-bar"><h2>${esc(title)}</h2><button class="g-back" id="gClose" aria-label="Back to games">← Games</button></div><div class="g-status">${pills}</div>`;
}
function startClock(el, mode, expiresAt) {
  const t0 = Date.now();
  const tick = () => {
    if (mode === 'paid') { const left = Date.parse(expiresAt) - Date.now(); el.textContent = `Time left ${clock(left)}`; el.classList.toggle('hot', left < 60000); if (left <= 0) { clearInterval(timer); finish(); } }
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
  state.stage = { ...st, t0: performance.now(), done: false };
  const name = state.data.games.find(g => g.id === st.game).name;
  const pills = `<span class="g-pill" id="gClock"></span>${st.mode === 'paid' ? `<span class="g-pill">Prize ${fmt(st.round?.reward)} KDA</span><span class="g-pill">${st.session.attempts_left} more ${st.session.attempts_left === 1 ? 'try' : 'tries'} after this</span>` : '<span class="g-pill">Practice</span>'}`;
  openStage(bar(name, pills) + '<div id="gBoard"></div>');
  $('#gClose').onclick = () => { if (state.stage?.mode === 'paid' && !state.stage.done && !confirm('Leave this puzzle? Your timer keeps running, and you can resume it from the games list.')) return; closeStage(); };
  startClock($('#gClock'), st.mode, st.session?.expires_at);
  ({ tiles: renderTiles, logic: renderLogic, quiz: renderQuiz, riddle: renderRiddle, word: renderWord, memory: renderMemory, mines: renderMines, pactbug: renderPactbug })[st.game]();
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
    if (r.over) { st.done = true; clearInterval(timer); setTimeout(() => showMiss(st, r), r.mines || r.word ? 1400 : 0); return r; }
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
}

// Minesweeper
function renderMines() {
  const st = state.stage, w = MINES.w, h = MINES.h;
  st.cells = {}; (st.session?.state?.revealed || []).forEach(([i, n]) => { st.cells[i] = n; });
  st.flags = new Set(); st.flagMode = false; st.busy = false;
  const draw = () => {
    $('#gBoard').innerHTML = `<p class="g-help">Open every square without a mine. Numbers count the mines touching a square. Mines: ${MINES.n} · Flags: ${st.flags.size}</p>
      <div class="mgrid" style="grid-template-columns:repeat(${w},1fr)">${[...Array(w * h).keys()].map(i => {
        const n = st.cells[i];
        return n !== undefined ? `<button data-i="${i}" class="open n${n}" disabled>${n || ''}</button>` : `<button data-i="${i}" class="${st.flags.has(i) ? 'flag' : ''}" aria-label="Closed square">${st.flags.has(i) ? '⚑' : ''}</button>`;
      }).join('')}</div>
      <div class="g-actions"><button class="btn ghost" id="gFlag" aria-pressed="${st.flagMode}">${st.flagMode ? '⚑ Flag mode on: tap to flag' : '⚑ Flag mode off: tap to open'}</button></div>`;
    $$('.mgrid [data-i]:not(.open)').forEach(b => {
      b.onclick = () => tap(Number(b.dataset.i));
      b.oncontextmenu = e => { e.preventDefault(); flag(Number(b.dataset.i)); };
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
  if (['word', 'memory', 'mines'].includes(st.game)) return {};
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
  let r;
  try { r = await api(`/games/sessions/${st.session.id}/finish`, { play: playData() }); }
  catch (e) { st.done = false; notify(e.message); return; }
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
      if (['paid', 'rejected', 'reservation_failed'].includes(m.status)) clearInterval(tracker);
    } catch (e) { notify(e.message); }
  };
  update(); tracker = setInterval(update, 8000);
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
  } catch (e) { notify(e.message); $('#rounds').innerHTML = '<div class="empty-card">Unable to load games. Refresh in a moment.</div>'; }
}
init();
