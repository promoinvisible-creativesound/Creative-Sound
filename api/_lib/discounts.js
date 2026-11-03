// Store-wide discounts set by the Creative Sound team:
//  - a general sale for every track for a few days (site_sale), applied in the cart;
//  - discount codes the buyer types in the cart (discount_codes).
// They stack with the cart bundle discount (see _lib/bundle.js) and, like it, lower the
// price actually paid: producers earn their 80% of that price.
const { sql } = require('./db');
const { getSession } = require('./auth');
const { isAdmin } = require('./account');

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS discount_codes (code TEXT PRIMARY KEY, pct INTEGER NOT NULL, expires_at TIMESTAMPTZ, max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
      await sql`CREATE TABLE IF NOT EXISTS site_sale (id INTEGER PRIMARY KEY, pct INTEGER NOT NULL, until TIMESTAMPTZ NOT NULL, label TEXT)`;
      await sql`CREATE TABLE IF NOT EXISTS discount_uses (session_id TEXT PRIMARY KEY, code TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const clean = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);

// The running general sale, or null.
async function getSiteSale() {
  try {
    await ensureTables();
    const [r] = await sql`SELECT pct, until, label FROM site_sale WHERE id = 1 AND until > now() AND pct > 0`;
    return r ? { pct: r.pct, until: new Date(r.until).toISOString(), label: r.label || '' } : null;
  } catch (err) { console.error('site sale error:', err); return null; }
}

// A code a buyer may use right now: { code, pct } or { error }.
async function checkCode(raw) {
  const code = clean(raw);
  if (!code) return { error: 'Enter a code.' };
  await ensureTables();
  const [r] = await sql`SELECT code, pct, expires_at, max_uses, used, active FROM discount_codes WHERE code = ${code}`;
  if (!r || !r.active) return { error: 'This code is not valid.' };
  if (r.expires_at && new Date(r.expires_at) < new Date()) return { error: 'This code has expired.' };
  if (r.max_uses != null && r.used >= r.max_uses) return { error: 'This code has been used up.' };
  return { code: r.code, pct: r.pct };
}

// Counts a paid order once (a webhook retry does not count twice).
async function recordUse(sessionId, code) {
  if (!code) return;
  await ensureTables();
  const rows = await sql`INSERT INTO discount_uses (session_id, code) VALUES (${sessionId}, ${clean(code)}) ON CONFLICT DO NOTHING RETURNING session_id`;
  if (rows.length) await sql`UPDATE discount_codes SET used = used + 1 WHERE code = ${clean(code)}`;
}

// POST /api/beats/code { code } -> { code, pct }
async function handleCode(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const r = await checkCode(req.body && req.body.code);
    if (r.error) { res.status(404).json({ error: r.error }); return; }
    res.status(200).json(r);
  } catch (err) { console.error('code check error:', err); res.status(500).json({ error: 'Could not check the code.' }); }
}

// Team only. GET: codes + general sale. POST { do: 'code' | 'toggle' | 'site', ... }
async function handleAdmin(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  if (!isAdmin(session)) { res.status(403).json({ error: 'Not allowed.' }); return; }
  try {
    await ensureTables();
    if (req.method === 'POST') {
      const b = req.body || {};
      const pct = Math.round(Number(b.pct) || 0), days = Math.round(Number(b.days) || 0);
      if (b.do === 'code') {
        const code = clean(b.code);
        const maxUses = b.maxUses === '' || b.maxUses == null ? null : Math.round(Number(b.maxUses));
        if (code.length < 3) { res.status(400).json({ error: 'The code needs at least 3 letters or numbers.' }); return; }
        if (pct < 1 || pct > 95) { res.status(400).json({ error: 'A code takes 1% to 95% off.' }); return; }
        if (days < 0 || days > 365) { res.status(400).json({ error: 'Days must be 0 to 365 (0 = no end date).' }); return; }
        if (maxUses != null && (!(maxUses >= 1) || maxUses > 100000)) { res.status(400).json({ error: 'Uses must be at least 1.' }); return; }
        await sql`INSERT INTO discount_codes (code, pct, expires_at, max_uses, active) VALUES (${code}, ${pct}, ${days ? new Date(Date.now() + days * 864e5).toISOString() : null}, ${maxUses}, true)
          ON CONFLICT (code) DO UPDATE SET pct = ${pct}, expires_at = ${days ? new Date(Date.now() + days * 864e5).toISOString() : null}, max_uses = ${maxUses}, active = true`;
      } else if (b.do === 'toggle') {
        await sql`UPDATE discount_codes SET active = ${b.active === true} WHERE code = ${clean(b.code)}`;
      } else if (b.do === 'site') {
        if (pct === 0) await sql`DELETE FROM site_sale WHERE id = 1`;
        else {
          if (pct < 5 || pct > 95) { res.status(400).json({ error: 'A general sale takes 5% to 95% off.' }); return; }
          if (days < 1 || days > 60) { res.status(400).json({ error: 'A general sale lasts 1 to 60 days.' }); return; }
          const label = String(b.label || '').trim().slice(0, 40);
          await sql`INSERT INTO site_sale (id, pct, until, label) VALUES (1, ${pct}, ${new Date(Date.now() + days * 864e5).toISOString()}, ${label})
            ON CONFLICT (id) DO UPDATE SET pct = ${pct}, until = ${new Date(Date.now() + days * 864e5).toISOString()}, label = ${label}`;
        }
      } else { res.status(400).json({ error: 'Unknown action.' }); return; }
    } else if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const codes = await sql`SELECT code, pct, expires_at, max_uses, used, active FROM discount_codes ORDER BY created_at DESC LIMIT 100`;
    res.status(200).json({ siteSale: await getSiteSale(), codes });
  } catch (err) { console.error('discounts admin error:', err); res.status(500).json({ error: 'Could not save.' }); }
}

module.exports = { ensureTables, getSiteSale, checkCode, recordUse, handleCode, handleAdmin };
