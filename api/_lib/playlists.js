// Playlists of store tracks: a name, a share link, any number of tracks.
//   GET  /api/beats/playlists            -> my playlists with their track ids   (signed in)
//   GET  /api/beats/playlists?s=slug     -> one playlist for anyone with the link
//   POST /api/beats/playlists { do: 'create' | 'rename' | 'delete' | 'add' | 'remove', ... }  (signed in)
const crypto = require('crypto');
const { sql } = require('./db');
const { getSession } = require('./auth');

const MAX_LISTS = 20;
const MAX_TRACKS = 200;

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS playlists (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS playlists_user_idx ON playlists (user_id)`;
      await sql`CREATE TABLE IF NOT EXISTS playlist_items (playlist_id INTEGER NOT NULL, beat_id TEXT NOT NULL, added_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (playlist_id, beat_id))`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim().slice(0, 40);
const newSlug = () => crypto.randomBytes(6).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
const okBeatId = (id) => /^[a-z0-9][a-z0-9_.-]{0,80}$/i.test(String(id || ''));

async function mine(uid) {
  const lists = await sql`SELECT id, slug, name FROM playlists WHERE user_id = ${uid} ORDER BY created_at DESC`;
  if (!lists.length) return [];
  const items = await sql`SELECT playlist_id, beat_id FROM playlist_items WHERE playlist_id = ANY(${lists.map((l) => l.id)}::int[]) ORDER BY added_at DESC`;
  return lists.map((l) => {
    const ids = items.filter((i) => i.playlist_id === l.id).map((i) => i.beat_id);
    return { id: l.id, slug: l.slug, name: l.name, ids, count: ids.length };
  });
}

async function handlePlaylists(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    await ensureTables();
    const session = getSession(req);
    if (req.method === 'GET') {
      const slug = String((req.query && req.query.s) || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16);
      if (slug) {
        const [l] = await sql`SELECT p.id, p.slug, p.name, p.user_id, u.display_name, u.handle FROM playlists p LEFT JOIN users u ON u.id = p.user_id WHERE p.slug = ${slug}`;
        if (!l) { res.status(404).json({ error: 'Playlist not found.' }); return; }
        const ids = (await sql`SELECT beat_id FROM playlist_items WHERE playlist_id = ${l.id} ORDER BY added_at DESC`).map((r) => r.beat_id);
        res.status(200).json({ id: l.id, slug: l.slug, name: l.name, owner: l.display_name || l.handle || '', ownerHandle: l.handle || null, ids, mine: !!(session && session.uid === l.user_id) });
        return;
      }
      if (!session) { res.status(401).json({ error: 'Sign in to see your playlists.' }); return; }
      res.status(200).json({ playlists: await mine(session.uid) });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    if (!session) { res.status(401).json({ error: 'Sign in to make playlists.' }); return; }
    const b = req.body || {};
    if (b.do === 'create') {
      const name = cleanName(b.name);
      if (!name) { res.status(400).json({ error: 'Give the playlist a name.' }); return; }
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM playlists WHERE user_id = ${session.uid}`;
      if (n >= MAX_LISTS) { res.status(400).json({ error: `Up to ${MAX_LISTS} playlists.` }); return; }
      let created = null;
      for (let i = 0; i < 5 && !created; i++) {
        const rows = await sql`INSERT INTO playlists (user_id, slug, name) VALUES (${session.uid}, ${newSlug()}, ${name}) ON CONFLICT DO NOTHING RETURNING id`;
        created = rows[0] || null;
      }
      if (!created) { res.status(500).json({ error: 'Could not create the playlist.' }); return; }
      if (okBeatId(b.beatId)) await sql`INSERT INTO playlist_items (playlist_id, beat_id) VALUES (${created.id}, ${String(b.beatId)}) ON CONFLICT DO NOTHING`;
    } else {
      const id = Number(b.id);
      const [own] = Number.isInteger(id) ? await sql`SELECT id FROM playlists WHERE id = ${id} AND user_id = ${session.uid}` : [];
      if (!own) { res.status(404).json({ error: 'Playlist not found.' }); return; }
      if (b.do === 'rename') {
        const name = cleanName(b.name);
        if (!name) { res.status(400).json({ error: 'Give the playlist a name.' }); return; }
        await sql`UPDATE playlists SET name = ${name} WHERE id = ${id}`;
      } else if (b.do === 'delete') {
        await sql`DELETE FROM playlist_items WHERE playlist_id = ${id}`;
        await sql`DELETE FROM playlists WHERE id = ${id}`;
      } else if (b.do === 'add') {
        if (!okBeatId(b.beatId)) { res.status(400).json({ error: 'Unknown track.' }); return; }
        const [{ n }] = await sql`SELECT count(*)::int AS n FROM playlist_items WHERE playlist_id = ${id}`;
        if (n >= MAX_TRACKS) { res.status(400).json({ error: `Up to ${MAX_TRACKS} tracks in a playlist.` }); return; }
        await sql`INSERT INTO playlist_items (playlist_id, beat_id) VALUES (${id}, ${String(b.beatId)}) ON CONFLICT DO NOTHING`;
      } else if (b.do === 'remove') {
        await sql`DELETE FROM playlist_items WHERE playlist_id = ${id} AND beat_id = ${String(b.beatId || '')}`;
      } else { res.status(400).json({ error: 'Unknown action.' }); return; }
    }
    res.status(200).json({ playlists: await mine(session.uid) });
  } catch (err) {
    console.error('playlists error:', err);
    res.status(500).json({ error: 'Could not save. Please try again.' });
  }
}

module.exports = { handlePlaylists };
