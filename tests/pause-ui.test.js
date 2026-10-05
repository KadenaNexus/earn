import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8'))
  .replace(/^import \{ EckoWallet \} from '\.\/wallet\.js';\n/, '')
  .replace(/\ninit\(\);\s*$/, '\n');
const account = 'k:' + 'a'.repeat(64);
const pending = { id: 'pause-job', request_key: 'b'.repeat(43) };
const kpi = (extra = {}) => ({
  escrow_locked: 0.2, paid_all_time: 0.1, awaiting_review: 1,
  approved_unpaid: 0.1, paused: false, pause_pending: null, ...extra,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture() {
  const elements = new Map(), calls = [], queues = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const el = {
        value: '', disabled: false, hidden: false,
        dataset: {}, attributes: {}, isConnected: true, innerWrites: 0,
        setAttribute(name, value) { this.attributes[name] = String(value); },
        removeAttribute(name) { delete this.attributes[name]; },
        classList: { add() {}, remove() {}, toggle() {} },
        matches(selector) { return selector === 'textarea,input' && this.tagName === 'TEXTAREA'; },
        focus() { document.activeElement = this; },
        set textContent(value) { this.text = String(value); },
        get textContent() { return this.text || ''; },
        set innerHTML(html) {
          this.html = html; ++this.innerWrites;
          // Model the only DOM replacement relevant to this regression: a render
          // creates a new review textarea and discards its unsaved contents.
          if (selector === '#admBody') {
            const note = html.match(/<textarea id="rvNote"[^>]*>([\s\S]*?)<\/textarea>/);
            if (note) elements.set('#rvNote', { value: note[1], tagName: 'TEXTAREA', matches: this.matches });
            else elements.delete('#rvNote');
          }
        },
        get innerHTML() { return this.html || ''; },
      };
      elements.set(selector, el);
    }
    return elements.get(selector);
  }
  const document = {
    documentElement: element('html'), activeElement: null, hidden: false,
    querySelector: element, querySelectorAll: () => [], addEventListener() {},
  };
  const defaults = {
    '/api/tasks': [], '/api/stats': { open_rewards: 0.2, paid_submissions: 1, kda_paid: 0.1 },
    '/api/payouts/recent': [], '/api/work': [], '/api/leaderboard': [],
    '/api/me/tasks': [], '/api/me/rewards': { paid: 0.1, review: 0.2, approved: 0.1 },
    '/api/admin/kpi': kpi({pause_job:null}), '/api/reviewer/submissions': [],
    '/api/admin/pause-command': { command: { hash: 'prepared-command' } },
    '/api/admin/pause': { job_id: pending.id, request_key: pending.request_key },
  };
  const wallet = {
    connectCalls: 0, signCalls: 0,
    connectResult: account, signResult: { hash: pending.request_key },
    async connect(network) { ++this.connectCalls; assert.equal(network, 'mainnet01'); return this.connectResult; },
    async sign(command) { ++this.signCalls; assert.equal(command.hash, 'prepared-command'); return this.signResult; },
  };
  const context = vm.createContext({
    document, window: { scrollTo() {} }, URL, Date, FormData,
    EckoWallet: class { constructor() { return wallet; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    matchMedia() { return { matches: false }; },
    crypto: { randomUUID() { return 'test-idempotency-key'; } },
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() {},
    async fetch(path, options) {
      calls.push({ path, options });
      const route=path.split('?')[0];
      const value = queues.get(route)?.length ? queues.get(route).shift() : defaults[route];
      assert.notEqual(value, undefined, 'Unexpected API request: ' + path);
      const data = await (typeof value === 'function' ? value() : value);
      return data?.httpError?{ok:false,status:data.httpError,async json(){return {error:data.error};}}:{ok:true,async json(){return data;}};
    },
  });
  vm.runInContext(source + '\n globalThis.app={state,refreshAdminKpi,renderAdmin,refresh};', context, { filename: 'public/app.js' });
  const { app } = context;
  app.state.user = { role: 'admin', account };
  app.state.config = { network: 'mainnet01', chain: '1', explorer: 'https://example.invalid/tx/', writes_enabled: true };
  app.state.csrf = 'test-csrf';
  app.state.view = 'admin';
  return {
    app, wallet, calls, element,
    queue(path, ...values) { queues.set('/api' + path, values); },
    count(path) { return calls.filter(c => c.path.split('?')[0] === '/api' + path).length; },
  };
}

test('pause blocks repeat clicks through preparation, connection and signing, retaining pending after render failure', async () => {
  const f = fixture(), command = deferred(), connection = deferred(), signature = deferred();
  f.queue('/admin/pause-command', command.promise);
  f.queue('/admin/kpi', () => { throw new Error('Render unavailable'); }, () => { throw new Error('KPI unavailable'); });
  f.wallet.connectResult = connection.promise;
  f.wallet.signResult = signature.promise;
  const button = f.element('#pauseBtn');
  const first = button.onclick();
  await button.onclick();
  assert.equal(button.disabled, true);
  assert.equal(f.count('/admin/pause-command'), 1);
  assert.equal(f.wallet.connectCalls, 0);
  command.resolve({ command: { hash: 'prepared-command' } });
  await tick();
  await button.onclick();
  assert.equal(f.wallet.connectCalls, 1);
  assert.equal(f.wallet.signCalls, 0);
  connection.resolve(account);
  await tick();
  await button.onclick();
  assert.equal(f.wallet.signCalls, 1);
  signature.resolve({ hash: pending.request_key });
  await first;
  assert.equal(f.count('/admin/pause'), 1);
  assert.equal(f.app.state.pauseBusy, false);
  assert.equal(f.app.state.pausePending.request_key, pending.request_key);
  assert.equal(button.disabled, true);
  assert.equal(f.element('#pauseLbl').textContent, 'Pause change awaiting confirmation');
  assert.equal(f.element('#notice').textContent, 'Render unavailable');
  await button.onclick();
  assert.equal(f.wallet.connectCalls, 1);
  assert.equal(f.wallet.signCalls, 1);
  assert.equal(f.count('/admin/pause-command'), 1);
});

test('KPI started during signing cannot clear a subsequently accepted pause transition', async () => {
  const f = fixture(), signature = deferred(), stale = deferred();
  f.wallet.signResult = signature.promise;
  f.queue('/admin/kpi', stale.promise, kpi({ paused: true, pause_pending: pending }));
  const action = f.element('#pauseBtn').onclick();
  await tick();
  assert.equal(f.wallet.signCalls, 1);
  const oldKpi = f.app.refreshAdminKpi();
  await tick();
  signature.resolve({ hash: pending.request_key });
  await action;
  assert.equal(f.element('#pauseBtn').disabled, true);
  stale.resolve(kpi({ paused: false, pause_pending: null, awaiting_review: 99 }));
  assert.equal(await oldKpi, null);
  assert.equal(f.app.state.pausePending.request_key, pending.request_key);
  assert.equal(f.app.state.pausePaused, true);
  assert.equal(f.element('#pauseBtn').disabled, true);
  assert.equal(f.element('#kRev').textContent, '1');
});

test('live pending pause state disables the control until the later authoritative confirmation', async t => {
  for (const paused of [true, false]) {
    await t.test(paused ? 'pause confirmed' : 'resume confirmed', async () => {
      const f = fixture();
      f.queue('/admin/kpi', kpi({ paused: true, pause_pending: pending }), kpi({ paused, pause_pending: null }));
      await f.app.refreshAdminKpi();
      assert.equal(f.element('#pauseBtn').disabled, true);
      await f.element('#pauseBtn').onclick();
      assert.equal(f.wallet.connectCalls, 0);
      assert.equal(f.wallet.signCalls, 0);
      await f.app.refreshAdminKpi();
      assert.equal(f.element('#pauseBtn').disabled, false);
      assert.equal(f.element('#pauseBtn').attributes['aria-checked'], String(paused));
      assert.equal(f.app.state.pausePending, null);
      assert.equal(f.element('#pauseLbl').textContent, paused ? 'Emergency pause active' : 'Payouts running');
    });
  }
});

test('automatic review refresh updates KPI and pause confirmations without replacing an unsaved review note', async () => {
  const f = fixture();
  f.queue('/admin/kpi', kpi(), kpi({ pause_pending: pending, awaiting_review: 2 }), kpi({ paused: true, awaiting_review: 3 }));
  f.queue('/reviewer/submissions', [{
    id: 17, task: 'Reviewable task', by: account, reward: 0.1, status: 'in_review',
    submitted_at: '2026-10-04T20:00:00Z', proof_schema: [], proof_json: {}, review_note: 'Previously saved note',
  }]);
  await f.app.renderAdmin();
  const body = f.element('#admBody'), note = f.element('#rvNote'), writes = body.innerWrites;
  note.value = 'Unsaved reviewer edits that must survive background refresh.';
  // No focused input: review tab itself must preserve edits even after focus leaves.
  await f.app.refresh();
  assert.equal(f.element('#pauseBtn').disabled, true);
  assert.equal(f.element('#kRev').textContent, '2');
  await f.app.refresh();
  assert.equal(f.element('#pauseBtn').disabled, false);
  assert.equal(f.element('#pauseBtn').attributes['aria-checked'], 'true');
  assert.equal(f.element('#kRev').textContent, '3');
  assert.equal(f.element('#cRevN').textContent, '3');
  assert.equal(f.element('#rvNote'), note);
  assert.equal(note.value, 'Unsaved reviewer edits that must survive background refresh.');
  assert.equal(body.innerWrites, writes);
  assert.equal(f.count('/reviewer/submissions'), 1);
  assert.equal(f.count('/admin/kpi'), 3);
});


test('Lost submission response retains exact signed intent until matching status or exact transport retry resolves it',async()=>{
 const f=fixture();
 f.queue('/admin/pause',()=>{throw new Error('Connection lost after server acceptance');});
 f.queue('/admin/kpi',()=>{throw new Error('KPI unavailable');},kpi({pause_pending:null,pause_job:null}),kpi({pause_pending:null,pause_job:null}),kpi({paused:true,pause_pending:pending}),kpi({paused:true,pause_pending:pending}));
 await f.element('#pauseBtn').onclick();
 const marker=f.app.state.pausePending;assert.equal(marker.uncertain,true);assert.equal(f.element('#pauseBtn').disabled,true);
 await f.app.refreshAdminKpi();
 assert.equal(f.app.state.pausePending,marker,'An early empty KPI cannot prove the original POST was rejected');
 assert.equal(f.element('#pauseBtn').disabled,true);assert.equal(f.count('/admin/pause'),1,'Wait for the retry backoff');
 const retry=deferred();f.queue('/admin/pause',retry.promise);marker.retryAt=0;
 const first=f.app.refreshAdminKpi();await tick();
 const overlapping=f.app.refreshAdminKpi();await tick();await f.element('#pauseBtn').onclick();
 assert.equal(f.count('/admin/pause'),2,'Only one exact-command retry is in flight');
 assert.equal(f.count('/admin/pause-command'),1);assert.equal(f.wallet.connectCalls,1);assert.equal(f.wallet.signCalls,1);
 const posts=f.calls.filter(c=>c.path==='/api/admin/pause');
 assert.equal(posts[0].options.body,posts[1].options.body);assert.equal(posts[0].options.headers['idempotency-key'],posts[1].options.headers['idempotency-key']);
 retry.resolve({job_id:pending.id,request_key:pending.request_key});await first;await overlapping;
 assert.equal(f.element('#pauseBtn').disabled,true);
 assert.equal(f.app.state.pausePending.request_key,pending.request_key);
});

test('Uncertain submitted pause resolves only its exact job; definitive expired retry permits a fresh attempt',async()=>{
 for(const outcome of ['matching','expired']){
  const f=fixture();f.queue('/admin/pause',()=>{throw new Error('Unknown submit outcome');});
  f.queue('/admin/kpi',kpi({pause_pending:null,pause_job:null}));
  await f.element('#pauseBtn').onclick();assert.equal(f.element('#pauseBtn').disabled,true);
  const marker=f.app.state.pausePending;
  if(outcome==='matching'){
   f.queue('/admin/kpi',kpi({paused:false,pause_pending:null,pause_job:{...pending,status:'confirmed'}}));
  }else{
   marker.retryAt=0;f.queue('/admin/kpi',kpi({pause_job:null}),kpi());
   f.queue('/admin/pause',{httpError:400,error:'Pause command expired; prepare again'});
  }
  await f.app.refreshAdminKpi();assert.equal(f.element('#pauseBtn').disabled,false);assert.equal(f.app.state.pausePending,null);
  assert.equal(f.wallet.connectCalls,1);assert.equal(f.wallet.signCalls,1);assert.equal(f.count('/admin/pause-command'),1);
 }
});


test('Uncertain transport retry is bounded and never signs a replacement on 5xx or parse failure',async()=>{
 const f=fixture();
 f.queue('/admin/pause',{httpError:500,error:'Gateway lost the response'},()=>{throw new SyntaxError('Malformed response JSON');},{httpError:502,error:'Upstream unavailable'},()=>{throw new Error('Transport unavailable');});
 await f.element('#pauseBtn').onclick();const marker=f.app.state.pausePending;
 assert.equal(marker.uncertain,true);assert.equal(f.element('#pauseBtn').disabled,true);
 for(let i=0;i<5;i++){marker.retryAt=0;const k=await f.app.refreshAdminKpi();assert.equal(k.paused,true);assert.equal(f.element('#pauseBtn').disabled,true);}
 assert.equal(f.count('/admin/pause'),4,'Original POST and at most three exact retries');
 assert.equal(f.count('/admin/pause-command'),1);assert.equal(f.wallet.connectCalls,1);assert.equal(f.wallet.signCalls,1);
 const posts=f.calls.filter(c=>c.path==='/api/admin/pause');assert.ok(posts.every(p=>p.options.body===posts[0].options.body&&p.options.headers['idempotency-key']===posts[0].options.headers['idempotency-key']));
});
