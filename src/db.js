import pg from 'pg';
export function database(url) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    query: (sql, args = []) => pool.query(sql, args),
    async tx(fn) {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
export async function audit(db, actor, action, type, id, metadata = {}) {
  await db.query('INSERT INTO audit_log(actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5)', [actor, action, type, String(id), JSON.stringify(metadata)]);
}
