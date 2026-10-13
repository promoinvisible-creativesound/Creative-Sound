// Beat store: checkout, purchase recording, delivery files and license PDFs.
//
// - The catalogue and prices come from data/beats.json and the tiers from
//   data/beat-licenses.json, read here on the server: the browser only sends
//   { id, tier } pairs, never a price.
// - Delivery links (Dropbox) are NOT in the repo, which is public. They live
//   in the beat_files table: one row per beat and file type (mp3, wav, stems,
//   flp). Add them with SQL when a beat goes live (see the README comment at
//   the bottom of this file).
// - Checkout is reached through /api/beats/checkout, rewritten in vercel.json
//   to /api/tickets?action=beats-checkout: the Hobby plan caps a deployment
//   at 12 serverless functions.
const Stripe = require('stripe');
const { sql } = require('./db');
const { getSession } = require('./auth');
const { previewAllowed } = require('./account');
const { getBeat, liveBeats, producerFiles } = require('./catalogue');
const CATALOGUE = require('../../data/beats.json');
const LICENSES = require('../../data/beat-licenses.json');

const MAX_ITEMS = 15; // keeps the Stripe metadata under its 500-char limit
const LICENSOR = 'Emanuele Paparella p/k/a Invisible, trading as Creative Sound (P.IVA 17024071007)';

const isProduction = () => process.env.VERCEL_ENV === 'production';

function priceOf(beat, tier) {
  const p = beat && beat.prices && beat.prices[tier];
  return Number.isInteger(p) && p > 0 ? p : null;
}

// Validates the cart sent by the browser against the live catalogue
// (data/beats.json plus approved producer uploads).
async function validateItems(raw) {
  if (!Array.isArray(raw) || !raw.length) return { error: 'Your cart is empty.' };
  if (raw.length > MAX_ITEMS) return { error: `Up to ${MAX_ITEMS} beats per order.` };
  const seen = new Set();
  const items = [];
  for (const it of raw) {
    const id = String((it && it.id) || '');
    const tier = String((it && it.tier) || '');
    const beat = await getBeat(id);
    if (!beat || beat.status === 'hidden') return { error: 'One of the beats in your cart is no longer available.' };
    if (beat.demo && isProduction()) return { error: 'One of the beats in your cart is not for sale yet.' };
    if (!LICENSES.tiers[tier] || !priceOf(beat, tier)) return { error: `The selected license is not available for "${beat.title}".` };
    if (seen.has(id)) return { error: `"${beat.title}" is in your cart twice.` };
    seen.add(id);
    items.push({ beat, tier, price: priceOf(beat, tier) });
  }
  return { items };
}

async function handleCheckout(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Please sign in to check out.' });
    return;
  }
  if (!previewAllowed(session)) {
    res.status(403).json({ error: 'The track store is not open yet.' });
    return;
  }
  const { items, error } = await validateItems(req.body && req.body.items);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const siteUrl = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  try {
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const checkout = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: session.email,
      client_reference_id: 'beats',
      line_items: items.map(({ beat, tier, price }) => ({
        quantity: 1,
        price_data: {
          currency: CATALOGUE.currency || 'eur',
          unit_amount: price,
          product_data: {
            name: `${beat.title} — ${LICENSES.tiers[tier].name}`,
            description: `prod. ${beat.producer} · Non-exclusive license · ${LICENSES.tiers[tier].files.map((f) => LICENSES.fileLabels[f]).join(' + ')}`,
            metadata: { beat_id: beat.id, tier },
          },
        },
      })),
      metadata: {
        kind: 'beats',
        items: items.map(({ beat, tier }) => `${beat.id}:${tier}`).join(','),
      },
      success_url: `${siteUrl}/beats-success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/beats.html?cart=1`,
    });
    res.status(200).json({ url: checkout.url });
  } catch (err) {
    console.error('beats checkout error:', err);
    res.status(500).json({ error: 'Checkout is not available right now. Please try again.' });
  }
}

/* ------------------------------- Purchases -------------------------------- */
let tablesReady = null;
function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS beat_purchases (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          beat_id TEXT NOT NULL,
          tier TEXT NOT NULL,
          license_id TEXT NOT NULL,
          price_cents INTEGER,
          currency TEXT,
          buyer_name TEXT,
          stripe_session_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_beat_purchases_session_beat ON beat_purchases (stripe_session_id, beat_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_beat_purchases_email ON beat_purchases (email)`;
      await sql`
        CREATE TABLE IF NOT EXISTS beat_saves (
          email TEXT NOT NULL,
          beat_id TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (email, beat_id)
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS beat_files (
          beat_id TEXT NOT NULL,
          file_type TEXT NOT NULL,
          url TEXT NOT NULL,
          PRIMARY KEY (beat_id, file_type)
        )
      `;
    })().catch((err) => {
      tablesReady = null;
      throw err;
    });
  }
  return tablesReady;
}

// Dropbox share links open a preview page with dl=0; dl=1 starts the download.
const directUrl = (url) => String(url).trim().replace(/([?&])dl=0(?=&|$)/, '$1dl=1');

// Delivery links for one bought beat. Producer uploads get signed links to
// their Dropbox files (catalogue.js); catalogue beats use the beat_files table.
async function filesFor(beat, tier, email) {
  if (beat.source === 'producer') {
    const siteUrl = (process.env.SITE_URL || 'https://creativesound.io').replace(/\/$/, '');
    return producerFiles(beat, tier, email, siteUrl);
  }
  const beatId = beat.id;
  const wanted = LICENSES.tiers[tier].files;
  const rows = await sql`SELECT file_type, url FROM beat_files WHERE beat_id = ${beatId}`;
  const map = new Map(rows.map((r) => [r.file_type, directUrl(r.url)]));
  return wanted.map((type) => ({ type, label: LICENSES.fileLabels[type], url: map.get(type) || null }));
}

async function parseItems(metadataItems) {
  const out = [];
  for (const [id, tier] of String(metadataItems || '').split(',').map((x) => x.split(':'))) {
    if (!LICENSES.tiers[tier]) continue;
    const beat = await getBeat(id);
    if (beat) out.push({ beat, tier });
  }
  return out;
}

const licenseIdFor = (sessionId, index) => `CS-B-${String(sessionId).slice(-10).toUpperCase()}-${index + 1}`;

/* ------------------------------ License PDF ------------------------------- */
// One PDF per beat: who licenses what to whom, which files, the usage terms
// of the tier and the standard clauses. The clause text is a starting draft
// and should be reviewed before real sales.
async function licensePdf({ licenseId, beat, tier, buyerName, buyerEmail, date, price, currency }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const t = LICENSES.tiers[tier];
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]); // A4
  const margin = 56;
  const width = 595 - margin * 2;
  let y = 842 - margin;
  const accent = rgb(0.91, 0.53, 0.17);
  const text = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);

  const wrap = (str, f, size) => {
    const words = String(str).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = w; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const write = (str, { f = font, size = 10, color = text, gap = 4 } = {}) => {
    for (const line of wrap(str, f, size)) {
      if (y < margin + size) { page = doc.addPage([595, 842]); y = 842 - margin; }
      page.drawText(line, { x: margin, y, size, font: f, color });
      y -= size + gap;
    }
  };
  const space = (h) => { y -= h; };

  write('CREATIVE SOUND', { f: bold, size: 9, color: accent, gap: 14 });
  write(`${t.name} License Agreement`, { f: bold, size: 18, gap: 8 });
  write(`License ID ${licenseId} · ${date}`, { size: 9, color: muted, gap: 14 });

  const rows = [
    ['Licensor', LICENSOR],
    ['Producer', `${beat.producer} (credit: "prod. by ${beat.producer}")`],
    ['Licensee', `${buyerName ? `${buyerName}, ` : ''}${buyerEmail}`],
    ['Beat', `"${beat.title}" · ${beat.bpm} BPM · ${beat.key}`],
    ['License', `${t.name} (non-exclusive)${t.unlimited ? ' · Unlimited' : ''}`],
    ['Files', t.files.map((f) => LICENSES.fileLabels[f]).join(', ')],
    ['Price paid', `${(price / 100).toFixed(2)} ${String(currency || 'eur').toUpperCase()}`],
  ];
  for (const [k, v] of rows) {
    write(k.toUpperCase(), { f: bold, size: 8, color: muted, gap: 2 });
    write(v, { size: 10.5, gap: 8 });
  }
  space(6);
  write('USAGE RIGHTS', { f: bold, size: 9, color: accent, gap: 6 });
  [
    `Audio streams: ${t.terms.streams}`,
    `Sales and downloads: ${t.terms.sales}`,
    `Music videos: ${t.terms.videos}`,
    `Live performances: ${t.terms.performances}`,
    `Radio broadcasting: ${t.terms.radio}`,
  ].forEach((l) => write(`•  ${l}`, { gap: 5 }));
  space(8);
  write('TERMS', { f: bold, size: 9, color: accent, gap: 6 });
  [
    '1. Grant. The Licensor grants the Licensee a non-exclusive, non-transferable license to use the Beat to create one new musical work (the "Song") and to exploit the Song within the usage rights above.',
    '2. Ownership. The Producer and Licensor keep all ownership of the Beat and its copyright. The Licensee owns the lyrics and vocal recordings they add. Other licenses for the same Beat may be sold to other artists.',
    '3. Credit. The Licensee must credit the Producer as "prod. by ' + beat.producer + '" wherever credits are shown (streaming metadata, video descriptions, physical releases).',
    '4. Restrictions. The Licensee may not resell, give away or re-license the Beat or its files on their own, register the Beat alone with content-ID systems, or claim authorship of the instrumental.',
    '5. Publishing. Songwriting and publishing splits for the Song are to be agreed in writing between the Licensee and the Producer; failing an agreement, the Producer is entitled to 50% of the writer\'s share of the composition.',
    '6. Term. This license is perpetual for the Song created under it, within the usage rights above.',
    '7. Law. This agreement is governed by Italian law.',
  ].forEach((p) => write(p, { gap: 6 }));
  space(10);
  write('This document was issued automatically at purchase and is valid without signature.', { size: 8.5, color: muted });
  return Buffer.from(await doc.save());
}

/* ------------------------------ Webhook part ------------------------------ */
// Called by api/webhook.js for checkout sessions with metadata.kind === 'beats'.
// Throws when something must be retried (DB down, delivery files missing),
// so Stripe retries the webhook; the inserts are idempotent per session.
async function handleBeatPurchase({ session, email, resend, renderEmail, button, paragraph, steps, accountLine }) {
  const items = await parseItems(session.metadata && session.metadata.items);
  if (!items.length) throw new Error(`Beat checkout ${session.id} has no readable items.`);
  const buyerName = (session.customer_details && session.customer_details.name) || '';
  const currency = session.currency || CATALOGUE.currency || 'eur';
  await ensureTables();

  const delivered = [];
  for (let i = 0; i < items.length; i++) {
    const { beat, tier } = items[i];
    const licenseId = licenseIdFor(session.id, i);
    await sql`
      INSERT INTO beat_purchases (email, beat_id, tier, license_id, price_cents, currency, buyer_name, stripe_session_id)
      VALUES (${email}, ${beat.id}, ${tier}, ${licenseId}, ${priceOf(beat, tier)}, ${currency}, ${buyerName || null}, ${session.id})
      ON CONFLICT (stripe_session_id, beat_id) DO NOTHING
    `;
    delivered.push({ beat, tier, licenseId, files: await filesFor(beat, tier, email) });
  }

  const missing = delivered.flatMap((d) => d.files.filter((f) => !f.url).map((f) => `${d.beat.id}:${f.type}`));
  if (missing.length) {
    // Misconfiguration: alert the studio and let Stripe retry once the
    // beat_files rows exist. The purchase rows are already saved.
    try {
      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: 'hello@creativesound.io',
        subject: 'Beat sale: delivery files missing',
        html: `<p>Order ${session.id} from ${email} is paid but these files have no link in beat_files:</p><p>${missing.join('<br>')}</p><p>Add them and Stripe will retry the delivery automatically.</p>`,
      });
    } catch (err) { console.error('beat missing-files alert failed:', err); }
    throw new Error(`Missing beat files for ${session.id}: ${missing.join(', ')}`);
  }

  const siteUrl = process.env.SITE_URL || '';
  const date = new Date((session.created || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  const attachments = [];
  for (const d of delivered) {
    try {
      const pdf = await licensePdf({ licenseId: d.licenseId, beat: d.beat, tier: d.tier, buyerName, buyerEmail: email, date, price: priceOf(d.beat, d.tier), currency });
      attachments.push({ filename: `License-${d.beat.title.replace(/[^\w-]+/g, '-')}-${d.licenseId}.pdf`, content: pdf });
    } catch (err) {
      console.error('license pdf failed:', d.licenseId, err);
    }
  }

  const blocks = delivered.map((d) => [
    `<div style="margin-top:22px;font-weight:700;">${d.beat.title} — ${LICENSES.tiers[d.tier].name}</div>`,
    '<div style="margin-top:10px;">',
    ...d.files.map((f) => button(f.url, f.label, { primary: f.type === 'wav' || (f.type === 'mp3' && d.tier === 'mp3') })),
    '</div>',
  ].join(''));
  const html = renderEmail({
    siteUrl,
    preheader: 'Your beats and license PDFs are ready.',
    kicker: 'Order confirmed',
    title: delivered.length === 1 ? delivered[0].beat.title : `${delivered.length} beats`,
    content: [
      paragraph('Thanks for your order. Your files are below and your license agreement for each beat is attached as a PDF.'),
      ...blocks,
      steps([
        'Download your files with the buttons above (the stems and project files are zip archives).',
        'Keep the license PDF: it lists exactly what you can do with each beat.',
        'Credit the producer as written in the license wherever your song is released.',
      ]),
      paragraph('You can download these files again any time from your account.'),
      accountLine(siteUrl),
    ].join(''),
  });

  try {
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: delivered.length === 1 ? `Your beat: ${delivered[0].beat.title}` : `Your beats (${delivered.length})`,
      html,
      attachments,
    });
    if (error) console.error('Resend rejected the beats email:', error);
  } catch (err) {
    // Purchases are saved and the downloads show up in the account already.
    console.error('Failed to send beats email:', err);
  }
}

/* ------------------------------- Account view ------------------------------ */
async function beatsForAccount(email) {
  await ensureTables();
  const rows = await sql`
    SELECT beat_id, tier, license_id, created_at FROM beat_purchases
    WHERE email = ${email}
    ORDER BY created_at DESC
  `;
  const out = [];
  for (const r of rows) {
    const beat = await getBeat(r.beat_id);
    if (!beat || !LICENSES.tiers[r.tier]) continue;
    out.push({
      beat_id: r.beat_id,
      title: beat.title,
      producer: beat.producer,
      tier: r.tier,
      tier_name: LICENSES.tiers[r.tier].name,
      license_id: r.license_id,
      created_at: r.created_at,
      files: (await filesFor(beat, r.tier, email)).filter((f) => f.url),
    });
  }
  return out;
}

/* ------------------------------- Saved beats ------------------------------- */
// The heart on beat cards. Signed-in visitors keep their saves on the
// account (any device); the browser keeps a copy for signed-out visitors.
// Reached through /api/beats/saved -> /api/tickets?action=beats-saved.
//   GET                          -> { ids: [...] } newest first
//   POST { beatId, saved }       -> save / unsave one beat
//   POST { merge: [ids] }        -> add browser saves after signing in
async function savedForAccount(email) {
  await ensureTables();
  const rows = await sql`SELECT beat_id FROM beat_saves WHERE email = ${email} ORDER BY created_at DESC`;
  const known = new Set((await liveBeats()).map((b) => b.id));
  return rows.map((r) => r.beat_id).filter((id) => known.has(id));
}

async function handleSaved(req, res) {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  if (!previewAllowed(session)) {
    res.status(403).json({ error: 'The track store is not open yet.' });
    return;
  }
  try {
    if (req.method === 'GET') {
      res.status(200).json({ ids: await savedForAccount(session.email) });
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    await ensureTables();
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const known = new Set((await liveBeats()).map((b) => b.id));
    if (Array.isArray(body.merge)) {
      const ids = [...new Set(body.merge.map(String))].filter((id) => known.has(id)).slice(0, 200);
      for (const id of ids) {
        await sql`INSERT INTO beat_saves (email, beat_id) VALUES (${session.email}, ${id}) ON CONFLICT DO NOTHING`;
      }
    } else {
      const id = String(body.beatId || '');
      if (!known.has(id)) {
        res.status(400).json({ error: 'Unknown beat.' });
        return;
      }
      if (body.saved) await sql`INSERT INTO beat_saves (email, beat_id) VALUES (${session.email}, ${id}) ON CONFLICT DO NOTHING`;
      else await sql`DELETE FROM beat_saves WHERE email = ${session.email} AND beat_id = ${id}`;
    }
    res.status(200).json({ ids: await savedForAccount(session.email) });
  } catch (err) {
    console.error('beats saved error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
}

module.exports = { handleCheckout, handleBeatPurchase, beatsForAccount, savedForAccount, handleSaved, validateItems, licensePdf, ensureTables };

/* README — making a beat buyable
   1. Add it to data/beats.json (id, title, producer, bpm, key, genre, mood,
      tags, cover, preview = tagged MP3, prices in cents per tier).
   2. Upload the untagged files to Dropbox and add one row per file type:
        INSERT INTO beat_files (beat_id, file_type, url) VALUES
          ('my-beat', 'mp3',   'https://www.dropbox.com/...'),
          ('my-beat', 'wav',   'https://www.dropbox.com/...'),
          ('my-beat', 'stems', 'https://www.dropbox.com/...'),
          ('my-beat', 'flp',   'https://www.dropbox.com/...');
      Only the types its tiers need: mp3 for MP3, + wav for WAV, + stems for
      Trackout, + flp for Project. */
