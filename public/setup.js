import { EckoWallet } from './wallet.js';

const $ = selector => document.querySelector(selector);
const state = { config: null, user: null, csrf: null, status: null, prepared: null, busy: false };
let wallet, pollingTimer, pollingRemaining = 0;

try {
  const theme = localStorage.getItem('ke-theme');
  if (['dark', 'light'].includes(theme)) document.documentElement.dataset.theme = theme;
} catch {}

function notify(message, title = 'Setup update') {
  $('#notice-title').textContent = title;
  $('#notice').textContent = message;
  $('#notice-card').hidden = false;
}
function isOwner() { return !!state.user && state.user.account === state.config?.admin_account; }
function expiresSoon() {
  return !state.prepared || Date.parse(state.prepared.review.expires_at) <= Date.now() + 15000;
}
function controls() {
  const owner = isOwner(), enabled = owner && state.status?.enabled;
  const available = job => !job || job.status === 'failed';
  $('#connect').disabled = state.busy || !state.config;
  $('#connect').textContent = state.user ? 'Disconnect wallet' : 'Connect owner Ecko wallet';
  $('#prepare-install').disabled = state.busy || !enabled || !available(state.status?.install) || !!state.prepared;
  $('#prepare-gas').disabled = state.busy || !enabled || state.status?.install?.status !== 'confirmed' || !available(state.status?.gas) || !!state.prepared;
  $('#check').disabled = state.busy || !owner;
  $('#sign').disabled = state.busy || !enabled || expiresSoon();
}
function connection() {
  $('#network').textContent = state.config ? `${state.config.network} · Chain ${state.config.chain}` : 'Network unavailable';
  $('#connection-status').textContent = isOwner() ? 'Owner connected' : state.user ? 'Owner wallet required' : 'Wallet not connected';
  $('#connection-status').className = `badge ${isOwner() ? 'ok' : 'warn'}`;
  $('#connection-message').textContent = isOwner()
    ? state.user.account
    : state.config ? `Connect ${state.config.admin_account} in desktop Ecko to activate the escrow.` : 'Unable to load application configuration. Refresh to retry.';
  $('#status-card').hidden = !isOwner();
  if (!isOwner()) clearPrepared();
  controls();
}
async function api(path, body) {
  const headers = {};
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    if (state.csrf) headers['x-csrf-token'] = state.csrf;
  }
  const response = await fetch('/api' + path, {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Unable to complete the setup request.');
  return data;
}
async function session() {
  const current = await api('/auth/session');
  state.user = current.user; state.csrf = current.csrf;
  connection();
}
function renderJob(kind, job) {
  const labels = { prepared: 'Saved; awaiting broadcast', broadcast: 'Submitted; waiting for confirmation', confirmed: 'Confirmed', failed: 'Confirmed transaction failure' };
  $('#' + kind + '-status').textContent = job ? labels[job.status] || job.status : 'Not submitted';
  const link = $('#' + kind + '-link');
  link.hidden = !/^[A-Za-z0-9_-]{43}$/.test(job?.request_key || '');
  if (!link.hidden) {
    link.href = '/transactions/' + encodeURIComponent(job.request_key);
    link.textContent = job.request_key;
  } else { link.removeAttribute('href'); link.textContent = ''; }
  $('#' + kind + '-error').hidden = !job?.error;
  $('#' + kind + '-error').textContent = job?.error || '';
}
function renderStatus(status) {
  if (status.owner !== state.config.admin_account || status.network !== state.config.network || status.chain !== state.config.chain) {
    throw new Error('The setup owner or network does not match this application.');
  }
  state.status = status;
  $('#owner').textContent = status.owner;
  $('#module').textContent = status.module || 'Awaiting setup configuration';
  $('#operations-account').textContent = status.operations_account || 'Awaiting setup configuration';
  $('#setup-network').textContent = `${status.network} · Chain ${status.chain}`;
  $('#operations-balance').textContent = status.operations_balance_kda == null ? 'Not available yet' : `${status.operations_balance_kda} KDA`;
  renderJob('install', status.install); renderJob('gas', status.gas);
  $('#readiness').textContent = status.active
    ? 'Production escrow is active. Return to Kadena Earn to create and fund campaigns.'
    : status.ready
    ? 'Both setup transactions are confirmed. The escrow is ready for application activation.'
    : !status.enabled ? 'Owner setup is currently disabled. Contact the application operator to enable setup.'
      : status.gas?.status === 'confirmed' ? 'Checking the installed contract and gas account.'
        : status.install?.status === 'confirmed' ? 'The installation is confirmed. Prepare and approve operations gas funding next.'
          : status.install ? 'Wait for the installation confirmation before funding operations gas.'
            : 'Prepare the installation to review its owner, permissions, source and gas limit.';
  if (state.prepared && status[state.prepared.kind]?.status && status[state.prepared.kind].status !== 'failed') clearPrepared();
  controls();
}
async function checkStatus() {
  await session();
  if (!isOwner()) throw new Error('Sign in with the production owner wallet to check setup.');
  renderStatus(await api('/admin/setup/status'));
}
function clearPrepared() {
  state.prepared = null;
  $('#review-card').hidden = true;
  $('#review').textContent = ''; $('#source').textContent = ''; $('#expiry').textContent = '';
}
function validatePlan(plan, kind) {
  if (!plan?.id || !plan.command || typeof plan.source !== 'string' || !plan.review) throw new Error('The setup preparation is incomplete.');
  const body = JSON.parse(plan.command.cmd), review = plan.review, owner = state.config.admin_account;
  if (review.owner !== owner || review.network !== state.config.network || review.chain !== state.config.chain || review.module !== state.status.module || review.operations_account !== state.status.operations_account || body.networkId !== review.network || body.meta.chainId !== review.chain || body.meta.sender !== owner || body.signers.length !== 1 || body.signers[0].pubKey !== owner.slice(2) || body.payload.exec.code !== plan.source || review.request_key !== plan.command.hash || JSON.stringify(review.data) !== JSON.stringify(body.payload.exec.data) || JSON.stringify(review.signers) !== JSON.stringify(body.signers) || JSON.stringify(review.meta) !== JSON.stringify(body.meta)) {
    throw new Error('The prepared transaction does not match the displayed owner, network or contract.');
  }
  const ceiling = kind === 'install' ? 0.01 : 0.0015;
  if (!/^[A-Za-z0-9_-]{43}$/.test(review.request_key) || !/^[0-9a-f]{64}$/.test(review.source_sha256) || !/^[A-Za-z0-9_-]{43}$/.test(review.expected_module_hash) || !(body.meta.gasLimit > 0) || !(body.meta.gasPrice > 0) || body.meta.gasLimit * body.meta.gasPrice > ceiling + Number.EPSILON || Math.abs(Number(review.maximum_gas_kda) - body.meta.gasLimit * body.meta.gasPrice) > Number.EPSILON || Date.parse(review.expires_at) !== (body.meta.creationTime + body.meta.ttl) * 1000) {
    throw new Error('The transaction review has an invalid gas limit, hash or expiry.');
  }
  if (kind === 'install') {
    if (Number(review.amount_transferred_kda) !== 0 || body.signers[0].clist.length !== 0) throw new Error('Unexpected installation transfer or permissions.');
  } else {
    const capabilities = [{ name: 'coin.GAS', args: [] }, { name: 'coin.TRANSFER', args: [owner, review.operations_account, 0.05] }];
    if (Number(review.amount_transferred_kda) !== 0.05 || JSON.stringify(body.signers[0].clist) !== JSON.stringify(capabilities)) throw new Error('Unexpected operations gas transfer or permissions.');
  }
}
async function prepare(kind) {
  await checkStatus();
  const plan = await api('/admin/setup/prepare', { kind });
  validatePlan(plan, kind);
  state.prepared = { ...plan, kind };
  $('#review').textContent = JSON.stringify(plan.review, null, 2);
  $('#source').textContent = plan.source;
  $('#sign').textContent = kind === 'install' ? 'Sign and submit installation with Ecko' : 'Sign and submit 0.05 KDA gas funding with Ecko';
  $('#review-card').hidden = false;
  updateExpiry(); controls();
  $('#review-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function updateExpiry() {
  if (!state.prepared) return;
  const expires = Date.parse(state.prepared.review.expires_at);
  if (expires <= Date.now() + 15000) {
    $('#expiry').textContent = 'This unsigned preparation expired. Prepare a fresh transaction before signing.';
    state.prepared = null;
  } else {
    $('#expiry').textContent = `Sign before ${new Date(expires - 15000).toLocaleString()}. Review the exact transaction and full Pact code above, then approve it directly in Ecko.`;
  }
  controls();
}
function pending() { return ['install', 'gas'].some(kind => ['prepared', 'broadcast'].includes(state.status?.[kind]?.status)); }
function schedulePolling() {
  clearTimeout(pollingTimer);
  if (pollingRemaining <= 0 || !isOwner()) return;
  pollingTimer = setTimeout(async () => {
    if (state.busy || document.hidden) { schedulePolling(); return; }
    pollingRemaining--;
    try { await checkStatus(); } catch (error) { notify(error.message, 'Confirmation check'); }
    if (pending()) schedulePolling();
  }, 10000);
}
async function run(action) {
  if (state.busy) return;
  state.busy = true; controls();
  try { await action(); }
  catch (error) { notify(error.name === 'TimeoutError' ? 'The request timed out. Check confirmations before preparing another transaction.' : error.message || 'Unable to complete setup.', 'Setup needs attention'); }
  finally { state.busy = false; controls(); }
}
$('#connect').addEventListener('click', () => run(async () => {
  if (state.user) {
    await api('/auth/logout', {});
    state.user = null; state.csrf = null; state.status = null;
    clearTimeout(pollingTimer); pollingRemaining = 0; connection();
    return;
  }
  wallet = new EckoWallet();
  const account = await wallet.connect(state.config.network);
  if (account !== state.config.admin_account) throw new Error(`Select the production owner account ${state.config.admin_account} in Ecko, then reconnect.`);
  const challenge = await api('/auth/nonce', { account });
  const signed_command = await wallet.sign(challenge.command);
  const current = await api('/auth/verify', { account, nonce: challenge.nonce, signed_command });
  state.user = current.user; state.csrf = current.csrf; connection();
  await checkStatus();
  notify('Owner wallet connected. Sign-in did not spend KDA.');
}));
$('#prepare-install').addEventListener('click', () => run(() => prepare('install')));
$('#prepare-gas').addEventListener('click', () => run(() => prepare('gas')));
$('#check').addEventListener('click', () => run(checkStatus));
$('#sign').addEventListener('click', () => run(async () => {
  const plan = state.prepared;
  if (!plan || expiresSoon()) throw new Error('Prepare a fresh transaction before signing.');
  await session();
  if (!isOwner()) throw new Error('Reconnect the production owner wallet before signing.');
  wallet ||= new EckoWallet();
  if (await wallet.connect(state.config.network) !== state.config.admin_account) throw new Error('The selected Ecko account is not the production owner.');
  validatePlan(plan, plan.kind);
  if (Date.parse(plan.review.expires_at) <= Date.now() + 15000) throw new Error('This preparation expired while connecting Ecko. Prepare again.');
  const signed_command = await wallet.sign(plan.command);
  clearPrepared(); controls();
  try {
    await api('/admin/setup/signed', { id: plan.id, signed_command });
    notify('Your exact signed transaction is saved. Waiting for broadcast and six-block confirmation.');
  } catch (error) {
    notify('The submission response could not be confirmed. Use Check confirmations before preparing another transaction. ' + error.message, 'Check the saved transaction');
  }
  pollingRemaining = 60;
  try { await checkStatus(); } finally { schedulePolling(); }
}));

setInterval(updateExpiry, 1000);
run(async () => {
  state.config = await api('/config');
  await session();
  if (isOwner()) await checkStatus();
});
