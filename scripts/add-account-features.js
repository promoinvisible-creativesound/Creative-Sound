const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  });
}

const { sql } = require('../api/_lib/db');

(async () => {
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT`;

  await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS amount_total INTEGER`;
  await sql`ALTER TABLE licenses ADD COLUMN IF NOT EXISTS currency TEXT`;

  await sql`
    CREATE TABLE IF NOT EXISTS tickets (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets (email)`;

  console.log('Account features migration done: users.first_name/last_name, licenses.amount_total/currency, tickets table.');
})().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
