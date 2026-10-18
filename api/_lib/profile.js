// Public profiles for every account (producers, artists, listeners):
// photo, display name, @handle, bio, Instagram / TikTok and genres
// (produced by producers, liked by everyone else). Producers' approved
// tracks show on their page.
//
//   GET  /api/profile/me            -> own profile (for the editor)
//   POST /api/profile/me            -> save { displayName, handle, bio, instagram, tiktok, genres }
//   POST /api/profile/avatar        -> { uploadUrl } one-off Dropbox link for the photo
//   GET  /api/profile/public?u=     -> public profile + tracks
//   GET  /api/profile/photo?u=      -> 302 to the photo
const { sql } = require('./db');
const { getSession } = require('./auth');
const { roleFor } = require('./account');
const dropbox = require('./dropbox');

const GENRES = ['Trap', 'Hip Hop', 'Drill', 'UK Drill', 'R&B', 'Boom Bap', 'Pop', 'Afrobeat', 'Amapiano', 'Reggaeton', 'Latin', 'Dancehall', 'Lo-fi', 'Phonk', 'Rage', 'Plugg', 'Jersey Club', 'Hyperpop', 'Cloud Rap', 'Emo Rap', 'UK Garage', 'Grime', 'House', 'Deep House', 'Tech House', 'Afro House', 'Techno', 'Drum & Bass', 'Dubstep', 'Future Bass', 'EDM', 'Synthwave', 'Disco', 'Funk', 'Brazilian Funk', 'Soul', 'Neo Soul', 'Gospel', 'Jazz', 'Rock', 'Indie', 'Ambient', 'Cinematic', 'Reggae', 'Country', 'Other'];
const RESERVED = new Set(['admin', 'creativesound', 'creative-sound', 'invisible', 'support', 'help', 'api', 'beats', 'tracks', 'home']);
const MB = 1024 * 1024;
// Storefront colours a producer can pick.
const ACCENTS = ['#e8862c', '#f2c94c', '#ef5b5b', '#ff6fa8', '#b37cff', '#5b8cff', '#3ec7e0', '#3ecf8e', '#a3d65c', '#f5f5f7'];

let ready = null;
function ensureColumns() {
  if (!ready) {
    ready = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS handle TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS instagram TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tiktok TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS genres JSONB NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_path TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS producer_name TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS producer_verified BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS producer_tag_path TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS store_banner_path TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS store_accent TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS store_headline TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS store_pinned JSONB NOT NULL DEFAULT '[]'`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_handle_idx ON users (lower(handle)) WHERE handle IS NOT NULL`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const handleOk = (h) => /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(h);
// "@name", "instagram.com/name/" or a full URL -> "name"
const social = (v, host) => {
  let s = clean(v, 200);
  if (!s) return '';
  s = s.replace(/^https?:\/\/(www\.)?/i, '').replace(new RegExp(`^${host.replace('.', '\\.')}/`, 'i'), '').replace(/^@/, '').split(/[/?#]/)[0];
  return /^[A-Za-z0-9._]{1,30}$/.test(s) ? s : null;
};

// Public contact email (optional): '' when empty, null when invalid.
const contactEmailOf = (v) => {
  const s = clean(v, 120).toLowerCase();
  if (!s) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
};

// Upload page: the producer's contact for private requests (Instagram,
// email). Saved on the profile so every track and the public page use it.
// Returns an error message or ''.
async function saveContact(uid, igRaw, emailRaw) {
  await ensureColumns();
  const instagram = social(igRaw, 'instagram.com');
  const email = contactEmailOf(emailRaw);
  if (instagram === null) return 'Instagram: use your @username or profile link.';
  if (email === null) return 'Contact email: check the address.';
  await sql`UPDATE users SET instagram = ${instagram || null}, contact_email = ${email || null} WHERE id = ${uid}`;
  return '';
}

const photoUrl = (row) => (row.avatar_path && row.handle ? `/api/profile/photo?u=${encodeURIComponent(row.handle)}&v=${encodeURIComponent(String(row.avatar_path).split('?v=')[1] || '1')}` : null);
const shape = (row, role) => ({
  handle: row.handle || '',
  displayName: row.display_name || row.producer_name || '',
  bio: row.bio || '',
  instagram: row.instagram || '',
  tiktok: row.tiktok || '',
  contactEmail: row.contact_email || '',
  genres: row.genres || [],
  photo: photoUrl(row),
  role: role || row.role || null,
  verified: (role || row.role) === 'producer' && !!row.producer_verified,
  // Producer storefront look: banner, colour, one-line headline, pinned tracks.
  store: {
    banner: row.store_banner_path && row.handle ? `/api/profile/photo?u=${encodeURIComponent(row.handle)}&kind=banner&v=${encodeURIComponent(String(row.store_banner_path).split('?v=')[1] || '1')}` : null,
    accent: ACCENTS.includes(row.store_accent) ? row.store_accent : null,
    headline: row.store_headline || '',
    pinned: Array.isArray(row.store_pinned) ? row.store_pinned : [],
  },
});

async function handleMe(req, res) {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  try {
    await ensureColumns();
    const role = await roleFor(session.uid);
    if (req.method === 'GET') {
      const [row] = await sql`SELECT * FROM users WHERE id = ${session.uid}`;
      res.status(200).json({ profile: shape(row, role), genres: GENRES, dropbox: dropbox.configured() });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = req.body || {};
    const displayName = clean(b.displayName, 50);
    const handle = clean(b.handle, 30).toLowerCase().replace(/^@/, '');
    const bio = String(b.bio || '').trim().slice(0, 400);
    const instagram = social(b.instagram, 'instagram.com');
    const tiktok = social(b.tiktok, 'tiktok.com');
    const contactEmail = contactEmailOf(b.contactEmail);
    const genres = [...new Set((Array.isArray(b.genres) ? b.genres : []).filter((g) => GENRES.includes(g)))].slice(0, 6);
    if (!displayName) { res.status(400).json({ error: 'Add the name people will see.' }); return; }
    if (!handleOk(handle)) { res.status(400).json({ error: 'Username: 3 to 30 characters, letters, numbers, dots, dashes or underscores.' }); return; }
    if (RESERVED.has(handle)) { res.status(400).json({ error: 'That username is reserved. Pick another one.' }); return; }
    if (instagram === null) { res.status(400).json({ error: 'Instagram: use your @username or profile link.' }); return; }
    if (tiktok === null) { res.status(400).json({ error: 'TikTok: use your @username or profile link.' }); return; }
    if (contactEmail === null) { res.status(400).json({ error: 'Contact email: check the address.' }); return; }
    const [taken] = await sql`SELECT id FROM users WHERE lower(handle) = ${handle} AND id <> ${session.uid}`;
    if (taken) { res.status(409).json({ error: 'That username is taken. Pick another one.' }); return; }
    const [row] = await sql`
      UPDATE users SET display_name = ${displayName}, handle = ${handle}, bio = ${bio || null},
        instagram = ${instagram || null}, tiktok = ${tiktok || null}, contact_email = ${contactEmail || null}, genres = ${JSON.stringify(genres)}::jsonb
      WHERE id = ${session.uid} RETURNING *
    `;
    res.status(200).json({ profile: shape(row, role) });
  } catch (err) {
    console.error('profile me error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
}

// One-off upload link for the profile photo (JPG/PNG/WebP, max 5 MB).
async function handleAvatar(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  try {
    await ensureColumns();
    if (!dropbox.configured()) { res.status(503).json({ error: "Photo uploads aren't switched on yet." }); return; }
    const name = clean(req.body && req.body.name, 120).toLowerCase();
    const size = Number(req.body && req.body.size);
    const ext = (name.match(/\.(jpe?g|png|webp)$/) || [])[1];
    if (!ext) { res.status(400).json({ error: 'Use a JPG, PNG or WebP image.' }); return; }
    if (!Number.isFinite(size) || size <= 0 || size > 5 * MB) { res.status(400).json({ error: 'The photo must be under 5 MB.' }); return; }
    const [row] = await sql`SELECT handle FROM users WHERE id = ${session.uid}`;
    if (!row || !row.handle) { res.status(400).json({ error: 'Save your username first, then add a photo.' }); return; }
    const path = `/avatars/${session.uid}.${ext === 'jpeg' ? 'jpg' : ext}`;
    const uploadUrl = await dropbox.uploadLink(path);
    // ?v= changes with every upload so caches pick up the new photo.
    await sql`UPDATE users SET avatar_path = ${`${path}?v=${Date.now().toString(36)}`} WHERE id = ${session.uid}`;
    res.status(200).json({ uploadUrl });
  } catch (err) {
    console.error('profile avatar error:', err);
    res.status(500).json({ error: 'Could not start the upload, please try again.' });
  }
}

// Producer tag: the producer's own short audio tag ("Invisible on the
// beat"), mixed into store previews between the Creative Sound tags.
//   GET    /api/profile/producer-tag   -> { url, name } or { url: null }
//   POST   /api/profile/producer-tag   -> { uploadUrl } for { name, size } (MP3/WAV, max 3 MB)
//   DELETE /api/profile/producer-tag   -> removes it
async function handleProducerTag(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  try {
    await ensureColumns();
    if (req.method === 'GET') {
      const [row] = await sql`SELECT producer_tag_path FROM users WHERE id = ${session.uid}`;
      const path = row && row.producer_tag_path ? String(row.producer_tag_path).split('?v=')[0] : null;
      res.status(200).json({ url: path && dropbox.configured() ? await dropbox.readLink(path) : null, name: path ? path.split('/').pop() : null });
      return;
    }
    if (req.method === 'DELETE') {
      await sql`UPDATE users SET producer_tag_path = NULL WHERE id = ${session.uid}`;
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    if (!dropbox.configured()) { res.status(503).json({ error: "Uploads aren't switched on yet." }); return; }
    const name = clean(req.body && req.body.name, 120).toLowerCase();
    const size = Number(req.body && req.body.size);
    const ext = (name.match(/\.(mp3|wav)$/) || [])[1];
    if (!ext) { res.status(400).json({ error: 'Use an MP3 or WAV file.' }); return; }
    if (!Number.isFinite(size) || size <= 0 || size > 3 * MB) { res.status(400).json({ error: 'The tag must be under 3 MB.' }); return; }
    const path = `/producer-tags/${session.uid}.${ext}`;
    const uploadUrl = await dropbox.uploadLink(path);
    await sql`UPDATE users SET producer_tag_path = ${`${path}?v=${Date.now().toString(36)}`} WHERE id = ${session.uid}`;
    res.status(200).json({ uploadUrl });
  } catch (err) {
    console.error('producer tag error:', err);
    res.status(500).json({ error: 'Could not save your producer tag, please try again.' });
  }
}

async function handlePhoto(req, res) {
  const u = clean(req.query && req.query.u, 30).toLowerCase();
  try {
    await ensureColumns();
    const banner = req.query && req.query.kind === 'banner';
    const [row] = await sql`SELECT avatar_path, store_banner_path FROM users WHERE lower(handle) = ${u}`;
    const path = row && (banner ? row.store_banner_path : row.avatar_path);
    if (!path || !dropbox.configured()) { res.status(404).json({ error: 'Not found.' }); return; }
    const link = await dropbox.readLink(String(path).split('?v=')[0]);
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3000');
    res.statusCode = 302;
    res.setHeader('Location', link);
    res.end();
  } catch (err) {
    console.error('profile photo error:', err);
    res.status(502).json({ error: 'Could not load the photo.' });
  }
}

async function handlePublic(req, res) {
  const u = clean(req.query && req.query.u, 30).toLowerCase();
  try {
    await ensureColumns();
    const [row] = await sql`SELECT * FROM users WHERE lower(handle) = ${u}`;
    if (!row) { res.status(404).json({ error: 'Profile not found.' }); return; }
    let tracks = [];
    if (row.role === 'producer') {
      const { liveBeats, publicBeat } = require('./catalogue');
      tracks = (await liveBeats()).filter((b) => b.source === 'producer' && b._userId === row.id).map(publicBeat);
    }
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
    res.status(200).json({ profile: { ...shape(row), uid: row.id }, tracks });
  } catch (err) {
    console.error('profile public error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

// Producer storefront settings (creativesound.io/@handle).
//   GET    /api/profile/store                    -> { store, handle, accents, tracks }
//   POST   /api/profile/store { accent, headline, pinned }
//   POST   /api/profile/store { banner: { name, size } } -> { uploadUrl }
//   DELETE /api/profile/store                    -> removes the banner
async function handleStore(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  try {
    await ensureColumns();
    if ((await roleFor(session.uid)) !== 'producer') { res.status(403).json({ error: 'The storefront is for producers.' }); return; }
    const { liveBeats } = require('./catalogue');
    const mine = async () => (await liveBeats()).filter((b) => b.source === 'producer' && b._userId === session.uid);
    if (req.method === 'GET') {
      const [row] = await sql`SELECT * FROM users WHERE id = ${session.uid}`;
      const tracks = (await mine()).map((b) => ({ id: b.id, title: b.title, cover: b.cover, genre: b.genre }));
      res.status(200).json({ store: shape(row).store, handle: row.handle || '', accents: ACCENTS, tracks });
      return;
    }
    if (req.method === 'DELETE') {
      await sql`UPDATE users SET store_banner_path = NULL WHERE id = ${session.uid}`;
      res.status(200).json({ ok: true });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = req.body || {};
    if (b.banner) {
      if (!dropbox.configured()) { res.status(503).json({ error: "Uploads aren't switched on yet." }); return; }
      const name = clean(b.banner.name, 120).toLowerCase();
      const size = Number(b.banner.size);
      const ext = (name.match(/\.(jpe?g|png|webp)$/) || [])[1];
      if (!ext) { res.status(400).json({ error: 'Use a JPG, PNG or WebP image.' }); return; }
      if (!Number.isFinite(size) || size <= 0 || size > 5 * MB) { res.status(400).json({ error: 'The banner must be under 5 MB.' }); return; }
      const [row] = await sql`SELECT handle FROM users WHERE id = ${session.uid}`;
      if (!row || !row.handle) { res.status(400).json({ error: 'Save your username in your public profile first.' }); return; }
      const path = `/banners/${session.uid}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const uploadUrl = await dropbox.uploadLink(path);
      await sql`UPDATE users SET store_banner_path = ${`${path}?v=${Date.now().toString(36)}`} WHERE id = ${session.uid}`;
      res.status(200).json({ uploadUrl });
      return;
    }
    const accent = ACCENTS.includes(b.accent) ? b.accent : null;
    const headline = clean(b.headline, 90);
    const own = new Set((await mine()).map((t) => t.id));
    const pinned = [...new Set((Array.isArray(b.pinned) ? b.pinned : []).map(String).filter((id) => own.has(id)))].slice(0, 3);
    const [row] = await sql`
      UPDATE users SET store_accent = ${accent}, store_headline = ${headline || null}, store_pinned = ${JSON.stringify(pinned)}::jsonb
      WHERE id = ${session.uid} RETURNING *
    `;
    res.status(200).json({ store: shape(row).store });
  } catch (err) {
    console.error('profile store error:', err);
    res.status(500).json({ error: 'Could not save your storefront, please try again.' });
  }
}

module.exports = { handleStore, handleProducerTag, GENRES, ensureColumns, saveContact, handleMe, handleAvatar, handlePhoto, handlePublic };
