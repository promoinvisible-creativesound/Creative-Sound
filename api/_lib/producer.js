// Producer area: producers upload beats from their account; every beat is
// a "submission" that waits for the site owner's review before it can go
// on sale. Files go straight into the owner's Dropbox (see dropbox.js).
//
// Routes (rewritten in vercel.json to /api/tickets?action=...):
//   POST /api/producer/file        { submissionId?, kind, name, size }
//        -> { submissionId, uploadUrl }  (creates the draft on first file)
//   POST /api/producer/submit      { submissionId, producerName, title, ... }
//   GET  /api/producer/submissions -> { producerName, submissions: [...] }
//
// Statuses: draft -> pending (submitted) -> approved | rejected.
const { Resend } = require('resend');
const { sql } = require('./db');
const { getSession } = require('./auth');
const { roleFor } = require('./account');
const dropbox = require('./dropbox');
const LICENSES = require('../../data/beat-licenses.json');

const MB = 1024 * 1024;
// What a producer can upload, and the license tier each file unlocks.
const FILE_KINDS = {
  artwork: { exts: ['jpg', 'jpeg', 'png', 'webp'], max: 10 * MB, required: true },
  preview: { exts: ['mp3'], max: 30 * MB, required: true },
  mp3: { exts: ['mp3'], max: 50 * MB },
  wav: { exts: ['wav'], max: dropbox.MAX_UPLOAD_BYTES },
  stems: { exts: ['zip', 'rar', '7z'], max: dropbox.MAX_UPLOAD_BYTES },
  project: { exts: ['zip', 'rar', '7z', 'flp'], max: dropbox.MAX_UPLOAD_BYTES },
};
// A tier can only be priced if the files it delivers are there.
const TIER_NEEDS = { mp3: ['mp3'], wav: ['mp3', 'wav'], trackout: ['mp3', 'wav', 'stems'], project: ['mp3', 'wav', 'stems', 'project'] };
const MIN_PRICE = 500; // cents
const MAX_PRICE = 1000000;

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS producer_name TEXT`;
      await sql`
        CREATE TABLE IF NOT EXISTS beat_submissions (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          email TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          producer_name TEXT,
          title TEXT,
          bpm INTEGER,
          musical_key TEXT,
          genre TEXT,
          mood TEXT,
          tags JSONB NOT NULL DEFAULT '[]',
          type_beat JSONB NOT NULL DEFAULT '[]',
          about TEXT,
          prices JSONB NOT NULL DEFAULT '{}',
          files JSONB NOT NULL DEFAULT '{}',
          review_note TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          submitted_at TIMESTAMPTZ,
          reviewed_at TIMESTAMPTZ
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS beat_submissions_user_idx ON beat_submissions (user_id)`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const clean = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

// Signed-in producer or an error already sent.
async function producerSession(req, res) {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return null; }
  if ((await roleFor(session.uid)) !== 'producer') {
    res.status(403).json({ error: 'This is for producer accounts. You can switch in Settings.' });
    return null;
  }
  await ensureTables();
  return session;
}

async function ownDraft(session, id) {
  const [row] = await sql`SELECT * FROM beat_submissions WHERE id = ${id} AND user_id = ${session.uid}`;
  return row && row.status === 'draft' ? row : null;
}

// POST { submissionId?, kind, name, size } -> one-off Dropbox upload URL.
async function handleFile(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerSession(req, res);
    if (!session) return;
    if (!dropbox.configured()) {
      res.status(503).json({ error: "Uploads aren't switched on yet. Please try again soon." });
      return;
    }
    const body = req.body || {};
    const kind = String(body.kind || '');
    const spec = FILE_KINDS[kind];
    const name = clean(body.name, 160);
    const size = Number(body.size);
    if (!spec) { res.status(400).json({ error: 'Unknown file type.' }); return; }
    if (!spec.exts.includes(ext(name))) {
      res.status(400).json({ error: `Use a ${spec.exts.map((e) => `.${e}`).join(', ')} file.` });
      return;
    }
    if (!Number.isFinite(size) || size <= 0 || size > spec.max) {
      res.status(400).json({ error: `That file is too big (max ${Math.round(spec.max / MB)} MB).` });
      return;
    }

    let sub = null;
    if (body.submissionId) {
      sub = await ownDraft(session, Number(body.submissionId));
      if (!sub) { res.status(404).json({ error: 'This upload has expired. Reload the page to start again.' }); return; }
    } else {
      // Cap open drafts so a script can't fill the Dropbox.
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM beat_submissions WHERE user_id = ${session.uid} AND status = 'draft' AND created_at > now() - interval '1 day'`;
      if (n >= 10) { res.status(429).json({ error: 'Too many unfinished uploads today. Finish one first.' }); return; }
      [sub] = await sql`INSERT INTO beat_submissions (user_id, email) VALUES (${session.uid}, ${session.email}) RETURNING *`;
    }

    // /submissions/<id>/<kind>.<ext>: one file per kind, replaced on re-upload.
    const path = `/submissions/${sub.id}/${kind}.${ext(name)}`;
    const uploadUrl = await dropbox.uploadLink(path);
    const files = { ...(sub.files || {}), [kind]: { path, name, size } };
    await sql`UPDATE beat_submissions SET files = ${JSON.stringify(files)}::jsonb, updated_at = now() WHERE id = ${sub.id}`;
    res.status(200).json({ submissionId: sub.id, uploadUrl });
  } catch (err) {
    console.error('producer file error:', err);
    res.status(500).json({ error: 'Could not start the upload, please try again.' });
  }
}

// Validates the details form; returns { data } or { error }.
function validateDetails(body, files) {
  const producerName = clean(body.producerName, 60);
  const title = clean(body.title, 80);
  const bpm = Number(body.bpm);
  const key = clean(body.key, 12);
  const genre = clean(body.genre, 40);
  const mood = clean(body.mood, 40);
  const list = (v, n, len) => (Array.isArray(v) ? v : String(v || '').split(','))
    .map((t) => clean(t, len).replace(/^#/, '')).filter(Boolean).slice(0, n);
  const tags = [...new Set(list(body.tags, 8, 24).map((t) => t.toLowerCase()))];
  const typeBeat = list(body.typeBeat, 3, 40);
  const about = String(body.about || '').trim().slice(0, 600);

  if (!producerName) return { error: 'Add your producer name.' };
  if (!title) return { error: 'Give the beat a title.' };
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 250) return { error: 'BPM must be a whole number between 40 and 250.' };
  if (!key) return { error: 'Choose the key.' };
  if (!genre) return { error: 'Choose a genre.' };
  if (!mood) return { error: 'Choose a mood.' };
  if (body.agree !== true) return { error: 'Please confirm you own the rights to this beat.' };

  for (const [kind, spec] of Object.entries(FILE_KINDS)) {
    if (spec.required && !files[kind]) return { error: kind === 'artwork' ? 'Upload the cover art.' : 'Upload the preview MP3.' };
  }
  const prices = {};
  for (const tier of LICENSES.order) {
    const raw = body.prices && body.prices[tier];
    if (raw == null || raw === '' || raw === false) continue;
    const cents = Math.round(Number(raw) * 100);
    if (!Number.isFinite(cents) || cents < MIN_PRICE || cents > MAX_PRICE) {
      return { error: `${LICENSES.tiers[tier].name}: price between €${MIN_PRICE / 100} and €${MAX_PRICE / 100}.` };
    }
    const missing = TIER_NEEDS[tier].filter((k) => !files[k]);
    if (missing.length) return { error: `${LICENSES.tiers[tier].name} needs the ${missing.join(', ')} file${missing.length > 1 ? 's' : ''}.` };
    prices[tier] = cents;
  }
  if (!Object.keys(prices).length) return { error: 'Set a price for at least one license.' };
  return { data: { producerName, title, bpm, key, genre, mood, tags, typeBeat, about, prices } };
}

// POST the details: the draft becomes "pending" and the owner gets an email.
async function handleSubmit(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerSession(req, res);
    if (!session) return;
    const body = req.body || {};
    const sub = await ownDraft(session, Number(body.submissionId));
    if (!sub) { res.status(404).json({ error: 'Upload the cover and preview first.' }); return; }

    const files = sub.files || {};
    const { data, error } = validateDetails(body, files);
    if (error) { res.status(400).json({ error }); return; }

    // Every file the form says it uploaded must really be in Dropbox.
    for (const [kind, f] of Object.entries(files)) {
      const size = await dropbox.fileSize(f.path);
      if (size == null) { res.status(400).json({ error: `The ${kind} file didn't finish uploading. Please upload it again.` }); return; }
      files[kind] = { ...f, size };
    }

    await sql`UPDATE users SET producer_name = ${data.producerName} WHERE id = ${session.uid}`;
    await sql`
      UPDATE beat_submissions SET
        status = 'pending', producer_name = ${data.producerName}, title = ${data.title}, bpm = ${data.bpm},
        musical_key = ${data.key}, genre = ${data.genre}, mood = ${data.mood},
        tags = ${JSON.stringify(data.tags)}::jsonb, type_beat = ${JSON.stringify(data.typeBeat)}::jsonb,
        about = ${data.about || null}, prices = ${JSON.stringify(data.prices)}::jsonb,
        files = ${JSON.stringify(files)}::jsonb, submitted_at = now(), updated_at = now()
      WHERE id = ${sub.id}
    `;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const prices = Object.entries(data.prices).map(([t, c]) => `${LICENSES.tiers[t].name} €${(c / 100).toFixed(2)}`).join(' · ');
      const { error: mailError } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: 'hello@creativesound.io',
        replyTo: session.email,
        subject: `New beat to review: ${data.title} by ${data.producerName}`,
        html: `
          <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;">
            <h1 style="color:#FFB347;font-size:18px;">New beat submitted for review</h1>
            <p><strong>${esc(data.title)}</strong> by ${esc(data.producerName)} (${esc(session.email)})</p>
            <p>${data.bpm} BPM · ${esc(data.key)} · ${esc(data.genre)} · ${esc(data.mood)}</p>
            <p>${esc(prices)}</p>
            <p>Files: ${Object.keys(files).map(esc).join(', ')}, in Dropbox under /submissions/${sub.id}/</p>
            <p style="color:#8a877e;font-size:13px;">Submission #${sub.id}</p>
          </div>`,
      });
      if (mailError) console.error('producer submit email error:', mailError);
    } catch (err) {
      console.error('producer submit email error:', err);
    }

    res.status(200).json({ ok: true, id: sub.id, status: 'pending' });
  } catch (err) {
    console.error('producer submit error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
}

// GET the producer's own submissions (drafts left out).
async function handleSubmissions(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerSession(req, res);
    if (!session) return;
    const [user] = await sql`SELECT producer_name FROM users WHERE id = ${session.uid}`;
    const rows = await sql`
      SELECT id, status, title, bpm, musical_key, genre, mood, prices, review_note, submitted_at, reviewed_at
      FROM beat_submissions
      WHERE user_id = ${session.uid} AND status <> 'draft'
      ORDER BY submitted_at DESC NULLS LAST, id DESC
      LIMIT 200
    `;
    res.status(200).json({
      producerName: (user && user.producer_name) || '',
      uploadsEnabled: dropbox.configured(),
      submissions: rows.map((r) => ({
        id: r.id, status: r.status, title: r.title, bpm: r.bpm, key: r.musical_key, genre: r.genre, mood: r.mood,
        prices: r.prices, reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
      })),
    });
  } catch (err) {
    console.error('producer submissions error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

/* --------------------------------- Review ---------------------------------
   For the site owner only: ADMIN_EMAILS (comma-separated) lists the
   accounts allowed to review. Nobody is an admin if it isn't set. */
function isAdmin(session) {
  const list = String(process.env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return !!(session && list.includes(String(session.email).toLowerCase()));
}

// GET ?status=pending|approved|rejected -> submissions with read links.
async function handleAdminList(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (!isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    // Oldest first in the queue, newest first in the history.
    const rows = status === 'pending'
      ? await sql`SELECT * FROM beat_submissions WHERE status = 'pending' ORDER BY submitted_at ASC LIMIT 100`
      : await sql`SELECT * FROM beat_submissions WHERE status = ${status} ORDER BY reviewed_at DESC NULLS LAST LIMIT 100`;
    const out = [];
    for (const r of rows) {
      const links = {};
      if (dropbox.configured()) {
        for (const [kind, f] of Object.entries(r.files || {})) {
          try { links[kind] = await dropbox.readLink(f.path); } catch (err) { links[kind] = null; }
        }
      }
      out.push({
        id: r.id, status: r.status, email: r.email, producerName: r.producer_name, title: r.title, bpm: r.bpm,
        key: r.musical_key, genre: r.genre, mood: r.mood, tags: r.tags, typeBeat: r.type_beat, about: r.about,
        prices: r.prices, files: r.files, links, reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
      });
    }
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM beat_submissions WHERE status = 'pending'`;
    res.status(200).json({ submissions: out, pendingCount: n });
  } catch (err) {
    console.error('admin list error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

// POST { id, decision: 'approve' | 'reject', note } -> updates and emails the producer.
async function handleAdminReview(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (!isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    const body = req.body || {};
    const id = Number(body.id);
    const decision = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null;
    const note = String(body.note || '').trim().slice(0, 1000);
    if (!decision) { res.status(400).json({ error: 'Choose approve or reject.' }); return; }
    if (decision === 'rejected' && !note) { res.status(400).json({ error: 'Tell the producer what to fix.' }); return; }
    const [sub] = await sql`
      UPDATE beat_submissions SET status = ${decision}, review_note = ${note || null}, reviewed_at = now(), updated_at = now()
      WHERE id = ${id} AND status <> 'draft' RETURNING *
    `;
    if (!sub) { res.status(404).json({ error: 'Submission not found.' }); return; }

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const site = process.env.SITE_URL || 'https://creativesound.io';
      const ok = decision === 'approved';
      const { error: mailError } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: sub.email,
        replyTo: 'hello@creativesound.io',
        subject: ok ? `Approved: ${sub.title}` : `Changes needed: ${sub.title}`,
        html: `
          <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;">
            <h1 style="color:#FFB347;font-size:20px;">${ok ? 'Your track is approved' : 'Your track needs a few changes'}</h1>
            <p><strong>${esc(sub.title)}</strong> ${ok ? 'passed review and will go on sale in the Creative Sound store.' : "didn't pass review yet."}</p>
            ${note ? `<p style="white-space:pre-wrap;background:#141210;padding:14px;border-radius:8px;">${esc(note)}</p>` : ''}
            <p><a href="${site}/profile-producer.html" style="color:#FFB347;">Open your producer area</a></p>
            <p style="margin-top:28px;color:#8a877e;font-size:13px;">Creative Sound — sound tools by Invisible</p>
          </div>`,
      });
      if (mailError) console.error('review email error:', mailError);
    } catch (err) {
      console.error('review email error:', err);
    }
    res.status(200).json({ ok: true, id: sub.id, status: sub.status });
  } catch (err) {
    console.error('admin review error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

module.exports = {
  FILE_KINDS, TIER_NEEDS, validateDetails, ensureTables, isAdmin,
  handleFile, handleSubmit, handleSubmissions, handleAdminList, handleAdminReview,
};
