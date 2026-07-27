const fs = require('fs');
const path = require('path');

// Load .env.local manually for a plain `node scripts/init-db.js` run — no
// dotenv dependency needed just for this one-off migration script.
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  });
}

const { sql } = require('../api/_lib/db');

(async () => {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      license_key TEXT UNIQUE NOT NULL,
      stripe_session_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses (email)`;

  console.log('Database initialized: users, licenses tables ready.');
})().catch((err) => {
  console.error('init-db failed:', err);
  process.exit(1);
});
