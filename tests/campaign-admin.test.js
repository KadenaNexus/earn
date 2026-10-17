import test from 'node:test';
import assert from 'node:assert/strict';
import { sign } from '../src/pact.js';
import { createApp } from '../src/server.js';
import { Worker } from '../src/jobs.js';
import { campaignEditSchema, proofSignature } from '../src/validation.js';
import { testDatabase, testKey, testConfig, TestChain, client, campaignInput } from './helpers.js';

const editable = t => ({ title: t.title, summary: t.sum, sponsor_name: t.sponsor, category: t.cat, template: t.type,
  minutes_estimate: t.mins, steps: t.steps, proof_schema: t.proof_schema, featured: t.featured, ai_review: t.ai });

test('Edit schema never accepts on-chain fields', () => {
  const base = campaignInput();
  const { reward_kda, max_rewards, deadline, ...rest } = base;
  assert.equal(campaignEditSchema.safeParse(rest).success, true);
  for (const extra of [{ reward_kda }, { max_rewards }, { deadline }, { sponsor_account: 'k:x' }])
    assert.equal(campaignEditSchema.safeParse({ ...rest, ...extra }).success, false, Object.keys(extra)[0]);
  // JSONB reorders keys; the comparison must not treat that as a change.
  const f = base.proof_schema[0];
  assert.equal(proofSignature([f]), proofSignature([{ required: f.required, private: f.private, min_len: f.min_len, type: f.type, label: f.label, key: f.key }]));
  assert.notEqual(proofSignature([f]), proofSignature([{ ...f, type: 'url' }]));
});

test('Owner can edit task text, lock proof fields while work is in progress, and hide a task', async () => {
  const db = await testDatabase('ke_campaign_admin_tests'), adminKey = testKey(), opsKey = testKey(), c = testConfig(adminKey, opsKey), chain = new TestChain(c), worker = new Worker(db, chain, c);
  const { app } = createApp(db, chain, c, worker); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const owner = await client(base, adminKey), [alice, bob] = await Promise.all([1, 2].map(() => client(base, testKey())));
    const cid = (await owner.call('/admin/campaigns', campaignInput(), { 'idempotency-key': 'admin-edit-create' })).data.campaign.id;
    const funding = (await owner.call(`/admin/campaigns/${cid}/funding-command`, {})).data;
    await owner.call(`/admin/campaigns/${cid}/confirm-funding`, { signed_command: sign(funding.command, adminKey.seed) }, { 'idempotency-key': 'admin-edit-fund' });
    await worker.tick(); await worker.tick();
    let task = (await owner.call('/admin/campaigns')).data[0];
    assert.equal(task.status, 'open'); assert.equal(task.in_progress, 0); assert.equal(task.editable, true); assert.equal(task.hidden, false);

    // Only the owner may edit or hide.
    assert.equal((await alice.call(`/admin/campaigns/${cid}/edit`, editable(task))).status, 403);
    assert.equal((await alice.call(`/admin/campaigns/${cid}/visibility`, { hidden: true })).status, 403);
    // Reward, slots and deadline cannot be smuggled into an edit.
    assert.equal((await owner.call(`/admin/campaigns/${cid}/edit`, { ...editable(task), reward_kda: '100' })).status, 400);

    // No one is working on it yet: proof fields can change (Link -> Text) along with the text.
    const fields = task.proof_schema.map(f => f.key === 'private_link' ? { ...f, label: 'Why it matters to you', type: 'text', min_len: 20 } : f);
    const edit = await owner.call(`/admin/campaigns/${cid}/edit`, { ...editable(task), title: 'Edited pilot feedback task', steps: ['Do it', 'Explain it'], proof_schema: fields, ai_review: true, ai_criteria: 'Must be specific.' });
    assert.equal(edit.status, 200);
    assert.deepEqual(edit.data.changed.sort(), ['ai_criteria', 'ai_review', 'proof_schema', 'steps', 'title']);
    task = (await owner.call('/admin/campaigns')).data[0];
    assert.equal(task.title, 'Edited pilot feedback task'); assert.equal(task.ai, true); assert.equal(task.ai_criteria, 'Must be specific.');
    assert.equal(task.proof_schema.find(f => f.key === 'private_link').type, 'text');
    assert.equal(task.reward, '0.100000'); assert.equal(task.max, 3);
    // Saving the same content reports no changes, even though JSONB reordered keys.
    assert.deepEqual((await owner.call(`/admin/campaigns/${cid}/edit`, { ...editable(task), ai_criteria: 'Must be specific.' })).data.changed, []);

    // The new Text field accepts a sentence.
    assert.equal((await alice.call(`/tasks/${cid}/start`, {})).status, 200);
    // Someone holds a slot: proof field changes are refused, other edits still work.
    task = (await owner.call('/admin/campaigns')).data[0]; assert.equal(task.in_progress, 1);
    const blocked = await owner.call(`/admin/campaigns/${cid}/edit`, { ...editable(task), proof_schema: task.proof_schema.slice(0, 1) });
    assert.equal(blocked.status, 409); assert.match(blocked.data.error, /1 person is working/);
    assert.equal((await owner.call(`/admin/campaigns/${cid}/edit`, { ...editable(task), summary: 'A clearer description of what contributors do.' })).status, 200);
    const submitted = await alice.call(`/tasks/${cid}/submit`, { proof: { finding: 'A detailed finding from the local pilot run.', private_link: 'It helps the community grow.' }, public_consent: true });
    assert.equal(submitted.status, 200);

    // Hide: off the public board and no new starts, but existing work continues.
    assert.equal((await owner.call(`/admin/campaigns/${cid}/visibility`, { hidden: true })).status, 200);
    assert.equal((await bob.call('/tasks')).data.length, 0);
    assert.equal((await bob.call('/tasks/' + cid)).status, 200, 'Direct link still opens for people already working on it');
    const refused = await bob.call(`/tasks/${cid}/start`, {}); assert.equal(refused.status, 409); assert.match(refused.data.error, /no longer accepting/);
    assert.equal((await owner.call('/stats')).data.open_rewards, 0);
    await worker.tick(); await worker.tick();
    assert.equal((await owner.call('/reviewer/submissions')).data.length, 1, 'Hidden task submissions still reach review');
    assert.equal((await owner.call('/admin/campaigns')).data[0].hidden, true);
    // Worker sync keeps the hidden flag.
    assert.equal((await owner.call('/admin/campaigns')).data[0].status, 'open');

    // Show again.
    assert.equal((await owner.call(`/admin/campaigns/${cid}/visibility`, { hidden: false })).status, 200);
    assert.equal((await bob.call('/tasks')).data.length, 1);
    assert.equal((await bob.call(`/tasks/${cid}/start`, {})).status, 200);

    // Ended tasks are no longer editable.
    await db.query("UPDATE task_campaigns SET deadline=now()-interval '1 second' WHERE id=$1", [cid]); await worker.tick();
    task = (await owner.call('/admin/campaigns')).data[0];
    assert.equal(task.editable, false);
    assert.equal((await owner.call(`/admin/campaigns/${cid}/edit`, editable(task))).status, 409);

    const actions = (await db.query("SELECT action FROM audit_log WHERE entity_type='campaign' ORDER BY id")).rows.map(r => r.action);
    assert.ok(actions.includes('edit') && actions.includes('hide') && actions.includes('unhide'));
  } finally { server.close(); await db.close(); }
});
