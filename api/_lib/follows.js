// Follow a producer: buyers get an email when that producer has a new track in the store.
//   GET  /api/profile/follow?u=handle              -> { count, following }
//   POST /api/profile/follow { handle, follow }    -> { count, following }   (signed in)
const { sql } = require('./db');
const { getSession } = require('./auth');

let ready = null;
function ensureTable() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS producer_follows (user_id INTEGER NOT NULL, producer_id INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, producer_id))`;
      await sql`CREATE INDEX IF NOT EXISTS producer_follows_producer_idx ON producer_follows (producer_id)`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const MAX_MAILS = 300;

async function producerByHandle(handle) {
  const h = String(handle || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9._-]/g, '').slice(0, 40);
  if (!h) return null;
  const [u] = await sql`SELECT id, handle FROM users WHERE lower(handle) = ${h} AND role = 'producer'`;
  return u || null;
}

async function state(producerId, uid) {
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM producer_follows WHERE producer_id = ${producerId}`;
  let following = false;
  if (uid) following = (await sql`SELECT 1 FROM producer_follows WHERE producer_id = ${producerId} AND user_id = ${uid}`).length > 0;
  return { count: n, following };
}

async function handleFollow(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    await ensureTable();
    const session = getSession(req);
    if (req.method === 'GET') {
      const p = await producerByHandle(req.query && req.query.u);
      if (!p) { res.status(404).json({ error: 'Producer not found.' }); return; }
      res.status(200).json(await state(p.id, session && session.uid));
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    if (!session) { res.status(401).json({ error: 'Sign in to follow producers.' }); return; }
    const body = req.body || {};
    const p = await producerByHandle(body.handle);
    if (!p) { res.status(404).json({ error: 'Producer not found.' }); return; }
    if (p.id === session.uid) { res.status(400).json({ error: 'You cannot follow yourself.' }); return; }
    if (body.follow === false) await sql`DELETE FROM producer_follows WHERE user_id = ${session.uid} AND producer_id = ${p.id}`;
    else await sql`INSERT INTO producer_follows (user_id, producer_id) VALUES (${session.uid}, ${p.id}) ON CONFLICT DO NOTHING`;
    res.status(200).json(await state(p.id, session.uid));
  } catch (err) {
    console.error('follow error:', err);
    res.status(500).json({ error: 'Could not save. Please try again.' });
  }
}

// Followers of a producer (emails), newest first, for the "new track" mail.
async function followerEmails(producerId) {
  await ensureTable();
  const rows = await sql`
    SELECT u.email FROM producer_follows f JOIN users u ON u.id = f.user_id
    WHERE f.producer_id = ${producerId} AND u.email IS NOT NULL ORDER BY f.created_at DESC LIMIT ${MAX_MAILS}`;
  return rows.map((r) => r.email);
}

// Number of followers per producer, for the producer's own area.
async function countFor(producerId) {
  await ensureTable();
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM producer_follows WHERE producer_id = ${producerId}`;
  return n;
}

module.exports = { handleFollow, followerEmails, countFor };
