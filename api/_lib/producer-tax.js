// Producer tax details, monthly earnings statements and the accountant export.
//
//   GET  /api/producer/tax                       -> { tax, complete, declaration, version }
//   POST /api/producer/tax { ...details, declared: true }   -> same, saved
//   GET  /api/producer/statement                 -> { months, taxComplete }
//   GET  /api/producer/statement?month=YYYY-MM&format=pdf|csv   -> the file
//   GET  /api/admin/earnings-export?month=YYYY-MM | ?year=YYYY  -> CSV (admin only)
//
// What this is for:
//   * Payouts wait until a producer has confirmed their tax details (see
//     payouts.js), so the company always knows who it paid and where.
//   * Every save is appended to producer_tax_log with the time and IP, and the
//     declaration text version, so there is proof of what was confirmed when.
//   * Every sale carries a commission note number (CSF-year-number) and the
//     commission amount (producer_earnings.fee_number / fee_cents): the record
//     the 20% fee invoice is issued from. It is NOT a tax invoice.
//   * The statement is what a producer needs to invoice their earnings; the
//     export is what the accountant needs to issue the fee invoices.
const { sql } = require('./db');
const { getSession } = require('./auth');
const { roleFor, isAdmin } = require('./account');
const COMPANY = require('./company');

// Bump when the declaration text changes: producers confirm again before the
// next payout.
const VERSION = 'tax-2026-10';
const DECLARATION = 'I confirm that these details are correct and complete, that I am the person or company that receives the earnings, and that I am responsible for declaring and paying all taxes due on them. I will update these details if they change. I understand that payouts wait until they are complete.';

const EU = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE']);

let ready = null;
function ensureTax() {
  if (!ready) {
    ready = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS producer_tax (
          user_id INTEGER PRIMARY KEY,
          entity_type TEXT NOT NULL,
          legal_name TEXT NOT NULL,
          country TEXT NOT NULL,
          tax_id TEXT NOT NULL,
          vat_number TEXT,
          address TEXT NOT NULL,
          city TEXT NOT NULL,
          postal_code TEXT NOT NULL,
          birth_date DATE,
          declared_at TIMESTAMPTZ NOT NULL,
          declaration_version TEXT NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      // Append-only: what was confirmed, when, from where.
      await sql`
        CREATE TABLE IF NOT EXISTS producer_tax_log (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          data JSONB NOT NULL,
          declaration_version TEXT NOT NULL,
          ip TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS producer_tax_log_user_idx ON producer_tax_log (user_id, id)`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const shape = (r) => (r ? {
  entityType: r.entity_type, legalName: r.legal_name, country: r.country, taxId: r.tax_id, vatNumber: r.vat_number || '',
  address: r.address, city: r.city, postalCode: r.postal_code, birthDate: r.birth_date ? new Date(r.birth_date).toISOString().slice(0, 10) : '',
  declaredAt: r.declared_at, version: r.declaration_version,
} : null);
const isComplete = (r) => !!(r && r.declared_at && r.declaration_version === VERSION);

async function taxComplete(userId) {
  await ensureTax();
  const [r] = await sql`SELECT declared_at, declaration_version FROM producer_tax WHERE user_id = ${userId}`;
  return isComplete(r);
}

/* -------------------------------- Validation ------------------------------- */
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function validate(b) {
  const entityType = b.entityType === 'business' ? 'business' : b.entityType === 'individual' ? 'individual' : '';
  if (!entityType) return { error: 'Choose whether you receive the earnings as an individual or as a business.' };
  const legalName = clean(b.legalName, 120);
  if (legalName.length < 2) return { error: entityType === 'business' ? 'Enter the registered name of the business.' : 'Enter your full legal name.' };
  const country = clean(b.country, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'Choose your country.' };
  const taxId = clean(b.taxId, 32).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9][A-Z0-9./-]{3,31}$/.test(taxId)) return { error: 'Enter your tax ID (for Italy, the codice fiscale).' };
  if (country === 'IT') {
    const ok = entityType === 'individual' ? /^[A-Z0-9]{16}$/.test(taxId) : /^([A-Z0-9]{16}|[0-9]{11})$/.test(taxId);
    if (!ok) return { error: entityType === 'individual' ? 'An Italian codice fiscale has 16 characters.' : 'Use the 11-digit partita IVA or the 16-character codice fiscale.' };
  }
  let vatNumber = clean(b.vatNumber, 20).toUpperCase().replace(/[\s.-]+/g, '');
  if (vatNumber && !/^[A-Z]{0,2}[A-Z0-9]{5,14}$/.test(vatNumber)) return { error: 'The VAT number does not look right. Leave it empty if you do not have one.' };
  if (entityType === 'business' && EU.has(country) && !vatNumber) return { error: 'Enter the VAT number of the business.' };
  const address = clean(b.address, 160);
  const city = clean(b.city, 80);
  const postalCode = clean(b.postalCode, 20);
  if (address.length < 3 || city.length < 2 || postalCode.length < 2) return { error: 'Enter the full address: street, city and postal code.' };
  let birthDate = null;
  if (entityType === 'individual') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(b.birthDate, 10));
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    const age = d ? (Date.now() - d.getTime()) / 31557600000 : 0;
    if (!d || d.getUTCMonth() !== +m[2] - 1 || age < 18 || age > 110) return { error: 'Enter your date of birth (you must be at least 18).' };
    birthDate = m[0];
  }
  if (b.declared !== true) return { error: 'Please tick the confirmation to save your details.' };
  return { value: { entityType, legalName, country, taxId, vatNumber: vatNumber || null, address, city, postalCode, birthDate } };
}

async function producerOnly(req, res) {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return null; }
  if ((await roleFor(session.uid)) !== 'producer') { res.status(403).json({ error: 'This is for producer accounts.' }); return null; }
  return session;
}

async function handleTax(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const session = await producerOnly(req, res);
    if (!session) return;
    await ensureTax();
    if (req.method === 'POST') {
      const { value, error } = validate(req.body || {});
      if (error) { res.status(400).json({ error }); return; }
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 64) || null;
      await sql`
        INSERT INTO producer_tax (user_id, entity_type, legal_name, country, tax_id, vat_number, address, city, postal_code, birth_date, declared_at, declaration_version, updated_at)
        VALUES (${session.uid}, ${value.entityType}, ${value.legalName}, ${value.country}, ${value.taxId}, ${value.vatNumber}, ${value.address}, ${value.city}, ${value.postalCode}, ${value.birthDate}, now(), ${VERSION}, now())
        ON CONFLICT (user_id) DO UPDATE SET entity_type = EXCLUDED.entity_type, legal_name = EXCLUDED.legal_name, country = EXCLUDED.country, tax_id = EXCLUDED.tax_id,
          vat_number = EXCLUDED.vat_number, address = EXCLUDED.address, city = EXCLUDED.city, postal_code = EXCLUDED.postal_code, birth_date = EXCLUDED.birth_date,
          declared_at = now(), declaration_version = ${VERSION}, updated_at = now()
      `;
      await sql`INSERT INTO producer_tax_log (user_id, data, declaration_version, ip) VALUES (${session.uid}, ${JSON.stringify({ ...value, declaration: DECLARATION })}::jsonb, ${VERSION}, ${ip})`;
    } else if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const [row] = await sql`SELECT * FROM producer_tax WHERE user_id = ${session.uid}`;
    res.status(200).json({ tax: shape(row), complete: isComplete(row), declaration: DECLARATION, version: VERSION, company: COMPANY });
  } catch (err) {
    console.error('producer tax error:', err);
    res.status(500).json({ error: 'Could not save your tax details, please try again.' });
  }
}

/* -------------------------------- Statements ------------------------------- */
const eur = (c) => (c / 100).toFixed(2);
const monthOk = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const bounds = (m) => {
  const [y, mo] = m.split('-').map(Number);
  return [new Date(Date.UTC(y, mo - 1, 1)), new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1))];
};
// A cell that starts with = + - @ would run as a formula in Excel: track
// titles come from producers, so defuse them.
const cell = (v) => {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
const statementNo = (uid, m) => `CS-ST-${uid}-${m.replace('-', '')}`;
const live = (r) => r.status !== 'refunded';

async function statementPdf({ no, month, tax, rows, totals, generated }) {
  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595; const H = 842; const M = 44;
  const ink = rgb(0.1, 0.1, 0.1); const muted = rgb(0.4, 0.4, 0.4); const accent = rgb(0.91, 0.53, 0.17);
  // Standard PDF fonts only draw Latin-1 and the euro sign.
  const safe = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7e -ÿ€]/g, '?');
  let page = doc.addPage([W, H]);
  let y = H - M;
  const text = (t, x, size = 9, f = font, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const fit = (t, f, size, max) => { let s = safe(t); while (s.length > 1 && f.widthOfTextAtSize(s, size) > max) s = `${s.slice(0, -2)}…`.replace('…', '.'); return s; };
  const right = (t, xr, size = 9, f = font) => page.drawText(safe(t), { x: xr - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color: ink });
  const wrap = (str, f, size, max) => {
    const lines = []; let line = '';
    for (const w of safe(str).split(/\s+/)) { const n = line ? `${line} ${w}` : w; if (f.widthOfTextAtSize(n, size) > max && line) { lines.push(line); line = w; } else line = n; }
    if (line) lines.push(line); return lines;
  };

  text('CREATIVE SOUND', M, 10, bold, accent);
  y -= 22; text('Earnings statement', M, 20, bold);
  y -= 16; text(`${no}  ·  ${month}  ·  generated ${generated.slice(0, 10)}`, M, 9, font, muted);
  y -= 26; text('Producer', M, 8, bold, muted);
  y -= 12;
  if (tax) {
    text(`${tax.legal_name} (${tax.entity_type === 'business' ? 'business' : 'individual'})`, M, 10, bold);
    y -= 13; text(`${tax.address}, ${tax.postal_code} ${tax.city}, ${tax.country}`, M, 9);
    y -= 12; text(`Tax ID: ${tax.tax_id}${tax.vat_number ? `   VAT: ${tax.vat_number}` : ''}`, M, 9);
  } else {
    text('Tax details not provided yet', M, 10, bold);
  }
  // Where to address an invoice for these earnings.
  page.drawText('INVOICE TO (if you invoice your earnings)', { x: 330, y: H - M - 38, size: 8, font: bold, color: muted });
  {
    let yy = H - M - 51;
    for (const [t, f] of [[COMPANY.legalName, bold], ['Trade name: ' + COMPANY.tradeName + ' (brand name)', font], [COMPANY.address, font], ['VAT ' + COMPANY.vat + '   SDI code ' + COMPANY.sdiCode, font], ['PEC ' + COMPANY.pec, font], ['Send the invoice to ' + COMPANY.invoiceEmail, font]]) {
      page.drawText(safe(t), { x: 330, y: yy, size: f === bold ? 9 : 8, font: f, color: ink });
      yy -= 11;
    }
  }
  y -= 26;
  const cols = [M, 92, 150, 360, 410, 460, 510];
  const head = () => {
    page.drawLine({ start: { x: M, y: y + 12 }, end: { x: W - M, y: y + 12 }, thickness: 0.6, color: muted });
    text('Date', cols[0], 8, bold, muted); text('Ref', cols[1], 8, bold, muted); text('Track / license', cols[2], 8, bold, muted);
    right('Gross', cols[4] - 6, 8, bold); right('Fee 20%', cols[5] - 6, 8, bold); right('Net', cols[6] - 6, 8, bold); text('Status', cols[6], 8, bold, muted);
    y -= 14;
  };
  head();
  for (const r of rows) {
    if (y < 150) { page = doc.addPage([W, H]); y = H - M; head(); }
    const refunded = !live(r);
    text(new Date(r.created_at).toISOString().slice(0, 10), cols[0], 8);
    text(fit((r.fee_number || `#${r.id}`).replace('CSF-', ''), font, 8, cols[2] - cols[1] - 6), cols[1], 8);
    text(fit(`${r.title} (${String(r.tier || '').toUpperCase()})`, font, 8, cols[3] - cols[2] - 6), cols[2], 8);
    right(eur(r.gross_cents), cols[4] - 6, 8); right(refunded ? '-' : eur(r.fee_cents), cols[5] - 6, 8); right(refunded ? '-' : eur(r.share_cents), cols[6] - 6, 8);
    text(refunded ? 'Refunded' : r.status === 'paid' ? 'Paid' : 'Due', cols[6], 8, font, refunded ? muted : ink);
    y -= 13;
  }
  y -= 8; page.drawLine({ start: { x: M, y: y + 10 }, end: { x: W - M, y: y + 10 }, thickness: 0.6, color: muted });
  text('Total (refunds excluded)', M, 9, bold);
  right(eur(totals.gross), cols[4] - 6, 9, bold); right(eur(totals.fee), cols[5] - 6, 9, bold); right(eur(totals.net), cols[6] - 6, 9, bold);
  y -= 30;
  const notes = [
    'Gross is what the buyer paid. Fee is the 20% Creative Sound keeps (card fees, hosting and the store). Net is the 80% due to you; each sale is held for 14 days (30 days before your first payout), then paid on the next Monday once your balance reaches 10 EUR.',
    'This statement lists your sales and the amounts due to you. It is not a tax invoice. Creative Sound records its fee for every sale as a commission note (the Ref column); any invoice for that fee that tax law requires is issued separately.',
    'You are responsible for declaring and paying the taxes due on your earnings. Months follow UTC time.',
  ];
  for (const n of notes) { for (const l of wrap(n, font, 8, W - M * 2)) { if (y < 50) { page = doc.addPage([W, H]); y = H - M; } text(l, M, 8, font, muted); y -= 11; } y -= 5; }
  return Buffer.from(await doc.save());
}

async function handleStatement(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const session = await producerOnly(req, res);
    if (!session) return;
    await ensureTax();
    require('./payouts').ensureTables && await require('./payouts').ensureTables();
    const month = String((req.query && req.query.month) || '');
    if (!month) {
      const months = await sql`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month, count(*)::int AS sales,
          COALESCE(sum(gross_cents) FILTER (WHERE status <> 'refunded'), 0)::int AS gross,
          COALESCE(sum(share_cents) FILTER (WHERE status <> 'refunded'), 0)::int AS net
        FROM producer_earnings WHERE user_id = ${session.uid} GROUP BY 1 ORDER BY 1 DESC LIMIT 36
      `;
      res.status(200).json({ months, taxComplete: await taxComplete(session.uid) });
      return;
    }
    if (!monthOk(month)) { res.status(400).json({ error: 'Choose a month.' }); return; }
    const [from, to] = bounds(month);
    const rows = await sql`
      SELECT id, fee_number, title, tier, gross_cents, share_cents, fee_cents, currency, status, payout_method, created_at, paid_at
      FROM producer_earnings WHERE user_id = ${session.uid} AND created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()} ORDER BY created_at, id
    `;
    const [tax] = await sql`SELECT * FROM producer_tax WHERE user_id = ${session.uid}`;
    const totals = rows.filter(live).reduce((t, r) => ({ gross: t.gross + r.gross_cents, fee: t.fee + r.fee_cents, net: t.net + r.share_cents }), { gross: 0, fee: 0, net: 0 });
    const no = statementNo(session.uid, month);
    const generated = new Date().toISOString();
    if (String(req.query.format) === 'csv') {
      const out = [['Statement', no], ['Period', month], ['Producer', tax ? tax.legal_name : ''], ['Tax ID', tax ? tax.tax_id : ''], ['VAT number', tax && tax.vat_number ? tax.vat_number : ''],
        ['Invoice to', COMPANY.legalName], ['Trade name', `${COMPANY.tradeName} (brand name, address the invoice to the person above)`], ['Address', COMPANY.address], ['VAT number (Creative Sound)', COMPANY.vat], ['PEC', COMPANY.pec], ['SDI code', COMPANY.sdiCode], ['Send invoices to', COMPANY.invoiceEmail], [],
        ['Date', 'Commission note', 'Track', 'License', 'Gross', 'Creative Sound fee (20%)', 'Net to you (80%)', 'Currency', 'Status', 'Paid on', 'Payout method'],
        ...rows.map((r) => [new Date(r.created_at).toISOString().slice(0, 10), r.fee_number || '', r.title, r.tier, eur(r.gross_cents), live(r) ? eur(r.fee_cents) : '0.00', live(r) ? eur(r.share_cents) : '0.00', String(r.currency).toUpperCase(), r.status, r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 10) : '', r.payout_method || '']),
        [], ['Total (refunds excluded)', '', '', '', eur(totals.gross), eur(totals.fee), eur(totals.net)]];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${no}.csv"`);
      res.status(200).send(csv(out));
      return;
    }
    const pdf = await statementPdf({ no, month, tax, rows, totals, generated });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.view === '1' ? 'inline' : 'attachment'}; filename="${no}.pdf"`);
    res.status(200).send(pdf);
  } catch (err) {
    console.error('statement error:', err);
    res.status(500).json({ error: 'Could not create the statement.' });
  }
}

/* ---------------------------- Accountant export ---------------------------- */
async function handleExport(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session || !isAdmin(session)) { res.status(401).json({ error: 'Sign in with the admin account.' }); return; }
  try {
    await ensureTax();
    await require('./payouts').ensureTables();
    const month = String((req.query && req.query.month) || '');
    const year = String((req.query && req.query.year) || '');
    let from; let to; let label;
    if (monthOk(month)) { [from, to] = bounds(month); label = month; }
    else if (/^\d{4}$/.test(year)) { from = new Date(Date.UTC(+year, 0, 1)); to = new Date(Date.UTC(+year + 1, 0, 1)); label = year; }
    else { res.status(400).json({ error: 'Use ?month=YYYY-MM or ?year=YYYY.' }); return; }
    const rows = await sql`
      SELECT e.*, u.email, t.entity_type, t.legal_name, t.country, t.tax_id, t.vat_number, t.address, t.city, t.postal_code, t.birth_date, t.declared_at
      FROM producer_earnings e JOIN users u ON u.id = e.user_id LEFT JOIN producer_tax t ON t.user_id = e.user_id
      WHERE e.created_at >= ${from.toISOString()} AND e.created_at < ${to.toISOString()} ORDER BY e.created_at, e.id
    `;
    const head = ['Commission note', 'Date', 'Producer id', 'Producer email', 'Entity', 'Legal name', 'Country', 'Tax ID', 'VAT number', 'Address', 'City', 'Postal code', 'Tax details confirmed',
      'Track', 'License', 'Gross', 'Creative Sound fee (20%)', 'Net to producer', 'Currency', 'Status', 'Payout method', 'Paid on', 'Stripe payment', 'Stripe session'];
    const out = [head, ...rows.map((r) => [r.fee_number || '', new Date(r.created_at).toISOString(), r.user_id, r.email, r.entity_type || '', r.legal_name || '', r.country || '', r.tax_id || '', r.vat_number || '', r.address || '', r.city || '', r.postal_code || '',
      r.declared_at ? new Date(r.declared_at).toISOString().slice(0, 10) : 'NO', r.title, r.tier, eur(r.gross_cents), r.status === 'refunded' ? '0.00' : eur(r.fee_cents), r.status === 'refunded' ? '0.00' : eur(r.share_cents),
      String(r.currency).toUpperCase(), r.status, r.payout_method || '', r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 10) : '', r.payment_intent || '', r.session_id])];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="creative-sound-earnings-${label}.csv"`);
    res.status(200).send(csv(out));
  } catch (err) {
    console.error('earnings export error:', err);
    res.status(500).json({ error: 'Could not create the export.' });
  }
}

module.exports = { VERSION, ensureTax, taxComplete, handleTax, handleStatement, handleExport };
