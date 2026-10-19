// Phone wallets (Linx, Ecko app) over WalletConnect, with the same connect/sign
// interface as EckoWallet in wallet.js. Ported from Kadena Garden, where it was
// tested with Linx on mainnet. The WalletConnect and QR libraries are served from
// this site (public/vendor, rebuilt by scripts/build-vendor.sh), never a CDN.
// Pinned to @walletconnect/sign-client 2.20.3: from 2.21 on, connect() moves
// requiredNamespaces into optionalNamespaces and Kadena wallets refuse the proposal.
const PROJECT_ID = 'f4249de4e19f3c57f77d259b691a8d0e';
const METHODS = ['kadena_quicksign_v1', 'kadena_sign_v1', 'kadena_getAccounts_v1'];
const LIB = '/vendor/walletconnect-sign-client-2.20.3.js', QR = '/vendor/qrcode-1.5.4.js';

/** k: account from a WalletConnect session ("kadena:mainnet01:<public key>"). */
export function accountFromSession(s) {
  const raw = s?.namespaces?.kadena?.accounts?.[0];
  if (!raw) return null;
  let key = String(raw).split(':').pop();
  if (key.startsWith('k:')) key = key.slice(2);
  return /^[0-9a-f]{64}$/i.test(key) ? 'k:' + key.toLowerCase() : null;
}
/** The signature for pubKey in a quicksign answer. Wallets shape it differently (responses, results, quickSignData). */
export function sigFromAnswer(answer, pubKey) {
  let found = null, failure = null;
  (function walk(v, depth) {
    if (typeof v === 'string' && /^\s*[[{]/.test(v)) { try { v = JSON.parse(v); } catch { /* keep */ } }
    if (found || depth > 8 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(x => { if (typeof x === 'string' && /^[0-9a-f]{128}$/i.test(x) && !found) found = x.toLowerCase(); else walk(x, depth + 1); }); return; }
    const status = typeof v.result === 'string' ? v.result : typeof v.status === 'string' ? v.status : null;
    if (status && /^(failure|failed|error|nosig|rejected?)$/i.test(status)) failure = 'The wallet did not sign' + (v.msg || v.message ? ': ' + (v.msg || v.message) : '.');
    const s = typeof v.sig === 'string' ? v.sig : typeof v.signature === 'string' ? v.signature : null;
    const k = String(v.pubKey || v.publicKey || '').toLowerCase();
    if (s && /^[0-9a-f]{128}$/i.test(s) && (!k || k === pubKey)) found = s.toLowerCase();
    Object.keys(v).forEach(key => { if (key !== 'sig' && key !== 'signature') walk(v[key], depth + 1); });
  })(answer, 0);
  if (found) return found;
  if (failure) throw new Error(failure);
  throw new Error('The wallet approved but sent no signature for this account.');
}

let clientPromise = null, client = null;
function getClient() {
  clientPromise ||= import(LIB).then(mod => {
    const SignClient = mod.SignClient || mod.default?.SignClient || mod.default;
    return SignClient.init({ projectId: PROJECT_ID, metadata: { name: 'Kadena Earn', description: 'Tasks and games that pay KDA from escrow.', url: location.origin, icons: [location.origin + '/nexus-mark.png'] } });
  }).then(c => { client = c; return c; }).catch(e => { clientPromise = null; throw new Error('Could not load WalletConnect: ' + (e?.message || e)); });
  return clientPromise;
}
const hasStoredSession = () => { try { return Object.keys(localStorage).some(k => k.startsWith('wc@2')); } catch { return false; } };
function currentSession() {
  if (!client) return null;
  const now = Date.now() / 1000;
  const all = client.session.getAll().filter(s => s.namespaces?.kadena && s.expiry > now);
  return all.at(-1) || null;
}
const walletName = s => s?.peer?.metadata?.name || 'your phone wallet';

// ---------- Connection window ----------
let modal, cancelCurrent = null;
function ui() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'wc-modal'; modal.hidden = true;
  modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'wcTitle');
  modal.innerHTML = `<div class="wc-panel">
    <div class="wc-head"><h2 id="wcTitle">Connect your phone wallet</h2><button type="button" class="wc-x" aria-label="Close">✕</button></div>
    <p class="wc-step"></p>
    <div class="wc-qr" hidden><img alt="WalletConnect QR code" width="220" height="220"></div>
    <div class="wc-row" hidden><button type="button" class="btn ghost wc-copy">Copy link</button></div>
    <button type="button" class="btn ghost wc-reset" hidden>Start a new connection</button>
    <p class="wc-note">Easiest on a phone: open this page inside the Linx app (Explore), where it connects directly. Your key never leaves your wallet.</p>
  </div>`;
  document.body.append(modal);
  modal.querySelector('.wc-x').onclick = () => { cancelCurrent?.(); hide(); };
  modal.querySelector('.wc-reset').onclick = () => resetConnection();
  return modal;
}
const phone = () => matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) < 820;
function show(step, uri, title) {
  const m = ui(); m.hidden = false;
  m.querySelector('#wcTitle').textContent = title || 'Connect your phone wallet';
  m.querySelector('.wc-step').textContent = step;
  m.querySelector('.wc-reset').hidden = true;
  const qr = m.querySelector('.wc-qr'), row = m.querySelector('.wc-row');
  row.hidden = !uri; qr.hidden = true;
  if (!uri) return;
  m.querySelector('.wc-copy').onclick = () => navigator.clipboard?.writeText(uri).then(() => { m.querySelector('.wc-copy').textContent = 'Copied ✓'; });
  if (!phone()) import(QR).then(q => (q.default || q).toDataURL(uri, { width: 220, margin: 1 })).then(src => { qr.querySelector('img').src = src; qr.hidden = false; }).catch(() => {});
}
function hide() { if (!modal) return; modal.hidden = true; modal.querySelector('.wc-copy').textContent = 'Copy link'; }

async function connectSession(chain) {
  show('Loading WalletConnect…');
  let c;
  try { c = await getClient(); } catch (e) { hide(); throw e; }
  const existing = currentSession();
  if (existing) { hide(); return existing; }
  show('Preparing a secure connection…');
  const r = await c.connect({ requiredNamespaces: { kadena: { methods: METHODS, chains: [chain], events: [] } } });
  show(phone() ? 'Tap Copy link, open Linx, choose WalletConnect and paste the link. Approve, then come back to this page.' : 'Scan with Linx or the Ecko app, then approve the connection on your phone.', r.uri);
  const cancelled = new Promise((_, reject) => { cancelCurrent = () => reject(new Error('Connection cancelled.')); });
  try { return await Promise.race([r.approval(), cancelled]); }
  finally { cancelCurrent = null; hide(); }
}
async function resetConnection() {
  const s = currentSession(), cancel = cancelCurrent;
  if (s && client) {
    await Promise.race([client.disconnect({ topic: s.topic, reason: { code: 6000, message: 'User reset' } }).catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
    try { if (client.session.keys.includes(s.topic)) await client.session.delete(s.topic, { code: 6000, message: 'User reset' }); } catch { /* gone */ }
  }
  cancel?.(new Error('The old phone connection was removed. Connect again and approve in your wallet.'));
  hide();
}

export class PhoneWallet {
  constructor() { this.kind = 'phone'; this.chain = null; }
  static hasSession() { return hasStoredSession(); }
  async connect(network) {
    this.chain = `kadena:${network}`;
    const session = await connectSession(this.chain);
    const account = accountFromSession(session);
    if (!account) throw new Error(`${walletName(session)} did not share a single-key k: account.`);
    this.session = session; this.account = account;
    return account;
  }
  get name() { return walletName(this.session); }
  async sign(command) {
    const body = JSON.parse(command.cmd), pubKey = body.signers[0].pubKey;
    let session = currentSession();
    if (!session) { await this.connect(body.networkId); session = this.session; }
    if (accountFromSession(session) !== 'k:' + pubKey) throw new Error(`${walletName(session)} is connected as a different account. Switch accounts in your wallet, or disconnect and connect again.`);
    show(phone() ? `Open ${walletName(session)} and approve the request. It shows exactly what you are signing.` : `Approve the request in ${walletName(session)} on your phone. It shows exactly what you are signing.`, null, `Approve in ${walletName(session)}`);
    const cancelled = new Promise((_, reject) => { cancelCurrent = err => reject(err || new Error('Cancelled. Nothing was signed.')); });
    const offer = setTimeout(() => { if (cancelCurrent) modal.querySelector('.wc-reset').hidden = false; }, 15000);
    if (typeof client.ping === 'function') Promise.race([client.ping({ topic: session.topic }), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 10000))]).catch(() => {
      if (!cancelCurrent) return;
      modal.querySelector('.wc-step').textContent = `${walletName(session)} is not answering. Open it and keep it open. If the request still does not appear, start a new connection.`;
      modal.querySelector('.wc-reset').hidden = false;
    });
    let answer;
    try {
      answer = await Promise.race([client.request({ topic: session.topic, chainId: `kadena:${body.networkId}`, request: { method: 'kadena_quicksign_v1', params: { commandSigDatas: [{ cmd: command.cmd, sigs: [{ pubKey, sig: null }] }] } } }), cancelled]);
    } finally { clearTimeout(offer); cancelCurrent = null; hide(); }
    return { ...command, sigs: [{ sig: sigFromAnswer(answer, pubKey) }] };
  }
  async disconnect() {
    try { await getClient(); } catch { return; }
    const s = currentSession();
    if (s) await Promise.race([client.disconnect({ topic: s.topic, reason: { code: 6000, message: 'User disconnected' } }).catch(() => {}), new Promise(r => setTimeout(r, 3000))]);
  }
}
