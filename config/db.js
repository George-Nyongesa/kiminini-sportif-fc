/**
 * PostgreSQL connection pool.
 * Reuses a single pool across the app — do not instantiate `new Pool()` elsewhere.
 */
const { Pool } = require('pg');

// Neon (and most managed Postgres hosts) require SSL and are usually
// configured via a single DATABASE_URL. Local dev typically uses discrete
// PGHOST/PGUSER/etc against a local, non-SSL instance. Support both:
const useConnectionString = Boolean(process.env.DATABASE_URL);

const pool = new Pool(
  useConnectionString
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
      }
    : {
        host: process.env.PGHOST,
        port: process.env.PGPORT,
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : false,
        max: 10,
        idleTimeoutMillis: 30000,
      }
);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

// Small query helper that logs slow queries in development.
async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && duration > 200) {
    console.warn(`Slow query (${duration}ms): ${text}`);
  }
  return res;
}

module.exports = { pool, query };
