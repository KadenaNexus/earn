import nacl from 'tweetnacl';
import blake from 'blakejs';
import { randomUUID } from 'node:crypto';
import { requestKeyPattern } from './config.js';

export const quote = value => JSON.stringify(value);
export const hashCommand = cmd => Buffer.from(blake.blake2b(Buffer.from(cmd), null, 32)).toString('base64url');
export const decimal = value => {
  const s = String(value);
  if (!/^\d+(?:\.\d{1,6})?$/.test(s)) throw new Error('Invalid decimal amount');
  return s.includes('.') ? s : `${s}.0`;
};
export function micros(value) {
  const [whole, fraction = ''] = decimal(value).split('.');
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
}
export function command(c, code, data, publicKey, caps = [], sender = `k:${publicKey}`) {
  const body = {
    networkId: c.network, payload: { exec: { code, data } },
    signers: publicKey ? [{ pubKey: publicKey, clist: caps }] : [],
    meta: { chainId: c.chain, sender, gasLimit: 15000, gasPrice: c.gasPrice, ttl: 600, creationTime: Math.floor(Date.now()/1000)-15 },
    nonce: `kadena-earn:${randomUUID()}`,
  };
  const cmd = JSON.stringify(body);
  return { cmd, hash: hashCommand(cmd), sigs: publicKey ? [{ sig: null }] : [] };
}
export function sign(tx, seed) {
  const pair = nacl.sign.keyPair.fromSeed(Buffer.from(seed.slice(0,64), 'hex'));
  return { ...tx, sigs: [{ sig: Buffer.from(nacl.sign.detached(Buffer.from(tx.hash, 'base64url'), pair.secretKey)).toString('hex') }] };
}
export function verifySignature(tx, publicKey) {
  if (!tx || typeof tx.cmd !== 'string' || tx.cmd.length > 200000 || tx.hash !== hashCommand(tx.cmd) || tx.sigs?.length !== 1 || !/^[0-9a-f]{128}$/.test(tx.sigs[0]?.sig || '')) return false;
  try { return nacl.sign.detached.verify(Buffer.from(tx.hash, 'base64url'), Buffer.from(tx.sigs[0].sig, 'hex'), Buffer.from(publicKey,'hex')); } catch { return false; }
}
export function signingRequest(tx) {
  const body = JSON.parse(tx.cmd);
  return {
    pactCode: body.payload.exec.code, envData: body.payload.exec.data,
    signingPubKey: body.signers[0].pubKey,
    caps: body.signers[0].clist.map(cap => ({ role: cap.name === 'coin.GAS' ? 'Pay gas' : 'Authorize escrow action', description: cap.name, cap })),
    networkId: body.networkId, chainId: body.meta.chainId, sender: body.meta.sender,
    gasLimit: body.meta.gasLimit, gasPrice: body.meta.gasPrice, ttl: body.meta.ttl,
    creationTime: body.meta.creationTime, nonce: body.nonce,
  };
}

export class Chain {
  constructor(c) { this.c = c; this.base = `${c.node}/chainweb/0.0/${c.network}/chain/${c.chain}/pact/api/v1`; }
  async post(path, body) {
    const res = await fetch(`${this.base}/${path}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Kadena node ${path} returned ${res.status}`);
    return res.json();
  }
  async local(code, data = {}) {
    const res = await this.post('local', command(this.c,code,data,null,[], ''));
    if (res.result?.status !== 'success') throw new Error(res.result?.error?.message || 'Pact read failed');
    return res.result.data;
  }
  campaign(id) { return this.local(`(${this.c.module}.get-campaign ${quote(id)})`); }
  state() { return this.local(`(${this.c.module}.get-config)`); }
  ops(code, data = {}) {
    if (!this.c.writes) throw new Error('Chain writes are disabled');
    const tx = command(this.c, code, data, this.c.opsPublic, [{name:'coin.GAS',args:[]},{name:`${this.c.module}.OPS`,args:[]}],this.c.opsAccount);
    return sign(tx,this.c.opsSecret);
  }
  async send(tx) {
    if (!this.c.writes) throw new Error('Chain writes are disabled');
    const r = await this.post('send', {cmds:[tx]});
    if (r.requestKeys?.[0] !== tx.hash) throw new Error('Unexpected request key from node');
    return tx.hash;
  }
  async poll(key) {
    if (!requestKeyPattern.test(key)) throw new Error('Invalid request key');
    // Ask the node to check inclusion against its best-chain ancestry. The
    // local height check below is additional fail-closed validation, not a
    // substitute for the node's confirmation-depth lookup.
    const r = await this.post(`poll?confirmationDepth=${this.c.depth > 1 ? this.c.depth : 0}`, {requestKeys:[key]});
    const result = r[key];
    if (!result) return null;
    if(result.reqKey!==key)throw new Error('Node returned a mismatched transaction result');
    // Node-local/mempool rejections without mined inclusion cannot authorize
    // a new payment or refund attempt.
    if(!Number.isFinite(result.metaData?.blockHeight))return null;
    // A failure must reach the same depth before it can authorize a retry.
    if (this.c.depth > 1) {
      const cut = await fetch(`${this.c.node}/chainweb/0.0/${this.c.network}/cut`, {signal:AbortSignal.timeout(15000)});
      if (!cut.ok) throw new Error('Cannot verify confirmation depth');
      const height = (await cut.json()).hashes?.[this.c.chain]?.height;
      const included = result.metaData?.blockHeight;
      if (!Number.isFinite(height) || !Number.isFinite(included) || height-included+1 < this.c.depth) return null;
    }
    return result;
  }
}
