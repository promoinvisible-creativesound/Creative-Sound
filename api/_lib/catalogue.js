// Live catalogue: the tracks in data/beats.json plus every producer upload
// approved on the review page, so an approval goes on sale on its own.
//
//   GET /api/beats/catalogue            -> { currency, producers, beats }
//   GET /api/beats/media?id=&kind=      -> 302 to the cover or tagged preview
//   GET /api/beats/file?t=<token>       -> 302 to a bought file (signed link)
//
// Producer tracks keep their files in Dropbox. Only the cover and the
// tagged preview are ever public (through short-lived Dropbox links); the
// files a buyer pays for are reached only through a signed token tied to
// the buyer's email, the track and the file type.
const jwt = require('jsonwebtoken');
const { sql } = require('./db');
const dropbox = require('./dropbox');
const CATALOGUE = require('../../data/beats.json');
const LICENSES = require('../../data/beat-licenses.json');

const staticById = new Map((CATALOGUE.beats || []).map((b) => [b.id, b]));
const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];
// License file types -> producer upload kinds
const KIND_OF = { mp3: 'mp3', wav: 'wav', stems: 'stems', flp: 'project' };

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 48) || 'track';
const trackId = (row) => `t${row.id}-${slug(row.title)}`;
const submissionIdOf = (id) => { const m = /^t(\d+)-/.exec(String(id)); return m ? Number(m[1]) : null; };
const isTrackId = (id) => submissionIdOf(id) != null;

function toBeat(row) {
  const id = trackId(row);
  return {
    id,
    source: 'producer',
    title: row.title,
    producer: row.producer_name,
    verified: !!row.producer_verified,
    producerHandle: row.producer_handle || null,
    // Contact for private requests, only what the producer chose to share.
    contact: row.producer_instagram || row.producer_email ? { instagram: row.producer_instagram || null, email: row.producer_email || null } : null,
    bpm: row.bpm,
    key: row.musical_key,
    genre: row.genre,
    mood: row.mood,
    tags: row.tags || [],
    typeBeat: row.type_beat || [],
    about: row.about || '',
    released: new Date(row.reviewed_at || row.submitted_at || Date.now()).toISOString().slice(0, 10),
    prices: row.prices || {},
    tint: TINTS[row.id % TINTS.length],
    cover: row.files && row.files.artwork ? `/api/beats/media?id=${id}&kind=artwork` : null,
    preview: `/api/beats/media?id=${id}&kind=preview`,
    // Server only (stripped before anything is sent to the browser)
    _files: row.files || {},
    _submissionId: row.id,
    _userId: row.user_id,
  };
}
// Strip server-only fields (anything starting with _) before sending.
const publicBeat = (b) => Object.fromEntries(Object.entries(b).filter(([k]) => !k.startsWith('_')));

async function approvedRows(id) {
  try {
    // Profile columns (handle, display name) are read below; make sure they exist.
    await require('./profile').ensureColumns();
    if (id != null) {
      return await sql`
        SELECT s.*, u.producer_verified, u.handle AS producer_handle, u.display_name AS producer_display, u.instagram AS producer_instagram, u.contact_email AS producer_email FROM beat_submissions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.id = ${id} AND s.status = 'approved'
      `;
    }
    return await sql`
      SELECT s.*, u.producer_verified, u.handle AS producer_handle, u.display_name AS producer_display, u.instagram AS producer_instagram, u.contact_email AS producer_email FROM beat_submissions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.status = 'approved' ORDER BY s.reviewed_at DESC LIMIT 1000
    `;
  } catch (err) {
    // Table not created yet (no uploads so far) or DB hiccup: static only.
    if (!/does not exist/.test(String(err && err.message))) console.error('catalogue db error:', err);
    return [];
  }
}

// One beat by id: catalogue file first, then approved producer uploads.
async function getBeat(id) {
  if (staticById.has(id)) return staticById.get(id);
  const sub = submissionIdOf(id);
  if (sub == null) return null;
  const [row] = await approvedRows(sub);
  if (!row) return null;
  const beat = toBeat(row);
  return beat.id === id ? beat : null;
}

async function liveBeats() {
  const rows = await approvedRows();
  return [...(CATALOGUE.beats || []), ...rows.map(toBeat)];
}

async function handleCatalogue(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const beats = (await liveBeats()).map(publicBeat);
  // Shared cache at the edge: an approval shows within about a minute.
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=600');
  res.status(200).json({ currency: CATALOGUE.currency, producers: CATALOGUE.producers || {}, beats, salesOpen: process.env.BEAT_SALES_OPEN === '1' });
}

// Cover and tagged preview of an approved producer track.
async function handleMedia(req, res) {
  const id = String((req.query && req.query.id) || '');
  const kind = String((req.query && req.query.kind) || '');
  if (!['artwork', 'preview'].includes(kind)) { res.status(400).json({ error: 'Unknown media.' }); return; }
  try {
    const beat = await getBeat(id);
    // The public preview is the voice-tagged one; the producer's original
    // preview is only used for tracks approved before tagging existed.
    const files = (beat && beat._files) || {};
    const f = kind === 'preview' ? (files.tagged || files.preview) : files[kind];
    if (!f || !dropbox.configured()) { res.status(404).json({ error: 'Not found.' }); return; }
    const link = await dropbox.readLink(f.path);
    // Dropbox links last 4 hours; caches keep the redirect well inside that.
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3000');
    res.statusCode = 302;
    res.setHeader('Location', link);
    res.end();
  } catch (err) {
    console.error('beats media error:', err);
    res.status(502).json({ error: 'Could not load the file.' });
  }
}

/* ------------------------------ Bought files ------------------------------ */
// Signed, long-lived link for one bought file of a producer track, used in
// the delivery email and the account page. Valid only for that buyer.
const fileToken = (email, beatId, type) => jwt.sign({ e: String(email).toLowerCase(), b: beatId, f: type }, process.env.JWT_SECRET, { expiresIn: '3650d' });

// Delivery list for a producer track and tier: [{ type, label, url }]
function producerFiles(beat, tier, email, siteUrl) {
  return LICENSES.tiers[tier].files.map((type) => {
    const kind = KIND_OF[type];
    const has = !!(beat._files && beat._files[kind]);
    return {
      type,
      label: LICENSES.fileLabels[type],
      url: has ? `${siteUrl}/api/beats/file?t=${encodeURIComponent(fileToken(email, beat.id, type))}` : null,
    };
  });
}

async function handleBoughtFile(req, res) {
  let claim;
  try { claim = jwt.verify(String((req.query && req.query.t) || ''), process.env.JWT_SECRET); } catch (e) { claim = null; }
  if (!claim || !claim.e || !claim.b || !claim.f) { res.status(403).send('This download link is not valid.'); return; }
  try {
    // The buyer must still own a license for this track that includes the file.
    const rows = await sql`SELECT tier FROM beat_purchases WHERE email = ${claim.e} AND beat_id = ${claim.b}`;
    const allowed = rows.some((r) => LICENSES.tiers[r.tier] && LICENSES.tiers[r.tier].files.includes(claim.f));
    if (!allowed) { res.status(403).send('This download link is not valid for this account.'); return; }
    const beat = await getBeat(claim.b);
    const f = beat && beat._files && beat._files[KIND_OF[claim.f]];
    if (!f) { res.status(404).send('This file is no longer available. Please contact hello@creativesound.io.'); return; }
    const link = await dropbox.readLink(f.path);
    res.setHeader('Cache-Control', 'private, no-store');
    res.statusCode = 302;
    res.setHeader('Location', link);
    res.end();
  } catch (err) {
    console.error('bought file error:', err);
    res.status(502).send('Could not open the file. Please try again in a moment.');
  }
}

module.exports = {
  getBeat, liveBeats, isTrackId, trackId, producerFiles, publicBeat,
  handleCatalogue, handleMedia, handleBoughtFile,
};
