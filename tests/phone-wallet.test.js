import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.js';
import { accountFromSession, sigFromAnswer } from '../public/walletconnect.js';
import { testKey, testConfig, TestChain } from './helpers.js';

const pub = 'a'.repeat(64), sig = 'b'.repeat(128);

test('Phone wallet answers are read whichever shape the wallet uses', () => {
 assert.equal(accountFromSession({ namespaces: { kadena: { accounts: [`kadena:mainnet01:${pub}`] } } }), 'k:' + pub);
 assert.equal(accountFromSession({ namespaces: { kadena: { accounts: [`kadena:mainnet01:k:${pub.toUpperCase()}`] } } }), 'k:' + pub);
 assert.equal(accountFromSession({ namespaces: { kadena: { accounts: ['kadena:mainnet01:w:abc'] } } }), null);
 assert.equal(sigFromAnswer({ responses: [{ commandSigData: { cmd: '{}', sigs: [{ pubKey: pub, sig }] }, outcome: { result: 'success' } }] }, pub), sig);
 assert.equal(sigFromAnswer({ quickSignData: [{ commandSigData: { sigs: [{ pubKey: pub, sig: sig.toUpperCase() }] } }] }, pub), sig);
 assert.equal(sigFromAnswer(JSON.stringify({ results: [{ sigs: [{ pubKey: pub, sig }] }] }), pub), sig);
 assert.throws(() => sigFromAnswer({ responses: [{ commandSigData: { sigs: [{ pubKey: 'c'.repeat(64), sig }] } }] }, pub), /no signature/);
 assert.throws(() => sigFromAnswer({ responses: [{ outcome: { result: 'failure', msg: 'User declined' } }] }, pub), /User declined/);
});

test('Pages allow the WalletConnect relay and load the library from this site only', async () => {
 const c = testConfig(testKey(), testKey());
 const db = { query: async () => ({ rows: [{}] }), tx: async fn => fn({ query: async () => ({ rows: [] }) }) };
 const { app } = createApp(db, new TestChain(c), c, { agent: null, start() {} });
 const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
 try {
   const res = await fetch(`http://127.0.0.1:${server.address().port}/games.html`);
   const csp = res.headers.get('content-security-policy');
   assert.match(csp, /connect-src 'self' wss:\/\/relay\.walletconnect\.org/);
   assert.match(csp, /script-src 'self'(;|$)/, 'no third-party scripts');
   for (const f of ['/games.html', '/walletconnect.js', '/wallets.js', '/games.css']) assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${f}`)).headers.get('cache-control'), 'no-cache', f);
 } finally { server.close(); }
 // The vendored bundle matches its recorded checksum (same pinned build as Kadena Garden).
 for (const line of readFileSync(new URL('../public/vendor/SHA256SUMS', import.meta.url), 'utf8').trim().split('\n')) {
   const [hash, file] = line.split(/\s+/);
   assert.equal(createHash('sha256').update(readFileSync(new URL(`../public/vendor/${file}`, import.meta.url))).digest('hex'), hash, file);
 }
});

test('Wallet inside Linx: kda_connect account is used and any quicksign answer shape is accepted', async () => {
 const { EckoWallet } = await import('../public/wallet.js');
 const { testKey } = await import('./helpers.js');
 const { command, sign } = await import('../src/pact.js');
 const { testConfig } = await import('./helpers.js');
 const key = testKey(), c = testConfig(key, testKey());
 const tx = command(c, '(+ 1 2)', {}, key.publicKey, []);
 const signed = sign(tx, key.seed);
 const calls = [];
 const linx = { isKadena: true, request: async r => { calls.push(r.method);
   if (r.method === 'kda_connect') return { status: 'success', account: { account: key.account, publicKey: key.publicKey } };
   return { status: 'success', quickSignData: [{ commandSigData: { cmd: tx.cmd, sigs: [{ pubKey: key.publicKey, sig: signed.sigs[0].sig }] } }] }; } };
 const w = new EckoWallet(linx);
 assert.equal(await w.connect('development'), key.account);
 assert.deepEqual(calls, ['kda_connect'], 'no kda_checkStatus needed when kda_connect returns the account');
 assert.equal((await w.sign(tx)).sigs[0].sig, signed.sigs[0].sig);
 const tampered = { isKadena: true, request: async () => ({ status: 'success', responses: [{ commandSigData: { cmd: '{"other":1}', sigs: [{ pubKey: key.publicKey, sig: signed.sigs[0].sig }] } }] }) };
 await assert.rejects(new EckoWallet(tampered).sign(tx), /expected transaction/);
});
