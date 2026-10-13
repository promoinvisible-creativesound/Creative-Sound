// Producer payouts: 80% of every sale of a producer's track goes to the
// producer, 20% stays with Creative Sound (card fees and hosting included).
//
// - Every paid line of a beat order for a producer track becomes a row in
//   producer_earnings (recordEarnings, called from the Stripe webhook).
// - Earnings wait HOLD_DAYS (refund window), then the weekly cron
//   (/api/payouts/run, vercel.json "crons") pays what is available:
//     * Stripe: one transfer per sale to the producer's Stripe Express
//       account, tied to the original charge (source_transaction), so it
//       never depends on the platform balance. Stripe then pays the
//       producer's bank weekly.
//     * PayPal: one PayPal Payout per producer, drawn from the Creative
//       Sound PayPal balance (it must hold enough funds).
// - Refunds (charge.refunded) cancel earnings that weren't paid yet.
//
//   GET  /api/producer/payouts           -> balances, method, history
//   POST /api/producer/payouts           -> { method:'paypal', email } | { method:'stripe', country } -> { url }
//                                           | { method:'stripe-dashboard' } -> { url }
//   GET  /api/payouts/run                -> cron (Authorization: Bearer CRON_SECRET) or admin
//
// Env: STRIPE_SECRET_KEY (Connect enabled), CRON_SECRET,
//      PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV (live | sandbox).
const Stripe = require('stripe');
const { sql } = require('./db');
const { getSession } = require('./auth');
const { roleFor, isAdmin } = require('./account');

const SHARE = 0.8;
const HOLD_DAYS = 7;
const MIN_PAYOUT = 1000; // cents
// Stripe Connect accounts the Italian platform can pay out to (EEA, UK, CH).
const STRIPE_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'NO', 'IS', 'LI', 'GB', 'CH'];

const stripe = () => Stripe(process.env.STRIPE_SECRET_KEY);
const paypalOn = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const shareOf = (gross) => Math.floor(gross * SHARE);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

let ready = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_method TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_payouts_ready BOOLEAN NOT NULL DEFAULT false`;
      await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS paypal_email TEXT`;
      await sql`
        CREATE TABLE IF NOT EXISTS producer_earnings (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL,
          session_id TEXT NOT NULL,
          payment_intent TEXT,
          beat_id TEXT NOT NULL,
          title TEXT,
          tier TEXT,
          gross_cents INTEGER NOT NULL,
          share_cents INTEGER NOT NULL,
          currency TEXT NOT NULL DEFAULT 'eur',
          status TEXT NOT NULL DEFAULT 'pending',
          payout_method TEXT,
          payout_ref TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          paid_at TIMESTAMPTZ
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS producer_earnings_sale_idx ON producer_earnings (session_id, beat_id)`;
      await sql`CREATE INDEX IF NOT EXISTS producer_earnings_user_idx ON producer_earnings (user_id, status)`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// Webhook: one earning per producer track in a paid beat order.
async function recordEarnings(session, items) {
  const own = items.filter(({ beat }) => beat.source === 'producer' && beat._userId);
  if (!own.length) return;
  await ensureTables();
  const currency = session.currency || 'eur';
  for (const { beat, tier, price } of own) {
    await sql`
      INSERT INTO producer_earnings (user_id, session_id, payment_intent, beat_id, title, tier, gross_cents, share_cents, currency)
      VALUES (${beat._userId}, ${session.id}, ${session.payment_intent || null}, ${beat.id}, ${beat.title}, ${tier}, ${price}, ${shareOf(price)}, ${currency})
      ON CONFLICT (session_id, beat_id) DO NOTHING
    `;
  }
}

// Webhook: a fully refunded charge cancels the earnings not paid yet.
// Already paid ones are flagged for the studio to sort out by hand.
async function handleRefund(charge, notify) {
  if (!charge || !charge.refunded || !charge.payment_intent) return;
  await ensureTables();
  await sql`UPDATE producer_earnings SET status = 'refunded' WHERE payment_intent = ${charge.payment_intent} AND status = 'pending'`;
  const paid = await sql`SELECT id, user_id, title, share_cents FROM producer_earnings WHERE payment_intent = ${charge.payment_intent} AND status = 'paid'`;
  if (paid.length && notify) await notify(`Refund on ${charge.payment_intent} after the producer was paid: ${paid.map((p) => `#${p.id} ${p.title} €${(p.share_cents / 100).toFixed(2)} (user ${p.user_id})`).join(', ')}`);
}

async function producerOnly(req, res) {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return null; }
  if ((await roleFor(session.uid)) !== 'producer') { res.status(403).json({ error: 'Payouts are for producer accounts.' }); return null; }
  return session;
}

async function refreshStripe(row) {
  if (!row.stripe_account_id || row.stripe_payouts_ready) return row;
  try {
    const acct = await stripe().accounts.retrieve(row.stripe_account_id);
    const ok = !!(acct.capabilities && acct.capabilities.transfers === 'active' && acct.payouts_enabled);
    if (ok) {
      const [u] = await sql`UPDATE users SET stripe_payouts_ready = true, payout_method = COALESCE(payout_method, 'stripe') WHERE id = ${row.id} RETURNING *`;
      return u;
    }
  } catch (err) { console.error('stripe account refresh failed:', err.message); }
  return row;
}

async function handlePayouts(req, res) {
  try {
    const session = await producerOnly(req, res);
    if (!session) return;
    await ensureTables();
    let [user] = await sql`SELECT * FROM users WHERE id = ${session.uid}`;

    if (req.method === 'POST') {
      const b = req.body || {};
      if (b.method === 'paypal') {
        const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
        if (!emailOk(email)) { res.status(400).json({ error: 'Enter the email of your PayPal account.' }); return; }
        await sql`UPDATE users SET paypal_email = ${email}, payout_method = 'paypal' WHERE id = ${session.uid}`;
      } else if (b.method === 'stripe') {
        if (!process.env.STRIPE_SECRET_KEY) { res.status(503).json({ error: 'Stripe payouts are not available yet.' }); return; }
        const siteUrl = (process.env.SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
        let account = user.stripe_account_id;
        if (!account) {
          const country = String(b.country || 'IT').toUpperCase();
          if (!STRIPE_COUNTRIES.includes(country)) { res.status(400).json({ error: 'Stripe payouts work in Europe, the UK and Switzerland. Use PayPal instead.' }); return; }
          const acct = await stripe().accounts.create({
            type: 'express',
            country,
            email: user.email,
            capabilities: { transfers: { requested: true } },
            settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'monday' } } },
            metadata: { user_id: String(user.id) },
          });
          account = acct.id;
          await sql`UPDATE users SET stripe_account_id = ${account}, payout_method = 'stripe' WHERE id = ${session.uid}`;
        } else {
          await sql`UPDATE users SET payout_method = 'stripe' WHERE id = ${session.uid}`;
        }
        const link = await stripe().accountLinks.create({
          account,
          type: 'account_onboarding',
          refresh_url: `${siteUrl}/profile-producer.html?stripe=retry#payouts`,
          return_url: `${siteUrl}/profile-producer.html?stripe=done#payouts`,
        });
        res.status(200).json({ url: link.url });
        return;
      } else if (b.method === 'stripe-dashboard') {
        if (!user.stripe_account_id) { res.status(400).json({ error: 'Connect Stripe first.' }); return; }
        const link = await stripe().accounts.createLoginLink(user.stripe_account_id);
        res.status(200).json({ url: link.url });
        return;
      } else if (b.method === 'use-stripe') {
        if (!user.stripe_account_id) { res.status(400).json({ error: 'Connect Stripe first.' }); return; }
        await sql`UPDATE users SET payout_method = 'stripe' WHERE id = ${session.uid}`;
      } else {
        res.status(400).json({ error: 'Pick Stripe or PayPal.' });
        return;
      }
      [user] = await sql`SELECT * FROM users WHERE id = ${session.uid}`;
    }

    user = await refreshStripe(user);
    const rows = await sql`
      SELECT id, beat_id, title, tier, gross_cents, share_cents, currency, status, payout_method, created_at, paid_at,
        (status = 'pending' AND created_at <= now() - make_interval(days => ${HOLD_DAYS})) AS available
      FROM producer_earnings WHERE user_id = ${session.uid} ORDER BY created_at DESC LIMIT 200
    `;
    const sum = (f) => rows.filter(f).reduce((n, r) => n + r.share_cents, 0);
    res.status(200).json({
      share: Math.round(SHARE * 100),
      holdDays: HOLD_DAYS,
      minPayout: MIN_PAYOUT,
      currency: 'eur',
      method: user.payout_method || null,
      stripe: { available: !!process.env.STRIPE_SECRET_KEY, connected: !!user.stripe_account_id, ready: !!user.stripe_payouts_ready, countries: STRIPE_COUNTRIES },
      paypal: { available: paypalOn(), email: user.paypal_email || '' },
      totals: {
        pending: sum((r) => r.status === 'pending' && !r.available),
        available: sum((r) => r.status === 'pending' && r.available),
        paid: sum((r) => r.status === 'paid'),
        sales: rows.filter((r) => r.status !== 'refunded').length,
      },
      earnings: rows.slice(0, 50).map((r) => ({
        title: r.title, tier: r.tier, gross: r.gross_cents, share: r.share_cents, currency: r.currency,
        status: r.status === 'pending' ? (r.available ? 'available' : 'pending') : r.status,
        method: r.payout_method, date: r.created_at, paidAt: r.paid_at,
      })),
    });
  } catch (err) {
    console.error('producer payouts error:', err);
    const connectOff = /signed up for Connect|platform profile|connect/i.test(String(err && err.message));
    res.status(500).json({ error: connectOff ? 'Stripe payouts are being switched on. Try again soon or use PayPal.' : 'Something went wrong, please try again.' });
  }
}

/* --------------------------------- PayPal --------------------------------- */
const paypalBase = () => (process.env.PAYPAL_ENV === 'sandbox' ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');
async function paypalToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${paypalBase()}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const d = await r.json();
  if (!r.ok) throw new Error(`PayPal auth: ${d.error_description || r.status}`);
  return d.access_token;
}
async function paypalPayout({ email, cents, currency, ref, note }) {
  const token = await paypalToken();
  const r = await fetch(`${paypalBase()}/v1/payments/payouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': ref },
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: ref, email_subject: 'You have a payout from Creative Sound', email_message: note },
      items: [{ recipient_type: 'EMAIL', receiver: email, amount: { value: (cents / 100).toFixed(2), currency: currency.toUpperCase() }, note, sender_item_id: ref }],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`PayPal payout: ${d.name || r.status} ${d.message || ''}`.trim());
  return d.batch_header && d.batch_header.payout_batch_id;
}

/* ---------------------------------- Run ----------------------------------- */
async function runPayouts() {
  await ensureTables();
  const due = await sql`
    SELECT e.*, u.email, u.payout_method AS method, u.stripe_account_id, u.stripe_payouts_ready, u.paypal_email
    FROM producer_earnings e JOIN users u ON u.id = e.user_id
    WHERE e.status = 'pending' AND e.created_at <= now() - make_interval(days => ${HOLD_DAYS})
    ORDER BY e.user_id, e.id
  `;
  const byUser = new Map();
  for (const r of due) byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), r]);
  const report = [];
  for (const [userId, list] of byUser) {
    const u = list[0];
    const total = list.reduce((n, r) => n + r.share_cents, 0);
    if (total < MIN_PAYOUT) { report.push(`user ${userId}: €${(total / 100).toFixed(2)} below the minimum, waiting`); continue; }
    const ids = list.map((r) => r.id);
    // Lock the rows so two runs can never pay the same sale twice.
    const locked = await sql`UPDATE producer_earnings SET status = 'processing' WHERE id = ANY(${ids}) AND status = 'pending' RETURNING id`;
    if (locked.length !== ids.length) { await sql`UPDATE producer_earnings SET status = 'pending' WHERE id = ANY(${locked.map((r) => r.id)}) AND status = 'processing'`; continue; }
    try {
      if (u.method === 'stripe' && u.stripe_account_id && u.stripe_payouts_ready) {
        for (const r of list) {
          const pi = r.payment_intent ? await stripe().paymentIntents.retrieve(r.payment_intent) : null;
          const t = await stripe().transfers.create({
            amount: r.share_cents,
            currency: r.currency,
            destination: u.stripe_account_id,
            source_transaction: pi && pi.latest_charge ? pi.latest_charge : undefined,
            transfer_group: r.session_id,
            description: `${r.title} (${r.tier})`,
            metadata: { earning_id: String(r.id), beat_id: r.beat_id },
          }, { idempotencyKey: `earning-${r.id}` });
          await sql`UPDATE producer_earnings SET status = 'paid', payout_method = 'stripe', payout_ref = ${t.id}, paid_at = now() WHERE id = ${r.id}`;
        }
        report.push(`user ${userId} (${u.email}): €${(total / 100).toFixed(2)} via Stripe`);
      } else if (u.method === 'paypal' && u.paypal_email && paypalOn()) {
        const ref = `cs-${userId}-${ids[0]}-${ids[ids.length - 1]}`;
        const batch = await paypalPayout({ email: u.paypal_email, cents: total, currency: u.currency, ref, note: `Creative Sound: ${list.length} sale(s), your 80% share.` });
        await sql`UPDATE producer_earnings SET status = 'paid', payout_method = 'paypal', payout_ref = ${batch || ref}, paid_at = now() WHERE id = ANY(${ids})`;
        report.push(`user ${userId} (${u.email}): €${(total / 100).toFixed(2)} via PayPal to ${u.paypal_email}`);
      } else {
        await sql`UPDATE producer_earnings SET status = 'pending' WHERE id = ANY(${ids}) AND status = 'processing'`;
        report.push(`user ${userId} (${u.email}): €${(total / 100).toFixed(2)} waiting, no payout method set up`);
      }
    } catch (err) {
      console.error('payout failed for user', userId, err);
      await sql`UPDATE producer_earnings SET status = 'pending' WHERE id = ANY(${ids}) AND status = 'processing'`;
      report.push(`user ${userId} (${u.email}): FAILED, ${err.message}`);
    }
  }
  return report;
}

async function handleRun(req, res) {
  const secret = process.env.CRON_SECRET;
  const cron = secret && req.headers.authorization === `Bearer ${secret}`;
  const session = getSession(req);
  if (!cron && !(session && isAdmin(session))) { res.status(401).json({ error: 'Not allowed.' }); return; }
  try {
    const report = await runPayouts();
    if (report.length && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: process.env.FROM_EMAIL, to: 'hello@creativesound.io', subject: 'Producer payouts',
          html: `<p>Payout run ${new Date().toISOString().slice(0, 10)}:</p><p>${report.map((l) => l.replace(/[<>&]/g, '')).join('<br>')}</p>`,
        });
      } catch (err) { console.error('payout report email failed:', err); }
    }
    res.status(200).json({ ok: true, report });
  } catch (err) {
    console.error('payout run error:', err);
    res.status(500).json({ error: 'Payout run failed.' });
  }
}

module.exports = { SHARE, recordEarnings, handleRefund, handlePayouts, handleRun };
