import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { backupEnvironment, backupLoop, dailyIntervalMs, retryIntervalMs, runBackup } from '../scripts/backup-loop.js';

const source = { DATABASE_URL: 'postgres://earn:synthetic%40pass%2Fword@127.0.0.1:55432/earn', PATH: process.env.PATH };

test('PM2-style ESM import starts the backup loop, while an ordinary import stays inert', async () => {
  const moduleUrl = new URL('../scripts/backup-loop.js', import.meta.url);
  const directory = await mkdtemp(join(tmpdir(), 'earn-backup-pm2-'));
  const importModule = async pm2Entrypoint => new Promise((resolveImport, rejectImport) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl.href)})`], {
      env: { ...source, PG_BIN_DIRECTORY: directory, BACKUP_DIRECTORY: join(directory, 'dumps'), pm_exec_path: pm2Entrypoint },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', diagnostics = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); rejectImport(new Error('Controlled PM2 import did not finish')); }, 5000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (pm2Entrypoint && output.includes('backup_started')) child.kill('SIGTERM');
    });
    child.stderr.on('data', chunk => { diagnostics += chunk; });
    child.once('error', rejectImport);
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) rejectImport(new Error(`Controlled import failed: ${code}/${signal}: ${diagnostics}`));
      else resolveImport(output);
    });
  });
  try {
    // No real PostgreSQL connection is made even if the child's dump starts before SIGTERM.
    await writeFile(join(directory, 'pg_dump'), '#!/bin/sh\nexit 9\n', { mode: 0o700 });
    const normal = await importModule('');
    assert.equal(normal, '');
    const pm2 = await importModule(fileURLToPath(moduleUrl));
    assert.match(pm2, /backup_started/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('native backup decodes database credentials, carries TLS/options and excludes application secrets', () => {
  const env = backupEnvironment({
    ...source,
    DATABASE_URL: 'postgresql://earn%2Buser:s%40fe%2F%25%3Akey@[::1]:55432/earn%20database?sslmode=verify-full&sslrootcert=%2Fcerts%2Froot.pem&options=-c%20search_path%3Dearn&connect_timeout=20',
    OPS_SECRET_KEY: 'synthetic-operations-secret', POSTGRES_PASSWORD: 'unrelated-secret',
    PGHOST: 'stale-host', PGPASSWORD: 'stale-password', PGOPTIONS: '-c search_path=wrong',
    BACKUP_DIRECTORY: '/tmp/earn-backups',
    PG_BIN_DIRECTORY: '/custom/postgresql/17/bin',
  });
  assert.equal(env.PGUSER, 'earn+user');
  assert.equal(env.PGPASSWORD, 's@fe/%:key');
  assert.equal(env.PGDATABASE, 'earn database');
  assert.equal(env.PGHOST, '::1');
  assert.equal(env.PGPORT, '55432');
  assert.equal(env.PGSSLMODE, 'verify-full');
  assert.equal(env.PGSSLROOTCERT, '/certs/root.pem');
  assert.equal(env.PGOPTIONS, '-c search_path=earn');
  assert.equal(env.PGCONNECT_TIMEOUT, '20');
  assert.equal(env.BACKUP_DIRECTORY, '/tmp/earn-backups');
  assert.equal(env.PATH, `/custom/postgresql/17/bin:${process.env.PATH}`);
  for (const key of ['DATABASE_URL', 'OPS_SECRET_KEY', 'POSTGRES_PASSWORD']) assert.equal(env[key], undefined);
});

test('malformed and unsupported connection configuration fails without exposing its values', () => {
  for (const database of [
    'not-a-url-synthetic-secret',
    'https://earn:synthetic-secret@db/earn',
    'postgres://earn:synthetic-secret@db/earn?sslmode=require&sslmode=disable',
    'postgres://earn:synthetic-secret@db/earn?password=other-secret',
    'postgres://earn:synthetic%00secret@db/earn',
    'postgres://earn:synthetic-secret@db/',
  ]) {
    assert.throws(() => backupEnvironment({ DATABASE_URL: database }), error => {
      assert.ok(!error.message.includes('synthetic'));
      assert.ok(!error.message.includes(database));
      return true;
    });
  }
});

test('backup runs immediately, waits until the next daily start and never overlaps', async () => {
  const controller = new AbortController();
  let runs = 0, active = 0, tick = 0;
  const waits = [];
  await backupLoop({
    environment: source, signal: controller.signal, log: () => {},
    now: () => (tick++ * 500),
    run: async () => {
      runs += 1; active += 1;
      assert.equal(active, 1);
      await Promise.resolve();
      active -= 1;
      if (runs === 2) controller.abort();
    },
    wait: async ms => { waits.push(ms); },
  });
  assert.equal(runs, 2);
  assert.deepEqual(waits, [dailyIntervalMs - 500]);
});

test('runtime backup failure is visible, retries in a minute and recovers without process restart', async () => {
  const controller = new AbortController();
  const messages = [], waits = [];
  let runs = 0;
  await backupLoop({
    environment: source, signal: controller.signal, log: message => messages.push(JSON.parse(message)),
    now: () => 0,
    run: async () => {
      runs += 1;
      if (runs === 1) throw new Error('controlled failure with synthetic-secret');
    },
    wait: async ms => {
      waits.push(ms);
      if (waits.length === 2) controller.abort();
    },
  });
  assert.equal(runs, 2);
  assert.deepEqual(waits, [retryIntervalMs, dailyIntervalMs]);
  assert.ok(messages.some(message => message.event === 'backup_failed'));
  assert.ok(messages.some(message => message.event === 'backup_completed'));
  assert.ok(!JSON.stringify(messages).includes('synthetic-secret'));
});

test('shutdown interrupts a pending retry sleep instead of waiting a full minute', async () => {
  const controller = new AbortController();
  const loop = backupLoop({
    environment: source, signal: controller.signal, log: () => {},
    run: async () => { throw new Error('controlled failure'); },
  });
  await sleep(10);
  controller.abort();
  await loop;
});

test('failed pg_dump diagnostics redact the decoded database password', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earn-backup-test-'));
  const errors = [];
  const originalError = console.error;
  try {
    await writeFile(join(directory, 'pg_dump'), '#!/bin/sh\nif [ -n "${OPS_SECRET_KEY-}" ]; then exit 98; fi\nprintf "Controlled failure: %s\\n" "$PGPASSWORD" >&2\nexit 9\n', { mode: 0o700 });
    const environment = backupEnvironment({ ...source, OPS_SECRET_KEY: 'synthetic-operations-secret', BACKUP_DIRECTORY: join(directory, 'dumps') });
    environment.PATH = `${directory}:${process.env.PATH}`;
    console.error = text => errors.push(String(text));
    await assert.rejects(runBackup(environment), /exit 9/);
    assert.match(errors.join('\n'), /\[redacted\]/);
    assert.ok(!errors.join('\n').includes(environment.PGPASSWORD));
    assert.ok(!errors.join('\n').includes('synthetic-operations-secret'));
  } finally {
    console.error = originalError;
    await rm(directory, { recursive: true, force: true });
  }
});

test('shutdown cancels an active backup and its subprocess group promptly', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'earn-backup-stop-'));
  const marker = join(directory, 'started');
  const controller = new AbortController();
  let backup;
  try {
    await writeFile(join(directory, 'pg_dump'), `#!/bin/sh\nprintf started > '${marker}'\nsleep 30\n`, { mode: 0o700 });
    const environment = backupEnvironment({ ...source, BACKUP_DIRECTORY: join(directory, 'dumps') });
    environment.PATH = `${directory}:${process.env.PATH}`;
    backup = runBackup(environment, { signal: controller.signal });
    let started = false;
    for (let attempt = 0; attempt < 100 && !started; attempt++) {
      try { await access(marker); started = true; } catch { await sleep(10); }
    }
    assert.equal(started, true);
    controller.abort();
    await backup;
  } finally {
    controller.abort();
    await backup;
    await rm(directory, { recursive: true, force: true });
  }
});
