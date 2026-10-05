import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const applicationDirectory = fileURLToPath(new URL('../', import.meta.url));
export const dailyIntervalMs = 24 * 60 * 60 * 1000;
export const retryIntervalMs = 60 * 1000;
const connectionOptions = {
  sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT',
  sslkey: 'PGSSLKEY', sslpassword: 'PGSSLPASSWORD', sslsni: 'PGSSLSNI',
  options: 'PGOPTIONS', application_name: 'PGAPPNAME', connect_timeout: 'PGCONNECT_TIMEOUT',
  target_session_attrs: 'PGTARGETSESSIONATTRS', hostaddr: 'PGHOSTADDR',
  channel_binding: 'PGCHANNELBINDING',
};

export function backupEnvironment(source = process.env) {
  let url;
  try { url = new URL(source.DATABASE_URL); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL without a fragment');
  }
  const decode = value => {
    try {
      const decoded = decodeURIComponent(value);
      if (decoded.includes('\0')) throw new Error();
      return decoded;
    } catch { throw new Error('DATABASE_URL contains invalid encoded connection values'); }
  };
  const childEnvironment = {};
  // Do not pass the application's operations key, DATABASE_URL, or other secrets to pg_dump.
  for (const [key, value] of Object.entries(source)) {
    if (['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ'].includes(key) || key.startsWith('LC_')) {
      childEnvironment[key] = value;
    }
  }
  childEnvironment.PATH = `${source.PG_BIN_DIRECTORY || '/usr/lib/postgresql/17/bin'}:${source.PATH || '/usr/bin:/bin'}`;
  childEnvironment.PGUSER = decode(url.username);
  childEnvironment.PGPASSWORD = decode(url.password);
  childEnvironment.PGDATABASE = decode(url.pathname.slice(1));
  childEnvironment.PGHOST = url.hostname.replace(/^\[|\]$/g, '');
  childEnvironment.PGPORT = url.port || '5432';
  childEnvironment.PGCONNECT_TIMEOUT = '15';
  if (!childEnvironment.PGUSER || !childEnvironment.PGDATABASE || !childEnvironment.PGHOST) {
    throw new Error('DATABASE_URL requires an explicit user, host and database');
  }
  const seen = new Set();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key) || !Object.hasOwn(connectionOptions, key) || !value || value.includes('\0')) {
      throw new Error('DATABASE_URL contains an unsupported, duplicate or empty connection option');
    }
    seen.add(key);
    childEnvironment[connectionOptions[key]] = value;
  }
  childEnvironment.BACKUP_DIRECTORY = resolve(applicationDirectory, source.BACKUP_DIRECTORY || 'backups');
  return childEnvironment;
}

function redactDiagnostics(output, environment) {
  let safe = output;
  for (const key of ['PGPASSWORD', 'PGSSLPASSWORD']) {
    const value = environment[key];
    if (value) {
      safe = safe.split(value).join('[redacted]');
      safe = safe.split(encodeURIComponent(value)).join('[redacted]');
    }
  }
  return safe;
}

export function runBackup(environment, { signal } = {}) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolveBackup, rejectBackup) => {
    const child = spawn('sh', [fileURLToPath(new URL('./backup.sh', import.meta.url))], {
      cwd: applicationDirectory, env: environment, detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', stdoutOverflow = false, stderrOverflow = false, forceKill;
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (stdoutOverflow) return;
      if (stdout.length + chunk.length > 65536) { stdout = ''; stdoutOverflow = true; }
      else stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      if (stderrOverflow) return;
      if (stderr.length + chunk.length > 65536) { stderr = ''; stderrOverflow = true; }
      else stderr += chunk;
    });
    const killGroup = requestedSignal => {
      if (!child.pid) return;
      try { process.kill(-child.pid, requestedSignal); }
      catch { child.kill(requestedSignal); }
    };
    const abort = () => {
      killGroup('SIGTERM');
      forceKill = setTimeout(() => killGroup('SIGKILL'), 5000);
      forceKill.unref();
    };
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => {
      clearTimeout(forceKill);
      signal?.removeEventListener('abort', abort);
    };
    child.once('error', () => {
      cleanup();
      rejectBackup(new Error('Could not start backup.sh; verify sh and PostgreSQL client tools are installed'));
    });
    child.once('close', (code, exitSignal) => {
      cleanup();
      if (signal?.aborted) { resolveBackup(); return; }
      if (stderrOverflow) console.error('Backup tool diagnostics exceeded the capture limit and were suppressed');
      if (stderr.trim()) console.error(redactDiagnostics(stderr.trim(), environment));
      if (code !== 0) {
        rejectBackup(new Error(`backup.sh failed (exit ${code ?? 'none'}, signal ${exitSignal ?? 'none'})`));
        return;
      }
      if (stdoutOverflow) console.log('Backup tool output exceeded the capture limit and was suppressed');
      if (stdout.trim()) console.log(redactDiagnostics(stdout.trim(), environment));
      resolveBackup();
    });
    // An abort may have happened between the initial check and listener registration.
    if (signal?.aborted) abort();
  });
}

export async function backupLoop({
  environment = process.env, signal, intervalMs = dailyIntervalMs,
  run = runBackup, wait = sleep, now = () => performance.now(), log = console.log,
} = {}) {
  const childEnvironment = backupEnvironment(environment);
  while (!signal?.aborted) {
    const started = now();
    log(JSON.stringify({ event: 'backup_started' }));
    let delay;
    try {
      await run(childEnvironment, { signal });
      delay = Math.max(0, intervalMs - (now() - started));
      if (!signal?.aborted) log(JSON.stringify({ event: 'backup_completed', next_in_ms: delay }));
    } catch {
      // pg_dump diagnostics are redacted by runBackup; keep supervisor logs free of credentials.
      delay = retryIntervalMs;
      if (!signal?.aborted) log(JSON.stringify({ event: 'backup_failed', retry_in_ms: delay }));
    }
    if (signal?.aborted) break;
    try {
      await wait(delay, undefined, { signal });
    } catch (error) {
      if (signal?.aborted) break;
      throw error;
    }
  }
}

// PM2's fork container imports ESM without replacing argv[1]. It identifies the
// entrypoint using pm_exec_path; normal library/test imports must remain inert.
const entrypoint = fileURLToPath(import.meta.url);
if (process.argv[1] === entrypoint || process.env.pm_exec_path === entrypoint) {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => controller.abort());
  }
  try { await backupLoop({ signal: controller.signal }); }
  catch (error) {
    // Messages originate from this wrapper; never log the source URL or child environment.
    console.error(JSON.stringify({ event: 'backup_failed', error: error.message }));
    process.exitCode = 1;
  }
}
