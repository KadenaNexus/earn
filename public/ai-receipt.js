// Public receipt of an AI payout. Recomputes the receipt's SHA-256 in the browser
// and compares it with the fingerprint the server recorded for the payout.
const $ = selector => document.querySelector(selector);
const id = /^\/ai-receipts\/([0-9a-f-]{36})\/?$/i.exec(location.pathname)?.[1];

try {
  const theme = localStorage.getItem('ke-theme');
  if (['dark', 'light'].includes(theme)) document.documentElement.dataset.theme = theme;
} catch {}

const set = (selector, value) => { $(selector).textContent = value == null || value === '' ? '—' : String(value); };
function check(tone, label, title, text) {
  $('#check-icon').className = `badge ${tone}`;
  set('#check-icon', label);
  set('#check-title', title);
  set('#check-text', text || '');
}
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function txLink(key) {
  const a = document.createElement('a');
  a.href = `/transactions/${encodeURIComponent(key)}`;
  a.textContent = key;
  return a;
}

async function load() {
  if (!id) return check('bad', 'Not found', 'This receipt link is not valid.');
  try {
    const response = await fetch(`/api/ai-receipts/${id}`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) return check('bad', 'Not found', data.error || 'No AI receipt for this submission.');
    const r = JSON.parse(data.receipt);
    set('#r-task', r.task);
    set('#r-reward', `${Number(r.reward_kda)} KDA`);
    set('#r-recipient', r.recipient);
    set('#r-decision', `${r.decision === 'approve' ? 'Approved' : r.decision} · ${Math.round(Number(r.confidence) * 100)}% confidence`);
    set('#r-model', r.model);
    set('#r-at', new Date(r.reviewed_at).toLocaleString());
    set('#r-reasons', r.reasons ?? 'Not public: the contributor chose not to publish their proof.');
    set('#r-hash', data.receipt_sha256);
    set('#r-raw', data.receipt);
    const payout = $('#r-payout');
    if (data.payout.tx) {
      $('#r-key').replaceChildren(txLink(data.payout.tx));
      payout.replaceChildren(document.createTextNode(data.payout.status === 'confirmed' ? 'Confirmed on chain · ' : `${data.payout.status} · `), txLink(data.payout.tx));
    } else set('#r-payout', data.payout.status || 'Not sent yet');
    const ok = (await sha256(data.receipt)) === data.receipt_sha256;
    if (!ok) return check('bad', 'Mismatch', 'This receipt does not match its fingerprint.', 'The text was changed after the payment. Do not trust it.');
    check('ok', 'Verified', 'The receipt matches its fingerprint.',
      data.payout.status === 'confirmed'
        ? 'The same fingerprint is in the payout transaction on Kadena. See the steps below to check it on any explorer.'
        : 'The payout is not confirmed on chain yet. Check back in a few minutes.');
  } catch (error) {
    check('bad', 'Error', 'Could not load this receipt.', error.message);
  }
}
load();
