import test from 'node:test';
import assert from 'node:assert/strict';
import { sign } from '../src/pact.js';
import { createApp } from '../src/server.js';
import { Worker } from '../src/jobs.js';
import { testDatabase, testKey, testConfig, TestChain, client, campaignInput } from './helpers.js';

test('Owner can undo an approval before the payout is sent, never after', async () => {
  const db = await testDatabase('ke_undo_approval_tests'), adminKey = testKey(), opsKey = testKey(), c = testConfig(adminKey, opsKey), chain = new TestChain(c), worker = new Worker(db, chain, c);
  const { app } = createApp(db, chain, c, worker); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const owner = await client(base, adminKey), alice = await client(base, testKey());
    const cid = (await owner.call('/admin/campaigns', campaignInput(), { 'idempotency-key': 'undo-create-1' })).data.campaign.id;
    const funding = (await owner.call(`/admin/campaigns/${cid}/funding-command`, {})).data;
    await owner.call(`/admin/campaigns/${cid}/confirm-funding`, { signed_command: sign(funding.command, adminKey.seed) }, { 'idempotency-key': 'undo-fund-01' });
    await worker.tick(); await worker.tick();
    await alice.call(`/tasks/${cid}/start`, {});
    const proof = { finding: 'A detailed finding from the local pilot run.', private_link: 'https://example.com/evidence' };
    const sid = (await alice.call(`/tasks/${cid}/submit`, { proof, public_consent: true })).data.id;
    await worker.tick(); await worker.tick();
    assert.equal((await owner.call(`/submissions/${sid}/approve`, {})).status, 200);
    let payouts = (await owner.call('/admin/payouts')).data; assert.equal(payouts.length, 1); assert.equal(payouts[0].status, 'pending');

    assert.equal((await alice.call(`/submissions/${sid}/undo-approval`, { note: 'Please redo this' })).status, 403);
    assert.equal((await owner.call(`/submissions/${sid}/undo-approval`, { note: 'no' })).status, 400, 'note required');
    const undo = await owner.call(`/submissions/${sid}/undo-approval`, { note: 'Please add one more sentence.' });
    assert.equal(undo.status, 200); assert.equal(undo.data.status, 'changes_requested');
    assert.equal((await owner.call('/admin/payouts')).data.length, 0);
    const mine = (await alice.call('/me/tasks')).data[0]; assert.equal(mine.s, 'changes_requested'); assert.equal(mine.review_note, 'Please add one more sentence.');
    assert.equal(chain.campaigns.values().next().value['reserved-count'], 1, 'Reward stays reserved in escrow');
    assert.equal((await owner.call(`/submissions/${sid}/undo-approval`, { note: 'Again please' })).status, 409);

    // Resubmitted proof goes back to review, then can be approved and paid normally.
    assert.equal((await alice.call(`/tasks/${cid}/submit`, { proof: { ...proof, finding: proof.finding + ' With one more sentence.' }, public_consent: true })).status, 200);
    assert.equal((await owner.call('/reviewer/submissions')).data[0].status, 'in_review');
    assert.equal((await owner.call(`/submissions/${sid}/approve`, {})).status, 200);
    const pid = (await owner.call('/admin/payouts')).data[0].id;
    assert.equal((await owner.call(`/admin/payouts/${pid}/send`, {}, { 'idempotency-key': 'undo-send-001' })).status, 200);
    // Once sent, it can no longer be undone.
    const late = await owner.call(`/submissions/${sid}/undo-approval`, { note: 'Too late now' });
    assert.equal(late.status, 409);
    await worker.tick(); await worker.tick();
    assert.equal((await alice.call('/me/tasks')).data[0].s, 'paid');
    assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='undo_approval'")).rowCount);
  } finally { server.close(); await db.close(); }
});
