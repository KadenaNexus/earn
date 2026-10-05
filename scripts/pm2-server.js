import { setTimeout as sleep } from 'node:timers/promises';
import { config } from '../src/config.js';
import { database } from '../src/db.js';
import { Chain } from '../src/pact.js';
import { createApp } from '../src/server.js';

// Nginx is the public entry point. Keep the production port off public interfaces.
const c = config(), db = database(c.database), chain = new Chain(c);
const { app, worker } = createApp(db, chain, c);
const server = app.listen(c.port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'listening', host: '127.0.0.1', port: c.port, network: c.network, writes: c.writes }));
  worker.start();
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  worker.stop();
  try {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    // Let a current worker tick persist its result before closing its database pool.
    while (worker.busy) await sleep(50);
    await db.close();
    process.exit(0);
  } catch {
    console.error(JSON.stringify({ event: 'shutdown_failed' }));
    process.exit(1);
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
