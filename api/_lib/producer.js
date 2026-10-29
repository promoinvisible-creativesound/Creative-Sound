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
const { roleFor, previewAllowed, isAdmin } = require('./account');
const dropbox = require('./dropbox');
const tpl = require('./emailTemplate');
const inspect = require('./inspect');
const { trackId } = require('./catalogue');
const LICENSES = require('../../data/beat-licenses.json');

const MB = 1024 * 1024;
// What a producer can upload (the store's file rules): WAV up to
// 300 MB, MP3 (tagged or untagged) up to 150 MB, stems as a ZIP. The
// project file is a ZIP too. Audio is also checked
// for length, sample rate, channels, bit depth / bitrate (see inspect.js).
const FILE_KINDS = {
  artwork: { exts: ['jpg', 'jpeg', 'png'], max: 10 * MB, required: true },
  preview: { exts: ['mp3'], max: 150 * MB, required: true, audio: 'mp3' },
  mp3: { exts: ['mp3'], max: 150 * MB, audio: 'mp3' },
  wav: { exts: ['wav'], max: 300 * MB, audio: 'wav' },
  stems: { exts: ['zip'], max: 300 * MB },
  project: { exts: ['zip'], max: 300 * MB },
};
// Bigger than a direct upload link allows: sent in pieces through us.
const CHUNK = 4 * 1024 * 1024;
const needsChunks = (size) => size > dropbox.MAX_UPLOAD_BYTES;
// A tier can only be priced if the files it delivers are there.
const TIER_NEEDS = { mp3: ['mp3'], wav: ['mp3', 'wav'], trackout: ['mp3', 'wav', 'stems'], project: ['mp3', 'wav', 'stems', 'project'] };
const MIN_PRICE = 500; // cents
const MAX_PRICE = 1000000;

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS producer_name TEXT`;
      // Verified badge: only set by the owner from the review page.
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS producer_verified BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_requested_at TIMESTAMPTZ`;
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
      // Accent colour picked from the cover in the producer's browser.
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS accent TEXT`;
      // Edits to an approved track: new files go to /rev/, the new details
      // wait in 'changes' until the admin approves them; the live version
      // stays as it is meanwhile.
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS rev_files JSONB NOT NULL DEFAULT '{}'`;
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS changes JSONB`;
      // Co-producers credited on the track: [{ name, handle }] (handle = a Creative Sound account, optional).
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS co_producers JSONB NOT NULL DEFAULT '[]'`;
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS changes_status TEXT`;
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ`;
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS sold_tier TEXT`;
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS changes_note TEXT`;
      await sql`ALTER TABLE beat_submissions ADD COLUMN IF NOT EXISTS changes_at TIMESTAMPTZ`;
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
  if (!previewAllowed(session)) { res.status(403).json({ error: 'Not available yet.' }); return null; }
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

// Uploads from the site owner's account skip the review queue: the upload
// page adds the voice tag and approves them right away (it uses the admin
// endpoints, so only this account can). Nobody else, not even other admins.
const AUTO_PUBLISH = ['promo.invisible@gmail.com'];
const autoPublishes = (session) => AUTO_PUBLISH.includes(String(session.email || '').toLowerCase());

// The producer's own approved track (for edits).
async function ownApproved(session, id) {
  const [row] = await sql`SELECT * FROM beat_submissions WHERE id = ${id} AND user_id = ${session.uid}`;
  return row && row.status === 'approved' ? row : null;
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

    // Edit of an approved track: the file goes to /rev/ and waits for review.
    if (body.editId) {
      await ensureTables();
      const live = await ownApproved(session, Number(body.editId));
      if (!live) { res.status(404).json({ error: 'Track not found.' }); return; }
      const revPath = `/submissions/${live.id}/rev/${kind}.${ext(name)}`;
      const revFiles = { ...(live.rev_files || {}), [kind]: { path: revPath, name, size } };
      await sql`UPDATE beat_submissions SET rev_files = ${JSON.stringify(revFiles)}::jsonb, updated_at = now() WHERE id = ${live.id}`;
      if (needsChunks(size)) { res.status(200).json({ submissionId: live.id, editId: live.id, chunked: true, chunkSize: CHUNK }); return; }
      res.status(200).json({ submissionId: live.id, editId: live.id, uploadUrl: await dropbox.uploadLink(revPath) });
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
    const files = { ...(sub.files || {}), [kind]: { path, name, size } };
    await sql`UPDATE beat_submissions SET files = ${JSON.stringify(files)}::jsonb, updated_at = now() WHERE id = ${sub.id}`;
    if (needsChunks(size)) {
      res.status(200).json({ submissionId: sub.id, chunked: true, chunkSize: CHUNK });
      return;
    }
    res.status(200).json({ submissionId: sub.id, uploadUrl: await dropbox.uploadLink(path) });
  } catch (err) {
    console.error('producer file error:', err);
    res.status(500).json({ error: 'Could not start the upload, please try again.' });
  }
}

// POST raw bytes ?submissionId=&kind=&offset=&session= -> one 4 MB piece of
// a file over 150 MB (registered first through handleFile). The first
// piece opens a Dropbox upload session, the last one commits the file.
async function handleChunk(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerSession(req, res);
    if (!session) return;
    const q = req.query || {};
    const kind = String(q.kind || '');
    const editing = !!q.editId;
    const sub = editing ? await ownApproved(session, Number(q.editId)) : await ownDraft(session, Number(q.submissionId));
    const f = sub && (editing ? sub.rev_files : sub.files) && (editing ? sub.rev_files : sub.files)[kind];
    if (!f || !needsChunks(f.size)) { res.status(404).json({ error: 'This upload has expired. Please upload the file again.' }); return; }
    const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || []);
    const offset = Number(q.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset + chunk.length > f.size || !chunk.length || chunk.length > CHUNK) {
      res.status(400).json({ error: 'Upload went out of sync. Please upload the file again.' });
      return;
    }
    const last = offset + chunk.length === f.size;
    let id = String(q.session || '');
    if (offset === 0) {
      id = await dropbox.sessionStart(last ? Buffer.alloc(0) : chunk);
      if (last) await dropbox.sessionFinish(id, 0, chunk, f.path);
    } else if (!id) {
      res.status(400).json({ error: 'Upload went out of sync. Please upload the file again.' });
      return;
    } else if (last) {
      await dropbox.sessionFinish(id, offset, chunk, f.path);
    } else {
      await dropbox.sessionAppend(id, offset, chunk);
    }
    res.status(200).json({ session: id, received: offset + chunk.length, done: last });
  } catch (err) {
    console.error('producer chunk error:', err);
    res.status(500).json({ error: 'Part of the upload failed. Please try again.' });
  }
}

// Checks uploaded audio against the store's file rules; returns an error or null.
async function audioError(files) {
  const NAMES = { preview: 'preview MP3', mp3: 'untagged MP3', wav: 'WAV' };
  // All audio files are read in parallel (a few small ranges each).
  const results = await Promise.all(Object.entries(FILE_KINDS).map(async ([kind, spec]) => {
    const f = files[kind];
    if (!spec.audio || !f) return null;
    const read = (start, end) => dropbox.readRange(f.path, start, end);
    const info = spec.audio === 'wav' ? await inspect.wavInfo(read, f.size) : await inspect.mp3Info(read, f.size);
    const problems = inspect.audioProblems(spec.audio, info);
    return problems.length ? `The ${NAMES[kind]} ${problems.join(', ')}.` : null;
  }));
  return results.find(Boolean) || null;
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
  const tags = [...new Set(list(body.tags, require('../../data/tags.json').maxTotal || 12, 24).map((t) => t.toLowerCase()))];
  const typeBeat = list(body.typeBeat, 3, 40);
  // Up to 5 co-producers: a name, and optionally their @username here.
  const coProducers = (Array.isArray(body.coProducers) ? body.coProducers : []).map((c) => ({
    name: clean(c && c.name, 60),
    handle: clean(c && c.handle, 31).toLowerCase().replace(/^@/, '') || null,
  })).filter((c) => c.name).slice(0, 5);
  const about = String(body.about || '').trim().slice(0, 600);

  // Tags: at least TAGS.min from the standard list (data/tags.json) so the
  // store filters stay meaningful, plus a few of the producer's own.
  const TAGS = require('../../data/tags.json');
  const standard = new Set(TAGS.groups.flatMap((g) => g.tags));
  const stdCount = tags.filter((t) => standard.has(t)).length;
  if (stdCount < TAGS.min) return { error: `Pick at least ${TAGS.min} tags from the list.` };
  if (tags.length - stdCount > TAGS.maxCustom) return { error: `Up to ${TAGS.maxCustom} tags of your own.` };
  if (!producerName) return { error: 'Add your producer name.' };
  if (coProducers.some((c) => c.handle && !/^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(c.handle))) return { error: 'Co-producer username: letters, numbers, dots, dashes or underscores.' };
  if (coProducers.some((c) => c.name.toLowerCase() === producerName.toLowerCase())) return { error: 'The co-producer can\'t be you. Add the other producer\'s name.' };
  if (!title) return { error: 'Give the beat a title.' };
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 250) return { error: 'BPM must be a whole number between 40 and 250.' };
  if (!key) return { error: 'Choose the key.' };
  if (!genre) return { error: 'Choose a genre.' };
  if (!mood) return { error: 'Choose a mood.' };
  if (body.agree !== true) return { error: 'Please confirm you own the rights to this beat.' };
  if (body.mastered !== true) return { error: 'Please confirm the track is mixed and mastered.' };

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
  return { data: { producerName, coProducers, title, bpm, key, genre, mood, tags, typeBeat, about, prices } };
}

// "A & B", "A, B & C"
const joinNames = (n) => (n.length <= 2 ? n.join(' & ') : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`);

// Co-producer usernames must be real accounts (their storefront lists the track).
async function coProducerError(list) {
  const handles = (list || []).map((c) => c.handle).filter(Boolean);
  if (!handles.length) return '';
  await require('./profile').ensureColumns();
  const rows = await sql`SELECT lower(handle) AS h FROM users WHERE lower(handle) = ANY(${handles})`;
  const found = new Set(rows.map((r) => r.h));
  const missing = handles.filter((h) => !found.has(h));
  return missing.length ? `No Creative Sound account is called @${missing[0]}. Check the username or leave it empty.` : '';
}

// POST the details: the draft becomes "pending" and the owner gets an email.
// Changes to an approved track: details, prices and any re-uploaded files
// wait for the admin; the store keeps the current version until then.
async function submitChanges(session, body, res) {
  await ensureTables();
  const live = await ownApproved(session, Number(body.editId));
  if (!live) { res.status(404).json({ error: 'Track not found.' }); return; }
  // Free download is the producer's call, applied right away (no review).
  await require('./extras').ensureColumns();
  await sql`UPDATE beat_submissions SET free_download = ${body.freeDownload === true} WHERE id = ${live.id}`;
  const revFiles = live.rev_files || {};
  const merged = { ...(live.files || {}), ...revFiles };
  const { data, error } = validateDetails(body, merged);
  if (error) { res.status(400).json({ error }); return; }
  const coError = await coProducerError(data.coProducers);
  if (coError) { res.status(400).json({ error: coError }); return; }
  const sizes = await Promise.all(Object.entries(revFiles).map(async ([kind, f]) => [kind, await dropbox.fileSize(f.path)]));
  for (const [kind, size] of sizes) {
    if (size == null) { res.status(400).json({ error: `The new ${kind} file didn't finish uploading. Please upload it again.` }); return; }
    revFiles[kind] = { ...revFiles[kind], size };
  }
  let badAudio = null;
  try { badAudio = await audioError(revFiles); } catch (err) { console.error('changes audio check skipped:', err); }
  if (badAudio) { res.status(400).json({ error: badAudio }); return; }
  if ('contactInstagram' in body || 'contactEmail' in body) {
    const contactError = await require('./profile').saveContact(session.uid, body.contactInstagram, body.contactEmail);
    if (contactError) { res.status(400).json({ error: contactError }); return; }
  }
  const accent = /^#[0-9a-f]{6}$/i.test(String(body.accent || '')) ? String(body.accent).toLowerCase() : null;
  const changes = { data, files: revFiles, accent };
  await sql`UPDATE beat_submissions SET changes = ${JSON.stringify(changes)}::jsonb, changes_status = 'pending', changes_note = NULL, changes_at = now(), updated_at = now() WHERE id = ${live.id}`;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const site = process.env.SITE_URL || 'https://creativesound.io';
    const { error: mailError } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: 'hello@creativesound.io',
      replyTo: session.email,
      subject: `Changes to review: ${data.title} by ${data.producerName}`,
      html: tpl.renderEmail({
        siteUrl: site,
        preheader: `${data.producerName} edited ${live.title}.`,
        kicker: 'Track changes',
        title: `Changes to ${live.title}`,
        content: [
          tpl.paragraph(`${tpl.esc(data.producerName)} (${tpl.esc(session.email)}) edited an approved track. The store keeps the current version until you approve.`),
          tpl.details([['New files', Object.keys(revFiles).join(', ') || 'none'], ['Submission', `#${live.id}`]]),
          `<div style="margin-top:22px;">${tpl.button(`${site}/admin-review.html`, 'Open Track review')}</div>`,
        ].join(''),
      }),
    });
    if (mailError) console.error('changes email error:', mailError);
  } catch (err) { console.error('changes email error:', err); }
  res.status(200).json({ ok: true, id: live.id, status: 'approved', changesStatus: 'pending', autoPublish: autoPublishes(session) });
}

async function handleSubmit(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerSession(req, res);
    if (!session) return;
    const body = req.body || {};
    if (body.editId) { await submitChanges(session, body, res); return; }
    const sub = await ownDraft(session, Number(body.submissionId));
    if (!sub) { res.status(404).json({ error: 'Upload the cover and preview first.' }); return; }

    const files = sub.files || {};
    const { data, error } = validateDetails(body, files);
    if (error) { res.status(400).json({ error }); return; }

    // Every file the form says it uploaded must really be in Dropbox
    // (checked in parallel: one Dropbox call per file).
    const sizes = await Promise.all(Object.entries(files).map(async ([kind, f]) => [kind, await dropbox.fileSize(f.path)]));
    for (const [kind, size] of sizes) {
      if (size == null) { res.status(400).json({ error: `The ${kind} file didn't finish uploading. Please upload it again.` }); return; }
      files[kind] = { ...files[kind], size };
    }
    // Audio format check. A Dropbox hiccup here must not block the upload:
    // the admin inspects every file again before approving.
    let badAudio = null;
    try { badAudio = await audioError(files); } catch (err) { console.error('producer submit audio check skipped:', err); }
    if (badAudio) { res.status(400).json({ error: badAudio }); return; }

    // Optional contact for private requests (Instagram, email), kept on the profile.
    if ('contactInstagram' in body || 'contactEmail' in body) {
      const contactError = await require('./profile').saveContact(session.uid, body.contactInstagram, body.contactEmail);
      if (contactError) { res.status(400).json({ error: contactError }); return; }
    }
    const coError = await coProducerError(data.coProducers);
    if (coError) { res.status(400).json({ error: coError }); return; }
    await sql`UPDATE users SET producer_name = ${data.producerName} WHERE id = ${session.uid}`;
    await sql`
      UPDATE beat_submissions SET
        status = 'pending', producer_name = ${data.producerName}, co_producers = ${JSON.stringify(data.coProducers)}::jsonb, title = ${data.title}, bpm = ${data.bpm},
        musical_key = ${data.key}, genre = ${data.genre}, mood = ${data.mood},
        tags = ${JSON.stringify(data.tags)}::jsonb, type_beat = ${JSON.stringify(data.typeBeat)}::jsonb,
        about = ${data.about || null}, prices = ${JSON.stringify(data.prices)}::jsonb,
        accent = ${/^#[0-9a-f]{6}$/i.test(String(body.accent || '')) ? String(body.accent).toLowerCase() : null},
        files = ${JSON.stringify(files)}::jsonb, submitted_at = now(), updated_at = now()
      WHERE id = ${sub.id}
    `;

    // The owner's own uploads publish at once: no review notice or receipt.
    if (!autoPublishes(session)) try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const prices = Object.entries(data.prices).map(([t, c]) => `${LICENSES.tiers[t].name} €${(c / 100).toFixed(2)}`).join(' · ');
      const site = process.env.SITE_URL || 'https://creativesound.io';
      const facts = [
        ['Producer', joinNames([data.producerName, ...data.coProducers.map((c) => c.name)])],
        ['Tempo · key', `${data.bpm} BPM · ${data.key}`],
        ['Genre · mood', `${data.genre} · ${data.mood}`],
        ['Licenses', prices],
      ];
      const { error: mailError } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: 'hello@creativesound.io',
        replyTo: session.email,
        subject: `New track to review: ${data.title} by ${data.producerName}`,
        html: tpl.renderEmail({
          siteUrl: site,
          preheader: `${data.producerName} sent ${data.title} for review.`,
          kicker: 'New submission',
          title: data.title,
          content: [
            tpl.paragraph(`${tpl.esc(data.producerName)} (${tpl.esc(session.email)}) sent a track for review.`),
            tpl.details([...facts, ['Files', Object.keys(files).join(', ')], ['Submission', `#${sub.id}`]]),
            `<div style="margin-top:22px;">${tpl.button(`${site}/admin-review.html`, 'Open Track review')}</div>`,
          ].join(''),
        }),
      });
      // Receipt for the producer
      try {
        const { error: receiptError } = await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: session.email,
          replyTo: 'hello@creativesound.io',
          subject: `We received ${data.title}`,
          html: tpl.renderEmail({
            siteUrl: site,
            preheader: `${data.title} is in review. We'll email you the result.`,
            kicker: 'In review',
            title: `We received ${data.title}`,
            content: [
              tpl.paragraph('Thanks for your upload. We check the files, the details and the rights, usually within 48 hours, and email you the result.'),
              tpl.details(facts),
              tpl.steps([
                'We review the files and details.',
                'Approved tracks go live in the store with the Creative Sound voice tag on the preview.',
                'You keep 80% of every sale, paid every Monday.',
              ]),
              `<div style="margin-top:22px;">${tpl.button(`${site}/profile-producer.html`, 'Open your producer area')}</div>`,
            ].join(''),
          }),
        });
        if (receiptError) console.error('producer receipt email error:', receiptError);
      } catch (err) { console.error('producer receipt email error:', err); }
      if (mailError) console.error('producer submit email error:', mailError);
    } catch (err) {
      console.error('producer submit email error:', err);
    }

    try { await require('./extras').ensureColumns(); await sql`UPDATE beat_submissions SET free_download = ${body.freeDownload === true} WHERE id = ${sub.id}`; } catch (err) { console.error('free download flag error:', err); }
    res.status(200).json({ ok: true, id: sub.id, status: 'pending', autoPublish: autoPublishes(session) });
  } catch (err) {
    console.error('producer submit error:', err);
    res.status(500).json({ error: `Could not submit the track (${String((err && err.message) || err).slice(0, 140)}). Please try again.` });
  }
}

// GET the producer's own submissions (drafts left out).
async function handleSubmissions(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerSession(req, res);
    if (!session) return;
    await ensureTables();
    const [user] = await sql`SELECT producer_name, producer_verified, verify_requested_at FROM users WHERE id = ${session.uid}`;
    const rows = await sql`
      SELECT id, status, title, bpm, musical_key, genre, mood, prices, review_note, submitted_at, reviewed_at, changes_status, changes_note, changes_at, sold_at, sold_tier,
        producer_name, co_producers, tags, type_beat, about, files, rev_files
      FROM beat_submissions
      WHERE user_id = ${session.uid} AND status <> 'draft'
      ORDER BY submitted_at DESC NULLS LAST, id DESC
      LIMIT 200
    `;
    res.status(200).json({
      producerName: (user && user.producer_name) || '',
      producerVerified: !!(user && user.producer_verified),
      verifyRequestedAt: (user && user.verify_requested_at) || null,
      uploadsEnabled: dropbox.configured(),
      submissions: rows.map((r) => ({
        id: r.id, status: r.status, title: r.title, bpm: r.bpm, key: r.musical_key, genre: r.genre, mood: r.mood,
        prices: r.prices, reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
        storeUrl: r.status === 'approved' && !r.sold_at ? `track.html?id=${trackId(r)}` : null,
        sold: !!r.sold_at, soldAt: r.sold_at || null, soldTier: r.sold_tier || null,
        cover: r.status === 'approved' && r.files && r.files.artwork ? `/api/beats/media?id=${trackId(r)}&kind=artwork&s=xs` : null,
        changesStatus: r.changes_status || null, changesNote: r.changes_note || null, changesAt: r.changes_at || null,
        // For the edit page
        producerName: r.producer_name, coProducers: r.co_producers || [], tags: r.tags || [], typeBeat: r.type_beat || [], about: r.about || '', freeDownload: !!r.free_download,
        files: Object.fromEntries(Object.entries({ ...(r.files || {}) }).filter(([k]) => k !== 'tagged').map(([k, f]) => [k, { name: f.name, size: f.size }])),
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

// GET ?status=pending|approved|rejected -> submissions with read links.
// Cover colour for tracks that don't have one (uploaded before the upload
// page picked it): read the cover from Dropbox and compute it here.
async function ensureAccent(row) {
  const f = row && row.files && row.files.artwork;
  if (!row || row.accent || !f || !dropbox.configured() || (f.size && f.size > 12 * 1024 * 1024)) return row && row.accent;
  try {
    const buf = await dropbox.readRange(f.path, 0, (f.size || 12 * 1024 * 1024) - 1);
    const hex = require('./accent').accentFromImage(buf);
    if (hex) await sql`UPDATE beat_submissions SET accent = ${hex} WHERE id = ${row.id}`;
    return hex;
  } catch (err) {
    console.error('cover accent failed for', row.id, err.message);
    return null;
  }
}

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
      ? await sql`SELECT s.*, u.producer_verified, u.verify_requested_at FROM beat_submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = 'pending' OR (s.status = 'approved' AND s.changes_status = 'pending') ORDER BY COALESCE(s.changes_at, s.submitted_at) ASC LIMIT 100`
      : await sql`SELECT s.*, u.producer_verified, u.verify_requested_at FROM beat_submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.status = ${status} ORDER BY s.reviewed_at DESC NULLS LAST LIMIT 100`;
    // Approved tracks still missing a cover colour get one (a few per call, in parallel).
    await Promise.all(rows.filter((r) => r.status === 'approved' && !r.accent && r.files && r.files.artwork).slice(0, 3)
      .map(async (r) => { r.accent = await ensureAccent(r); }));
    const out = [];
    for (const r of rows) {
      // Links are made only when the browser opens them (GET /api/review/file),
      // so the list loads without one Dropbox call per file.
      const links = {};
      const fileUrl = (kind, rev) => `/api/review/file?id=${r.id}&kind=${kind}${rev ? '&rev=1' : ''}`;
      for (const kind of Object.keys(r.files || {})) links[kind] = fileUrl(kind);
      if (r.changes_status === 'pending') {
        for (const kind of Object.keys((r.changes && r.changes.files) || {})) links[`rev:${kind}`] = fileUrl(kind, true);
      }
      out.push({
        id: r.id, status: r.status, email: r.email, producerName: joinNames([r.producer_name, ...(r.co_producers || []).map((c) => c.name)]), title: r.title, bpm: r.bpm,
        key: r.musical_key, genre: r.genre, mood: r.mood, tags: r.tags, typeBeat: r.type_beat, about: r.about,
        prices: r.prices, files: r.files, links, reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
        userId: r.user_id, producerVerified: !!r.producer_verified,
        storeUrl: r.status === 'approved' ? `track.html?id=${trackId(r)}` : null, verifyRequested: !!r.verify_requested_at && !r.producer_verified,
        isChange: r.status === 'approved' && r.changes_status === 'pending', changes: r.changes_status === 'pending' ? r.changes : null,
      });
    }
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM beat_submissions WHERE status = 'pending' OR (status = 'approved' AND changes_status = 'pending')`;
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
    if (body.decision === 'approve-changes' || body.decision === 'reject-changes') {
      const [cur] = await sql`SELECT * FROM beat_submissions WHERE id = ${Number(body.id)} AND status = 'approved' AND changes_status = 'pending'`;
      if (!cur) { res.status(404).json({ error: 'No pending changes for this track.' }); return; }
      const ok = body.decision === 'approve-changes';
      const cnote = String(body.note || '').trim().slice(0, 1000);
      if (!ok && !cnote) { res.status(400).json({ error: 'Tell the producer what to fix.' }); return; }
      if (ok) {
        const d = cur.changes.data;
        const files = { ...(cur.files || {}), ...(cur.changes.files || {}) };
        // A new preview needs its voice-tagged copy (made by the admin page).
        if (cur.changes.files && cur.changes.files.preview) {
          const tagPath = `/submissions/${cur.id}/rev/preview-tagged.mp3`;
          let size = 0;
          try { size = await dropbox.fileSize(tagPath); } catch (err) { size = 0; }
          if (!size) { res.status(400).json({ error: 'The voice-tagged preview is missing. Try Approve again.' }); return; }
          files.tagged = { path: tagPath, name: 'preview-tagged.mp3', size };
        }
        let accent = cur.accent;
        if (cur.changes.files && cur.changes.files.artwork) accent = cur.changes.accent || null;
        await sql`
          UPDATE beat_submissions SET
            producer_name = ${d.producerName}, co_producers = ${JSON.stringify(d.coProducers || [])}::jsonb, title = ${d.title}, bpm = ${d.bpm}, musical_key = ${d.key}, genre = ${d.genre}, mood = ${d.mood},
            tags = ${JSON.stringify(d.tags)}::jsonb, type_beat = ${JSON.stringify(d.typeBeat)}::jsonb, about = ${d.about || null},
            prices = ${JSON.stringify(d.prices)}::jsonb, files = ${JSON.stringify(files)}::jsonb, accent = ${accent},
            changes = NULL, changes_status = NULL, changes_note = ${cnote || null}, rev_files = '{}'::jsonb, updated_at = now()
          WHERE id = ${cur.id}`;
        if (!accent) await ensureAccent({ ...cur, files, accent: null });
      } else {
        await sql`UPDATE beat_submissions SET changes_status = 'rejected', changes_note = ${cnote}, updated_at = now() WHERE id = ${cur.id}`;
      }
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const site = process.env.SITE_URL || 'https://creativesound.io';
        const title = ok ? cur.changes.data.title : cur.title;
        const { error: mailError } = await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: cur.email,
          replyTo: 'hello@creativesound.io',
          subject: ok ? `Changes approved: ${title}` : `Changes not approved: ${title}`,
          html: tpl.renderEmail({
            siteUrl: site,
            preheader: ok ? 'Your changes are live in the store.' : 'Your track stays as it was. See the note.',
            kicker: ok ? 'Changes approved' : 'Changes not approved',
            title: ok ? `Your changes to ${title} are live` : `Your changes to ${title} need work`,
            content: [
              tpl.paragraph(ok ? 'The store now shows the updated version of your track.' : 'The store keeps the current version. Here is what to fix before sending the changes again.'),
              cnote ? tpl.note(cnote, { tone: ok ? 'ok' : 'bad' }) : '',
              `<div style="margin-top:22px;">${tpl.button(`${site}/profile-producer.html`, 'Open your producer area')}</div>`,
            ].join(''),
          }),
        });
        if (mailError) console.error('changes decision email error:', mailError);
      } catch (err) { console.error('changes decision email error:', err); }
      res.status(200).json({ ok: true, id: cur.id });
      return;
    }
    if (body.decision === 'retag') {
      // A new voice-tagged preview for a track already on sale: it stays in the store, the new
      // file (uploaded by the admin page to the same Dropbox path) replaces the old one. The
      // version tag changes so browsers and the CDN fetch it, and the stored waveform is dropped
      // so the next listener's browser measures the new file.
      const [cur] = await sql`SELECT files FROM beat_submissions WHERE id = ${id} AND status = 'approved'`;
      if (!cur) { res.status(404).json({ error: 'Track not found, or not on sale.' }); return; }
      const tagPath = `/submissions/${id}/preview-tagged.mp3`;
      let size = 0;
      try { size = await dropbox.fileSize(tagPath); } catch (err) { size = 0; }
      if (!size) { res.status(400).json({ error: 'The new voice-tagged preview is missing. Try again.' }); return; }
      const files = { ...(cur.files || {}), tagged: { path: tagPath, name: 'preview-tagged.mp3', size } };
      await sql`UPDATE beat_submissions SET files = ${JSON.stringify(files)}::jsonb, changes_at = now(), updated_at = now() WHERE id = ${id}`;
      try { await sql`UPDATE beat_submissions SET peaks = NULL WHERE id = ${id}`; } catch (err) { /* no waveform column yet */ }
      res.status(200).json({ ok: true, id });
      return;
    }
    if (body.decision === 'reopen') {
      const [back] = await sql`UPDATE beat_submissions SET status = 'pending', reviewed_at = NULL, updated_at = now() WHERE id = ${Number(body.id)} AND status IN ('approved', 'rejected') RETURNING id`;
      if (!back) { res.status(404).json({ error: 'Submission not found.' }); return; }
      res.status(200).json({ ok: true, id: back.id, status: 'pending' });
      return;
    }
    const decision = body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : null;
    const note = String(body.note || '').trim().slice(0, 1000);
    if (!decision) { res.status(400).json({ error: 'Choose approve or reject.' }); return; }
    if (decision === 'rejected' && !note) { res.status(400).json({ error: 'Tell the producer what to fix.' }); return; }
    // Approving needs the voice-tagged preview (made in the admin's browser,
    // see handleAdminTag): only that version is ever public.
    if (decision === 'approved') {
      const [cur] = await sql`SELECT files FROM beat_submissions WHERE id = ${id}`;
      if (!cur) { res.status(404).json({ error: 'Submission not found.' }); return; }
      const tagPath = `/submissions/${id}/preview-tagged.mp3`;
      let size = 0;
      try { size = await dropbox.fileSize(tagPath); } catch (err) { size = 0; }
      if (!size) { res.status(400).json({ error: 'The voice-tagged preview is missing. Try Approve again.' }); return; }
      const files = { ...(cur.files || {}), tagged: { path: tagPath, name: 'preview-tagged.mp3', size } };
      await sql`UPDATE beat_submissions SET files = ${JSON.stringify(files)}::jsonb WHERE id = ${id}`;
    }
    const [sub] = await sql`
      UPDATE beat_submissions SET status = ${decision}, review_note = ${note || null}, reviewed_at = now(), updated_at = now()
      WHERE id = ${id} AND status <> 'draft' RETURNING *
    `;
    if (!sub) { res.status(404).json({ error: 'Submission not found.' }); return; }
    if (decision === 'approved') await ensureAccent(sub);

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const site = process.env.SITE_URL || 'https://creativesound.io';
      const ok = decision === 'approved';
      const trackUrl = `${site}/track.html?id=${encodeURIComponent(trackId(sub))}`;
      const { error: mailError } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: sub.email,
        replyTo: 'hello@creativesound.io',
        subject: ok ? `Approved: ${sub.title} is live` : `Changes needed: ${sub.title}`,
        html: tpl.renderEmail({
          siteUrl: site,
          preheader: ok ? `${sub.title} passed review and is now on sale.` : `${sub.title} needs a few changes before it goes live.`,
          kicker: ok ? 'Approved' : 'Needs changes',
          title: ok ? `${sub.title} is live` : `${sub.title} needs a few changes`,
          content: [
            tpl.paragraph(ok
              ? 'Your track passed review and is now on sale in the Creative Sound store, with the voice tag on the preview. You keep 80% of every sale.'
              : "Your track didn't pass review yet. Here is what to fix, then upload it again from your producer area."),
            note ? tpl.note(note, { tone: ok ? 'ok' : 'bad' }) : '',
            `<div style="margin-top:22px;">${ok ? tpl.button(trackUrl, 'See it in the store') : ''}${tpl.button(`${site}/profile-producer.html`, 'Open your producer area', { primary: !ok })}</div>`,
          ].join(''),
        }),
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

// GET ?id=&kind= -> what's inside one uploaded file: a WAV's format, or
// the list of files in a ZIP. Reads only the bytes it needs.
async function handleAdminInspect(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (!isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    const [sub] = await sql`SELECT files, changes FROM beat_submissions WHERE id = ${Number(req.query.id)}`;
    const kind = String(req.query.kind || '');
    // rev=1: the new file of pending changes to an approved track.
    const f = req.query.rev === '1' ? sub && sub.changes && sub.changes.files && sub.changes.files[kind] : sub && sub.files && sub.files[kind];
    if (!f) { res.status(404).json({ error: 'File not found.' }); return; }
    const size = await dropbox.fileSize(f.path);
    if (size == null) { res.status(404).json({ error: 'The file is no longer in Dropbox.' }); return; }
    const read = (start, end) => dropbox.readRange(f.path, start, end);
    const type = ext(f.name);
    let info;
    if (type === 'wav' || type === 'mp3') {
      const data = type === 'wav' ? await inspect.wavInfo(read, size) : await inspect.mp3Info(read, size);
      info = { kind: type, ...data, problems: inspect.audioProblems(type, data) };
    } else if (type === 'zip') {
      info = { kind: 'zip', ...(await inspect.zipInfo(read, size)) };
    } else {
      info = { kind: 'other', ok: true, note: 'This file type can only be checked after downloading.' };
    }
    res.status(200).json({ size, ...info });
  } catch (err) {
    console.error('admin inspect error:', err);
    res.status(500).json({ error: 'Could not read the file.' });
  }
}

// GET ?id=&kind=[&rev=1] -> 302 to a short-lived Dropbox link for one
// uploaded file (cover, audio, archive). Admin only; made on demand.
async function handleAdminFile(req, res) {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (!isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    const [sub] = await sql`SELECT files, changes FROM beat_submissions WHERE id = ${Number(req.query.id)}`;
    const kind = String(req.query.kind || '');
    const f = req.query.rev === '1' ? sub && sub.changes && sub.changes.files && sub.changes.files[kind] : sub && sub.files && sub.files[kind];
    if (!f) { res.status(404).json({ error: 'File not found.' }); return; }
    const link = await dropbox.readLink(f.path);
    // Dropbox links last 4 hours; the browser may reuse this redirect for 1.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.statusCode = 302;
    res.setHeader('Location', link);
    res.end();
  } catch (err) {
    console.error('admin file error:', err);
    res.status(502).json({ error: 'Could not open the file in Dropbox.' });
  }
}

// POST { userId, verified } -> turns the verified badge on or off for a
// producer. Owner only.
async function handleAdminVerify(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (!isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    const userId = Number(req.body && req.body.userId);
    const verified = !!(req.body && req.body.verified);
    const [row] = await sql`UPDATE users SET producer_verified = ${verified}, verify_requested_at = NULL WHERE id = ${userId} RETURNING id, producer_verified`;
    if (!row) { res.status(404).json({ error: 'Producer not found.' }); return; }
    res.status(200).json({ userId: row.id, verified: row.producer_verified });
  } catch (err) {
    console.error('admin verify error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

// POST: a producer asks for the verified badge. The owner gets an email and
// the request shows on the review page. Once a day at most.
async function handleVerifyRequest(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerSession(req, res);
    if (!session) return;
    const [user] = await sql`SELECT producer_name, producer_verified, verify_requested_at FROM users WHERE id = ${session.uid}`;
    if (user && user.producer_verified) { res.status(200).json({ verified: true }); return; }
    if (user && user.verify_requested_at && Date.now() - new Date(user.verify_requested_at).getTime() < 864e5) {
      res.status(200).json({ requestedAt: user.verify_requested_at });
      return;
    }
    const [row] = await sql`UPDATE users SET verify_requested_at = now() WHERE id = ${session.uid} RETURNING verify_requested_at`;
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM beat_submissions WHERE user_id = ${session.uid} AND status <> 'draft'`;
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const site = process.env.SITE_URL || 'https://creativesound.io';
      const name = (user && user.producer_name) || 'No producer name yet';
      const { error: mailError } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: 'hello@creativesound.io',
        replyTo: session.email,
        subject: `Verification request: ${(user && user.producer_name) || session.email}`,
        html: tpl.renderEmail({
          siteUrl: site,
          preheader: `${name} asked for the verified badge.`,
          kicker: 'Verification request',
          title: `${name} wants the verified badge`,
          content: [
            tpl.details([['Producer', name], ['Email', session.email], ['Tracks submitted', String(n)]]),
            `<div style="margin-top:22px;">${tpl.button(`${site}/admin-review.html#producers`, 'Open the producers list')}</div>`,
          ].join(''),
        }),
      });
      if (mailError) console.error('verify request email error:', mailError);
    } catch (err) {
      console.error('verify request email error:', err);
    }
    res.status(200).json({ requestedAt: row.verify_requested_at });
  } catch (err) {
    console.error('verify request error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
}

// GET: every producer account with their submission counts (owner only).
async function handleAdminProducers(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (!isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    const rows = await sql`
      SELECT u.id, u.email, u.producer_name, u.producer_verified, u.verify_requested_at, u.role_set_at,
        count(s.id) FILTER (WHERE s.status <> 'draft')::int AS total,
        count(s.id) FILTER (WHERE s.status = 'pending')::int AS pending,
        count(s.id) FILTER (WHERE s.status = 'approved')::int AS approved,
        count(s.id) FILTER (WHERE s.status = 'rejected')::int AS rejected,
        max(s.submitted_at) AS last_submitted
      FROM users u LEFT JOIN beat_submissions s ON s.user_id = u.id
      WHERE u.role = 'producer'
      GROUP BY u.id
      ORDER BY (u.verify_requested_at IS NOT NULL AND NOT u.producer_verified) DESC, max(s.submitted_at) DESC NULLS LAST, u.id DESC
      LIMIT 500
    `;
    res.status(200).json({
      producers: rows.map((r) => ({
        userId: r.id, email: r.email, name: r.producer_name || '', verified: !!r.producer_verified,
        verifyRequested: !!r.verify_requested_at && !r.producer_verified, since: r.role_set_at,
        total: r.total, pending: r.pending, approved: r.approved, rejected: r.rejected, lastSubmitted: r.last_submitted,
      })),
    });
  } catch (err) {
    console.error('admin producers error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

// Voice tag: the admin page downloads the producer preview, mixes the
// "Creative Sound" tag in and uploads the result here, before approving.
//   POST /api/review/tag { id } -> { sourceUrl, uploadUrl }
async function handleAdminTag(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const session = getSession(req);
  if (!session || !isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    const id = Number((req.body || {}).id);
    const forChanges = !!(req.body || {}).changes;
    const [sub] = await sql`SELECT s.files, s.changes, u.producer_tag_path FROM beat_submissions s LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ${id}`;
    const preview = forChanges ? (sub && sub.changes && sub.changes.files && sub.changes.files.preview) : (sub && sub.files && sub.files.preview);
    if (!preview) { res.status(404).json({ error: 'This track has no preview.' }); return; }
    res.status(200).json({
      sourceUrl: await dropbox.readLink(preview.path),
      uploadUrl: await dropbox.uploadLink(forChanges ? `/submissions/${id}/rev/preview-tagged.mp3` : `/submissions/${id}/preview-tagged.mp3`),
      // The producer's own tag, mixed in between the Creative Sound tags.
      producerTagUrl: sub.producer_tag_path ? await dropbox.readLink(String(sub.producer_tag_path).split('?v=')[0]).catch(() => null) : null,
    });
  } catch (err) {
    console.error('review tag error:', err);
    res.status(500).json({ error: 'Could not prepare the voice tag.' });
  }
}

module.exports = {
  FILE_KINDS, TIER_NEEDS, validateDetails, ensureTables, isAdmin,
  handleFile, handleChunk, handleSubmit, handleSubmissions, handleAdminList, handleAdminReview, handleAdminInspect, handleAdminVerify, handleVerifyRequest, handleAdminProducers, handleAdminTag, handleAdminFile,
};
