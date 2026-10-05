import { readdir, readFile } from 'node:fs/promises';
import { database } from '../src/db.js';
export async function migrate(db) {
  await db.tx(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(918291)");
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())');
    for (const name of (await readdir(new URL('../migrations/', import.meta.url))).filter(n => n.endsWith('.sql')).sort()) {
      if ((await tx.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await tx.query(await readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8'));
      await tx.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
    }
  });
}
if (process.argv[1]?.endsWith('/migrate.js')) {
  const db = database(process.env.DATABASE_URL);
  try { await migrate(db); console.log('Migrations applied'); } finally { await db.close(); }
}
