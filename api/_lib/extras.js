// Listening extras for producer tracks:
//   GET  /api/beats/free?id=<trackId>     -> { url, name } tagged preview, if the
//                                           producer allows free downloads (sign-in
//                                           required; each download is logged)
//   POST /api/beats/peaks { id, peaks }   -> stores the waveform once (computed by
//                                           the first browser that plays the track)
//   GET  /api/beats/lyrics?id=            -> { text } your lyrics for a track
//   POST /api/beats/lyrics { id, text }   -> save them (per account)
const { sql } = require('./db');
const { getSession } = require('./auth');

const submissionIdOf = (id) => { const m = /^t(\d+)-/.exec(String(id || '')); return m ? Number(m[1]) : null; };

// Version of the free download terms shown before the download (js/beats.js).
const FREE_TERMS_VERSION = 'demo-1';

let ready = null;
function ensureColumns() {
  if (!ready) {
    ready = (async () => {
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS free_download BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS peaks JSONB`;
      await sql`CREATE TABLE IF NOT EXISTS beat_free_downloads (id SERIAL PRIMARY KEY, submission_id INTEGER NOT NULL, user_id INTEGER, email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await sql`ALTER TABLE beat_free_downloads ADD COLUMN IF NOT EXISTS terms_version TEXT`;
      await sql`CREATE TABLE IF NOT EXISTS beat_lyrics (user_id INTEGER NOT NULL, beat_id TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (user_id, beat_id))`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function handleFree(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Sign in to download the free version.' }); return; }
  const id = String((req.query && req.query.id) || '');
  const sub = submissionIdOf(id);
  if (sub == null) { res.status(404).json({ error: 'Not found.' }); return; }
  // The demo terms (test use only) must be accepted first; the version is logged.
  if (String((req.query && req.query.accept) || '') !== FREE_TERMS_VERSION) { res.status(428).json({ error: 'Please accept the free download terms first.' }); return; }
  try {
    await ensureColumns();
    const [row] = await sql`SELECT id, title, producer_name, free_download FROM beat_submissions WHERE id = ${sub} AND status = 'approved'`;
    if (!row || !row.free_download) { res.status(403).json({ error: 'The producer has not enabled free downloads for this track.' }); return; }
    await sql`INSERT INTO beat_free_downloads (submission_id, user_id, email, terms_version) VALUES (${row.id}, ${session.uid}, ${session.email}, ${FREE_TERMS_VERSION})`;
    const clean = (s) => String(s || '').replace(/[^\w .()-]+/g, '').trim();
    res.status(200).json({
      url: `/api/beats/media?id=${encodeURIComponent(id)}&kind=preview&dl=${Date.now().toString(36)}`,
      name: `${clean(row.title)} (tagged) - ${clean(row.producer_name)}.mp3`,
    });
  } catch (err) {
    console.error('free download error:', err);
    res.status(500).json({ error: 'Could not prepare the download.' });
  }
}

async function handlePeaks(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const id = String((req.body && req.body.id) || '');
  const peaks = req.body && req.body.peaks;
  const sub = submissionIdOf(id);
  const ok = Array.isArray(peaks) && peaks.length >= 40 && peaks.length <= 400 && peaks.every((n) => Number.isInteger(n) && n >= 0 && n <= 100);
  if (sub == null || !ok) { res.status(400).json({ error: 'Bad waveform.' }); return; }
  try {
    await ensureColumns();
    // First one wins: later posts never overwrite a stored waveform.
    await sql`UPDATE beat_submissions SET peaks = ${JSON.stringify(peaks)}::jsonb WHERE id = ${sub} AND status = 'approved' AND peaks IS NULL`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('peaks error:', err);
    res.status(500).json({ error: 'Could not save.' });
  }
}

async function handleLyrics(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Sign in to keep your lyrics on your account.' }); return; }
  try {
    await ensureColumns();
    if (req.method === 'GET') {
      const id = String((req.query && req.query.id) || '').slice(0, 120);
      const [row] = await sql`SELECT body, updated_at FROM beat_lyrics WHERE user_id = ${session.uid} AND beat_id = ${id}`;
      res.status(200).json({ text: row ? row.body : '', updatedAt: row ? row.updated_at : null });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const id = String((req.body && req.body.id) || '').slice(0, 120);
    const text = String((req.body && req.body.text) || '').slice(0, 20000);
    if (!id) { res.status(400).json({ error: 'Missing track.' }); return; }
    await sql`
      INSERT INTO beat_lyrics (user_id, beat_id, body, updated_at) VALUES (${session.uid}, ${id}, ${text}, now())
      ON CONFLICT (user_id, beat_id) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('lyrics error:', err);
    res.status(500).json({ error: 'Could not save your lyrics.' });
  }
}

/* --------------------------------- Stats ---------------------------------- */
// Store events for producer tracks (page view, preview play, save, cart add)
// with where the visitor came from; producers see them in their area.
//   POST /api/beats/event { beatId, kind, source }   (sendBeacon, no auth)
//   GET  /api/producer/stats                         (the producer's tracks)
const KINDS = ['view', 'play', 'save', 'cart'];
let eventsReady = null;
function ensureEvents() {
  if (!eventsReady) {
    eventsReady = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS beat_events (id BIGSERIAL PRIMARY KEY, submission_id INTEGER NOT NULL, kind TEXT NOT NULL, source TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await sql`CREATE INDEX IF NOT EXISTS beat_events_sub_idx ON beat_events (submission_id, created_at)`;
    })().catch((err) => { eventsReady = null; throw err; });
  }
  return eventsReady;
}

async function handleEvent(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (err) { body = {}; } }
  const sub = submissionIdOf(body.beatId);
  const kind = String(body.kind || '');
  const source = String(body.source || 'direct').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 30) || 'direct';
  if (sub == null || !KINDS.includes(kind)) { res.status(400).end(); return; }
  try {
    await ensureEvents();
    await sql`INSERT INTO beat_events (submission_id, kind, source) VALUES (${sub}, ${kind}, ${source})`;
    res.status(204).end();
  } catch (err) {
    console.error('beat event error:', err);
    res.status(500).end();
  }
}

async function handleStats(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  try {
    await ensureEvents();
    const subs = await sql`SELECT id FROM beat_submissions WHERE user_id = ${session.uid} AND status = 'approved'`;
    const ids = subs.map((r) => r.id);
    if (!ids.length) { res.status(200).json({ tracks: {} }); return; }
    const [totals, recent, daily, sources] = await Promise.all([
      sql`SELECT submission_id, kind, count(*)::int AS n FROM beat_events WHERE submission_id = ANY(${ids}::int[]) GROUP BY 1, 2`,
      sql`SELECT submission_id, kind, count(*)::int AS n FROM beat_events WHERE submission_id = ANY(${ids}::int[]) AND created_at > now() - interval '30 days' GROUP BY 1, 2`,
      sql`SELECT submission_id, to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n FROM beat_events WHERE submission_id = ANY(${ids}::int[]) AND kind = 'play' AND created_at > now() - interval '30 days' GROUP BY 1, 2`,
      sql`SELECT submission_id, source, count(*)::int AS n FROM beat_events WHERE submission_id = ANY(${ids}::int[]) AND kind IN ('view', 'play') AND created_at > now() - interval '90 days' GROUP BY 1, 2`,
    ]);
    let sales = [];
    try {
      sales = await sql`
        SELECT s.id AS submission_id, count(p.*)::int AS n, coalesce(sum(p.price_cents), 0)::int AS cents,
               count(p.*) FILTER (WHERE p.created_at > now() - interval '30 days')::int AS n30
        FROM beat_submissions s JOIN beat_purchases p ON p.beat_id LIKE ('t' || s.id || '-%')
        WHERE s.id = ANY(${ids}::int[]) GROUP BY s.id`;
    } catch (err) { if (!/does not exist/.test(String(err.message))) throw err; }
    const tracks = {};
    const t = (id) => (tracks[id] = tracks[id] || { all: {}, d30: {}, daily: {}, sources: {}, sales: { n: 0, n30: 0, cents: 0 } });
    totals.forEach((r) => { t(r.submission_id).all[r.kind] = r.n; });
    recent.forEach((r) => { t(r.submission_id).d30[r.kind] = r.n; });
    daily.forEach((r) => { t(r.submission_id).daily[r.day] = r.n; });
    sources.forEach((r) => { t(r.submission_id).sources[r.source || 'direct'] = r.n; });
    sales.forEach((r) => { t(r.submission_id).sales = { n: r.n, n30: r.n30, cents: r.cents }; });
    res.status(200).json({ tracks });
  } catch (err) {
    console.error('producer stats error:', err);
    res.status(500).json({ error: 'Could not load your stats.' });
  }
}

module.exports = { handleFree, handlePeaks, handleLyrics, ensureColumns, handleEvent, handleStats };
