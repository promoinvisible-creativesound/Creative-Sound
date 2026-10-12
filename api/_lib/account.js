// Account type chosen right after sign-up: producer, artist or listener.
// Producers get the producer area (upload beats for review); the other two
// only change what the account pages put first. Stored on users.role.
const { sql } = require('./db');
const { getSession } = require('./auth');

const ROLES = ['producer', 'artist', 'listener'];

let ready = null;
function ensureColumns() {
  if (!ready) {
    ready = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role_set_at TIMESTAMPTZ`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function roleFor(uid) {
  await ensureColumns();
  const [row] = await sql`SELECT role FROM users WHERE id = ${uid}`;
  return (row && ROLES.includes(row.role)) ? row.role : null;
}

// POST { role } sets the account type (it can be changed later in
// Settings). GET returns the current one.
async function handleRole(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  try {
    if (req.method === 'GET') {
      res.status(200).json({ role: await roleFor(session.uid) });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const role = String((req.body && req.body.role) || '');
    if (!ROLES.includes(role)) {
      res.status(400).json({ error: 'Choose producer, artist or listener.' });
      return;
    }
    await ensureColumns();
    await sql`UPDATE users SET role = ${role}, role_set_at = now() WHERE id = ${session.uid}`;
    res.status(200).json({ role });
  } catch (err) {
    console.error('account role error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
}

module.exports = { ROLES, roleFor, handleRole };
