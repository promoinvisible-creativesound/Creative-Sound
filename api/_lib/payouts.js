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
// - Refunds (charge.refunded, also partial) and chargebacks (charge.dispute.*): earnings not
//   paid yet are reduced, cancelled or put on hold; Stripe transfers already sent are reversed;
//   PayPal ones are flagged to the studio to recover by hand (see takeBack / handleDispute).
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
      // Commission note: one per sale, with the 20% Creative Sound keeps. It is
      // the record the fee invoice is issued from (not a tax invoice itself).
      await sql`ALTER TABLE producer_earnings ADD COLUMN IF NOT EXISTS fee_number TEXT`;
      await sql`ALTER TABLE producer_earnings ADD COLUMN IF NOT EXISTS fee_cents INTEGER`;
      // Partial refunds and lost disputes take part of a sale back: what was cut so far.
      await sql`ALTER TABLE producer_earnings ADD COLUMN IF NOT EXISTS refund_gross_cents INTEGER NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE producer_earnings ADD COLUMN IF NOT EXISTS refund_share_cents INTEGER NOT NULL DEFAULT 0`;
      await sql`CREATE SEQUENCE IF NOT EXISTS commission_note_seq`;
      await sql`
        UPDATE producer_earnings e SET fee_number = 'CSF-' || to_char(e.created_at, 'YYYY') || '-' || lpad(nextval('commission_note_seq')::text, 6, '0'), fee_cents = e.gross_cents - e.share_cents
        FROM (SELECT id FROM producer_earnings WHERE fee_number IS NULL ORDER BY id) o WHERE e.id = o.id
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS producer_earnings_fee_idx ON producer_earnings (fee_number)`
      await sql`CREATE INDEX IF NOT EXISTS producer_earnings_user_idx ON producer_earnings (user_id, status)`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// Webhook: one earning per producer track in a paid beat order.
async function recordEarnings(session, items) {
  const own = items.filter(({ beat }) => beat.source === 'producer' && beat._userId);
  if (!own.length) return [];
  await ensureTables();
  const currency = session.currency || 'eur';
  const added = [];
  for (const { beat, tier, price } of own) {
    const rows = await sql`
      INSERT INTO producer_earnings (user_id, session_id, payment_intent, beat_id, title, tier, gross_cents, share_cents, currency, fee_number, fee_cents)
      VALUES (${beat._userId}, ${session.id}, ${session.payment_intent || null}, ${beat.id}, ${beat.title}, ${tier}, ${price}, ${shareOf(price)}, ${currency},
        'CSF-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('commission_note_seq')::text, 6, '0'), ${price - shareOf(price)})
      ON CONFLICT (session_id, beat_id) DO NOTHING
      RETURNING id, fee_number
    `;
    if (rows.length) added.push({ userId: beat._userId, beatId: beat.id, title: beat.title, tier, gross: price, share: shareOf(price), fee: price - shareOf(price), feeNumber: rows[0].fee_number });
  }
  // Only the new rows, so a webhook retry never emails the producer twice.
  return added;
}

// "New sale" email to each producer whose track was just bought.
async function emailProducers(sales, { resend, renderEmail, paragraph, button, tierName }) {
  if (!sales || !sales.length) return;
  const siteUrl = process.env.SITE_URL || '';
  const euro = (c) => `€${(c / 100).toFixed(2)}`;
  for (const userId of [...new Set(sales.map((s) => s.userId))]) {
    try {
      const [u] = await sql`SELECT email, first_name FROM users WHERE id = ${userId}`;
      if (!u || !u.email) continue;
      const mine = sales.filter((s) => s.userId === userId);
      const total = mine.reduce((n, s) => n + s.share, 0);
      const html = renderEmail({
        siteUrl,
        preheader: `You earned ${euro(total)} on Creative Sound.`,
        kicker: 'New sale',
        title: mine.length === 1 ? `You sold ${mine[0].title}` : `You sold ${mine.length} licenses`,
        content: [
          paragraph(`Good news${u.first_name ? `, ${u.first_name}` : ''}: someone just licensed your music.`),
          ...mine.map((s) => paragraph(`<b>${s.title}</b> (${tierName(s.tier)}): sold for ${euro(s.gross)}, your 80% is <b>${euro(s.share)}</b>.`)),
          ...mine.filter((s) => s.soldOut).map((s) => paragraph(`<b>${s.title}</b> was licensed with ${tierName(s.tier)}, which leaves all rights with the buyer (no usage limits and no publishing share). It is no longer for sale and has been taken off the store.`)),
          paragraph(`Creative Sound's 20% fee ${mine.length === 1 ? 'is' : 'is recorded'} ${mine.map((s) => (s.feeNumber ? `${euro(s.fee)} on commission note ${s.feeNumber}` : euro(s.fee))).join(', ')}. Your monthly statement and our invoicing details are in your producer area (Tax & statements).`),
          paragraph(`Each sale is on hold for ${HOLD_DAYS} days (refund window), then paid out on the next Monday to the payout method in your producer area.`),
          button(`${siteUrl}/profile-producer.html#payouts`, 'See your payouts'),
        ].join(''),
      });
      const { error } = await resend.emails.send({ from: process.env.FROM_EMAIL, to: u.email, subject: `New sale: you earned ${euro(total)}`, html });
      if (error) console.error('Resend rejected the producer sale email:', error);
    } catch (err) {
      console.error('producer sale email failed:', err);
    }
  }
}

// Money taken back from a sale (refund or lost dispute). Webhook, any number of times:
// every call works out what is still to be taken from the cumulative amount, so a
// retried or repeated event never cuts twice.
//   - not paid yet (pending / on hold): the earning is reduced, or cancelled when the whole sale is gone
//   - paid through Stripe: the transfer is reversed (the producer's balance gives it back)
//   - paid through PayPal, or a reversal that fails: nothing moves, the studio is told how much to recover
//   - a payout being sent right now: the webhook fails so Stripe retries a little later
// "full" = the whole charge is gone. cutTotal = cents taken back so far, out of chargeAmount.
async function takeBack(paymentIntent, chargeAmount, cutTotal, full, why, notify) {
  await ensureTables();
  const rows = await sql`SELECT * FROM producer_earnings WHERE payment_intent = ${paymentIntent} AND status IN ('pending', 'disputed', 'processing', 'paid') ORDER BY id`;
  const lines = [];
  let busy = false;
  for (const r of rows) {
    const origGross = r.gross_cents + r.refund_gross_cents;
    const origShare = r.share_cents + r.refund_share_cents;
    const ratio = chargeAmount > 0 ? Math.min(1, cutTotal / chargeAmount) : 1;
    const wantGross = full ? origGross : Math.min(origGross, Math.floor(origGross * ratio));
    const wantShare = full ? origShare : Math.min(origShare, Math.floor(origShare * ratio));
    const dGross = wantGross - r.refund_gross_cents;
    const dShare = wantShare - r.refund_share_cents;
    // Nothing new to take back (an already adjusted sale), except a full refund still has to close the row.
    if (dGross <= 0 && dShare <= 0 && !(full && r.status !== 'paid')) continue;
    const label = `#${r.id} ${r.title} (user ${r.user_id})`;
    if (r.status === 'processing') { busy = true; continue; }
    const left = origGross - wantGross;
    const leftShare = origShare - wantShare;
    if (r.status === 'pending' || r.status === 'disputed') {
      const done = await sql`
        UPDATE producer_earnings SET gross_cents = ${left}, share_cents = ${leftShare}, fee_cents = ${left - leftShare},
          refund_gross_cents = ${wantGross}, refund_share_cents = ${wantShare}, status = ${full ? 'refunded' : r.status}
        WHERE id = ${r.id} AND status = ${r.status} RETURNING id`;
      if (!done.length) busy = true; // it moved on to a payout in between: try again later
      continue;
    }
    // Paid out already.
    if (r.payout_method === 'stripe' && r.payout_ref && dShare > 0) {
      try {
        await stripe().transfers.createReversal(r.payout_ref, { amount: dShare, description: `${why}: ${r.title}`, metadata: { earning_id: String(r.id) } }, { idempotencyKey: `takeback-${r.id}-${wantShare}` });
        await sql`
          UPDATE producer_earnings SET gross_cents = ${left}, share_cents = ${leftShare}, fee_cents = ${left - leftShare},
            refund_gross_cents = ${wantGross}, refund_share_cents = ${wantShare}, status = ${full ? 'refunded' : 'paid'}
          WHERE id = ${r.id}`;
        lines.push(`${label}: €${(dShare / 100).toFixed(2)} taken back from the producer's Stripe balance.`);
      } catch (err) {
        console.error('transfer reversal failed for earning', r.id, err.message);
        lines.push(`${label}: could NOT reverse the Stripe transfer (${err.message}). Recover €${(dShare / 100).toFixed(2)} from the producer by hand.`);
      }
    } else if (dShare > 0) {
      lines.push(`${label}: already paid through ${r.payout_method || 'unknown'}. Recover €${(dShare / 100).toFixed(2)} from the producer by hand.`);
    }
  }
  if (lines.length && notify) await notify(`${why} on ${paymentIntent}:<br>${lines.join('<br>')}`, `Producer money to recover: ${why.toLowerCase()}`);
  if (busy) throw new Error(`payout in progress for ${paymentIntent}, retry`);
  return rows;
}

// A track a full-rights sale had taken off the store goes back on sale when the sale is cancelled.
async function relist(paymentIntent) {
  try {
    const rows = await sql`SELECT DISTINCT beat_id FROM producer_earnings WHERE payment_intent = ${paymentIntent}`;
    const ids = rows.map((r) => (/^t([0-9]+)-/.exec(String(r.beat_id)) || [])[1]).filter(Boolean).map(Number);
    if (ids.length) await sql`UPDATE beat_submissions SET sold_at = NULL, sold_tier = NULL WHERE id = ANY(${ids}) AND sold_at IS NOT NULL`;
  } catch (err) { console.error('relist after refund failed:', err.message); }
}

// Webhook charge.refunded (fires for partial refunds too; charge.refunded === true when it is all of it).
async function handleRefund(charge, notify) {
  if (!charge || !charge.payment_intent || !(charge.amount_refunded > 0)) return;
  const full = !!charge.refunded || charge.amount_refunded >= charge.amount;
  await takeBack(charge.payment_intent, charge.amount, charge.amount_refunded, full, full ? 'Refund' : 'Partial refund', notify);
  if (full) await relist(charge.payment_intent);
}

// Webhook charge.dispute.created / charge.dispute.closed (a chargeback).
//   created: earnings not paid yet are put on hold; the studio is told, with the paid ones.
//   closed, won: the hold is lifted and they are paid on the next run.
//   closed, lost: the money is taken back like a refund of the disputed amount.
async function handleDispute(dispute, type, notify) {
  if (!dispute) return;
  await ensureTables();
  let pi = dispute.payment_intent;
  let charge = null;
  if (typeof dispute.charge === 'string' && (!pi || type === 'charge.dispute.closed')) {
    charge = await stripe().charges.retrieve(dispute.charge);
    pi = pi || charge.payment_intent;
  }
  if (!pi) return;
  const eur = (c) => `€${(c / 100).toFixed(2)} ${String(dispute.currency || 'eur').toUpperCase()}`;
  if (type === 'charge.dispute.created') {
    const held = await sql`UPDATE producer_earnings SET status = 'disputed' WHERE payment_intent = ${pi} AND status = 'pending' RETURNING id`;
    const paid = await sql`SELECT id, title, user_id, share_cents, payout_method FROM producer_earnings WHERE payment_intent = ${pi} AND status = 'paid'`;
    const processing = await sql`SELECT id FROM producer_earnings WHERE payment_intent = ${pi} AND status = 'processing'`;
    const due = dispute.evidence_details && dispute.evidence_details.due_by ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10) : 'see Stripe';
    const paidNote = paid.length
      ? `Already paid out: ${paid.map((p) => `#${p.id} ${p.title} €${(p.share_cents / 100).toFixed(2)} via ${p.payout_method} (user ${p.user_id})`).join(', ')}. Stripe transfers are taken back automatically only if the dispute is lost.`
      : 'Nothing was paid out yet.';
    if (notify) await notify(`Chargeback opened on ${pi}: ${eur(dispute.amount)}, reason "${dispute.reason}". Send your evidence by ${due} in the Stripe dashboard. ${held.length} earning(s) put on hold. ${paidNote}`, 'Chargeback opened');
    if (processing.length) throw new Error(`payout in progress for ${pi}, retry`);
    return;
  }
  if (type !== 'charge.dispute.closed') return;
  if (dispute.status === 'won' || dispute.status === 'warning_closed') {
    const back = await sql`UPDATE producer_earnings SET status = 'pending' WHERE payment_intent = ${pi} AND status = 'disputed' RETURNING id`;
    if (notify) await notify(`Chargeback on ${pi} closed in your favour (${dispute.status}). ${back.length} earning(s) go back to the next payout run.`, 'Chargeback won');
    return;
  }
  if (dispute.status === 'lost') {
    charge = charge || await stripe().charges.retrieve(dispute.charge);
    const cut = Math.min(charge.amount, (charge.amount_refunded || 0) + dispute.amount);
    const full = cut >= charge.amount;
    await takeBack(pi, charge.amount, cut, full, 'Lost chargeback', notify);
    if (full) await relist(pi);
    // Anything still on hold after a partial loss is released.
    await sql`UPDATE producer_earnings SET status = 'pending' WHERE payment_intent = ${pi} AND status = 'disputed'`;
  }
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
      // A hiccup here must never hide the balances: unknown means no warning.
      taxComplete: await require('./producer-tax').taxComplete(session.uid).catch((err) => { console.error('tax status failed:', err.message); return null; }),
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
  await require('./producer-tax').ensureTax();
  const due = await sql`
    SELECT e.*, u.email, u.payout_method AS method, u.stripe_account_id, u.stripe_payouts_ready, u.paypal_email, t.declared_at AS tax_declared_at, t.declaration_version AS tax_version
    FROM producer_earnings e JOIN users u ON u.id = e.user_id LEFT JOIN producer_tax t ON t.user_id = e.user_id
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
    // Nobody is paid before they have confirmed their tax details.
    if (!u.tax_declared_at || u.tax_version !== require('./producer-tax').VERSION) { report.push(`user ${userId} (${u.email}): €${(total / 100).toFixed(2)} waiting, tax details not confirmed`); continue; }
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
        { const { error: sendError } = await new Resend(process.env.RESEND_API_KEY).emails.send({
          from: process.env.FROM_EMAIL, to: 'hello@creativesound.io', subject: 'Producer payouts',
          html: `<p>Payout run ${new Date().toISOString().slice(0, 10)}:</p><p>${report.map((l) => l.replace(/[<>&]/g, '')).join('<br>')}</p>`,
        }); if (sendError) console.error('payouts email rejected by Resend:', sendError); }
      } catch (err) { console.error('payout report email failed:', err); }
    }
    res.status(200).json({ ok: true, report });
  } catch (err) {
    console.error('payout run error:', err);
    res.status(500).json({ error: 'Payout run failed.' });
  }
}

// Admin health check: are PayPal, Stripe Connect and the cron set up?
// Sends no money (PayPal: only asks for an access token).
//   GET /api/payouts/check
async function handleCheck(req, res) {
  const session = getSession(req);
  if (!session || !isAdmin(session)) { res.status(401).json({ error: 'Sign in with the admin account.' }); return; }
  const out = { cronSecret: !!process.env.CRON_SECRET, paypal: {}, stripe: {} };
  out.paypal.configured = paypalOn();
  out.paypal.mode = process.env.PAYPAL_ENV === 'sandbox' ? 'sandbox' : 'live';
  if (out.paypal.configured) {
    try {
      await paypalToken();
      out.paypal.ok = true;
    } catch (err) {
      out.paypal.ok = false;
      out.paypal.error = err.message;
    }
  }
  out.stripe.configured = !!process.env.STRIPE_SECRET_KEY;
  if (out.stripe.configured) {
    try {
      await stripe().accounts.list({ limit: 1 });
      out.stripe.connect = true;
    } catch (err) {
      out.stripe.connect = false;
      out.stripe.error = err.message;
    }
  }
  // Email (Resend): is the sending domain of FROM_EMAIL verified? With
  // ?test=1 a test email goes to the signed-in admin.
  const from = String(process.env.FROM_EMAIL || '');
  const fromDomain = (from.match(/@([^>\s]+)/) || [])[1] || '';
  out.email = { from, domain: fromDomain, apiKey: !!process.env.RESEND_API_KEY };
  if (process.env.RESEND_API_KEY) {
    try {
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
      const d = await r.json().catch(() => ({}));
      const dom = (d.data || []).find((x) => x.name === fromDomain);
      if (r.status === 401 || r.status === 403) {
        // Sending-only API key (recommended): it can't list domains. Use ?test=1 to check delivery.
        out.email.domainStatus = 'sending-only key (domain list not readable)';
        out.email.ok = null;
      } else {
        out.email.domainStatus = dom ? dom.status : (r.ok ? 'not added to Resend' : `Resend ${r.status}`);
        out.email.ok = !!dom && dom.status === 'verified';
      }
    } catch (err) {
      out.email.ok = false;
      out.email.error = err.message;
    }
    if (req.query && req.query.test === '1') {
      try {
        const tpl = require('./emailTemplate');
        const { Resend } = require('resend');
        const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
          from, to: session.email, subject: 'Creative Sound test email',
          html: tpl.renderEmail({ siteUrl: process.env.SITE_URL || 'https://creativesound.io', preheader: 'Delivery test', kicker: 'Test', title: 'Emails are working', content: tpl.paragraph('If you can read this in your inbox (not spam), delivery from the site works.') }),
        });
        out.email.test = error ? `failed: ${error.message || JSON.stringify(error)}` : `sent (id ${data && data.id})`;
      } catch (err) {
        out.email.test = `failed: ${err.message}`;
      }
    }
  }
  // Dropbox (producer uploads, profile photos, track files).
  const dropbox = require('./dropbox');
  out.dropbox = { configured: dropbox.configured() };
  // Length only (never the value): a refresh token is ~60+ characters, an authorization code ~43.
  out.dropbox.tokenLength = String(process.env.DROPBOX_REFRESH_TOKEN || '').trim().replace(/^['"]+|['",]+$/g, '').length;
  if (out.dropbox.configured) {
    try {
      Object.assign(out.dropbox, await dropbox.check());
      // Real read test: a download link for the newest uploaded preview.
      try {
        const [row] = await sql`SELECT files FROM beat_submissions WHERE files ? 'preview' ORDER BY id DESC LIMIT 1`;
        const path = row && row.files && row.files.preview && row.files.preview.path;
        if (path) {
          try { await dropbox.readLink(path); out.dropbox.canRead = true; } catch (err) { out.dropbox.canRead = false; out.dropbox.readError = String(err.message).slice(0, 220); }
        }
      } catch (err) { /* no uploads table yet */ }
    } catch (err) {
      out.dropbox.ok = false;
      out.dropbox.error = err.message.slice(0, 200);
    }
  }
  res.status(200).json(out);
}

module.exports = { ensureTables, handleCheck, SHARE, recordEarnings, emailProducers, handleRefund, handleDispute, handlePayouts, handleRun };
