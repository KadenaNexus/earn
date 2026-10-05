const $ = selector => document.querySelector(selector);
const match = /^\/transactions\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname);
const key = match?.[1];
let loading = false;

try {
  const theme = localStorage.getItem('ke-theme');
  if (['dark', 'light'].includes(theme)) document.documentElement.dataset.theme = theme;
} catch {}

const valueText = value => value == null ? '—' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
function setText(selector, value) { $(selector).textContent = valueText(value); }
function status(label, message, tone = 'warn') {
  setText('#status', label);
  $('#status').className = `badge ${tone}`;
  setText('#message', message);
}
async function readJSON(path) {
  const response = await fetch(path, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  return { response, data };
}
function renderTransfers(events) {
  const transfers = Array.isArray(events) ? events.filter(event => event?.name === 'TRANSFER' && event.module?.name === 'coin' && !event.module.namespace && Array.isArray(event.params) && event.params.length === 3) : [];
  $('#transfers').replaceChildren();
  for (const event of transfers) {
    const row = document.createElement('tr');
    event.params.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.className = index === 2 ? 'amount' : 'account';
      cell.textContent = valueText(value);
      row.append(cell);
    });
    $('#transfers').append(row);
  }
  $('#no-transfers').hidden = transfers.length > 0;
  $('#transfers-table').hidden = transfers.length === 0;
  $('#transfers-section').hidden = false;
}
function renderResult(transaction) {
  if (transaction.reqKey !== key || !Number.isFinite(transaction.metaData?.blockHeight) || !['success', 'failure'].includes(transaction.result?.status)) {
    throw new Error('The node returned an unexpected transaction result. Please retry.');
  }
  const success = transaction.result.status === 'success';
  status(success ? 'Confirmed · Success' : 'Confirmed · Failed', success ? 'This transaction passed the application’s Chainweb confirmation check.' : 'This transaction is confirmed on chain, but Pact reported a failure. Review the result below.', success ? 'ok' : 'bad');
  setText('#block-height', transaction.metaData.blockHeight);
  setText('#block-hash', transaction.metaData.blockHash);
  setText('#gas', transaction.gas);
  setText('#transaction-id', transaction.txId);
  setText('#result', transaction.result);
  setText('#raw', transaction);
  $('#result-section').hidden = false;
  $('#raw-section').hidden = false;
  renderTransfers(transaction.events);
}
async function load() {
  if (loading || !key) return;
  loading = true;
  $('#retry').disabled = true;
  $('#retry').textContent = 'Checking…';
  ['#block-height', '#block-hash', '#gas', '#transaction-id'].forEach(selector => setText(selector, null));
  ['#result-section', '#transfers-section', '#raw-section'].forEach(selector => { $(selector).hidden = true; });
  status('Checking transaction', 'Fetching the confirmed result from Chainweb.');
  try {
    const { response: configResponse, data: config } = await readJSON('/api/config');
    if (!configResponse.ok || typeof config.network !== 'string' || typeof config.chain !== 'string') {
      throw new Error('Network information is unavailable. Please retry.');
    }
    setText('#network', `${config.network === 'mainnet01' ? 'Kadena mainnet' : config.network === 'development' ? 'Local development chain' : `Kadena ${config.network}`} · Chain ${config.chain}`);
    setText('#network-id', config.network);
    setText('#chain-id', config.chain);
    const { response, data } = await readJSON(`/api/transactions/${key}`);
    if (response.status === 404) {
      status('Awaiting confirmation', 'A confirmed result is not available yet. The transaction may still be pending or unavailable on this network and chain. Retry to check again.');
      return;
    }
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Unable to read this transaction. Please retry.');
    renderResult(data);
  } catch (error) {
    status('Unable to check', error.name === 'TimeoutError' ? 'The confirmation check timed out. Please retry.' : error.message || 'Unable to read this transaction. Please retry.', 'warn');
  } finally {
    loading = false;
    $('#retry').disabled = false;
    $('#retry').textContent = 'Retry';
  }
}

$('#retry').addEventListener('click', load);
if (key) {
  setText('#request-key', key);
  document.title = `Transaction ${key.slice(0,8)}… · Kadena Earn`;
  load();
} else {
  setText('#network', 'Kadena Earn');
  status('Invalid request key', 'Open a transaction link from Kadena Earn. A Chainweb request key must contain exactly 43 letters, numbers, underscores or hyphens.', 'bad');
  $('#retry').disabled = true;
}
