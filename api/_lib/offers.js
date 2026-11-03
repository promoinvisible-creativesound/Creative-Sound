// Offers: a buyer proposes a lower price for one license of a producer's track; the producer
// accepts or declines. An accepted offer is a price the buyer can pay for 72 hours (checkout
// reads it, see _lib/beats.js). Offers never stack with the other discounts.
//   GET  /api/beats/offers                 -> { made: [...], received: [...] }  (signed in)
//   POST /api/beats/offers { do: 'make' | 'decide' | 'cancel', ... }
const { Resend } = require('resend');
const { sql } = require('./db');
const { getSession } = require('./auth');
const tpl = require('./emailTemplate');

const MIN_CENTS = 500;        // never below €5
const MIN_SHARE = 0.5;        // at least half of the price
const MAX_PENDING = 5;        // open offers per buyer
const PENDING_DAYS = 7;       // an unanswered offer lapses
const VALID_HOURS = 72;       // an accepted offer can be paid for this long

let ready = null;
function ensureTable() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS beat_offers (
        id SERIAL PRIMARY KEY, submission_id INTEGER NOT NULL, beat_id TEXT NOT NULL, buyer_id INTEGER NOT NULL, buyer_email TEXT NOT NULL,
        producer_id INTEGER NOT NULL, tier TEXT NOT NULL, list_cents INTEGER NOT NULL, offer_cents INTEGER NOT NULL, message TEXT,
        status TEXT NOT NULL DEFAULT 'pending', note TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, used_at TIMESTAMPTZ)`;
      await sql`CREATE INDEX IF NOT EXISTS beat_offers_buyer_idx ON beat_offers (buyer_id)`;
      await sql`CREATE INDEX IF NOT EXISTS beat_offers_producer_idx ON beat_offers (producer_id)`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

// The status a person sees: pending and accepted offers lapse on their own.
const effective = (o) => {
  const now = Date.now();
  if (o.status === 'pending' && now - new Date(o.created_at).getTime() > PENDING_DAYS * 864e5) return 'expired';
  if (o.status === 'accepted' && o.expires_at && new Date(o.expires_at).getTime() < now) return 'expired';
  return o.status;
};

const shape = (o, who) => ({
  id: o.id, beatId: o.beat_id, title: o.title || 'Track', tier: o.tier, listCents: o.list_cents, offerCents: o.offer_cents,
  message: o.message || '', note: o.note || '', status: effective(o), createdAt: o.created_at, expiresAt: o.expires_at,
  who: who === 'buyer' ? (o.buyer_name || 'A buyer') : (o.producer_name || 'Producer'),
});

async function mail(to, subject, preheader, kicker, title, body, cta) {
  try {
    if (!to || !process.env.RESEND_API_KEY) return;
    const resend = new Resend(process.env.RESEND_API_KEY);
    const site = process.env.SITE_URL || 'https://creativesound.io';
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL, to, replyTo: 'hello@creativesound.io', subject,
      html: tpl.renderEmail({ siteUrl: site, preheader, kicker, title, content: [tpl.paragraph(body), `<div style="margin-top:22px;">${tpl.button(`${site}/profile-offers.html`, cta)}</div>`].join('') }),
    });
    if (error) console.error('offer email error:', error);
  } catch (err) { console.error('offer email error:', err); }
}

const euro = (c) => `€${(c / 100).toFixed(2)}`;
const money = (v) => Math.round(Number(String(v).replace(',', '.')) * 100);

async function list(uid) {
  const made = await sql`SELECT o.*, s.title, s.producer_name FROM beat_offers o LEFT JOIN beat_submissions s ON s.id = o.submission_id WHERE o.buyer_id = ${uid} ORDER BY o.created_at DESC LIMIT 100`;
  const received = await sql`SELECT o.*, s.title, u.display_name AS buyer_name FROM beat_offers o LEFT JOIN beat_submissions s ON s.id = o.submission_id LEFT JOIN users u ON u.id = o.buyer_id WHERE o.producer_id = ${uid} ORDER BY o.created_at DESC LIMIT 100`;
  return { made: made.map((o) => shape(o, 'producer')), received: received.map((o) => shape(o, 'buyer')) };
}

async function handleOffers(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Sign in to make or see offers.' }); return; }
  try {
    await ensureTable();
    if (req.method === 'GET') { res.status(200).json(await list(session.uid)); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
    const b = req.body || {};

    if (b.do === 'make') {
      const { getBeat } = require('./catalogue');
      const beat = await getBeat(String(b.beatId || ''));
      if (!beat || beat._submissionId == null || beat._userId == null || beat._sold) { res.status(400).json({ error: 'You can make offers on tracks from producers that are on sale.' }); return; }
      if (beat._userId === session.uid) { res.status(400).json({ error: 'This is your own track.' }); return; }
      const tier = String(b.tier || '');
      const list_cents = beat.prices && beat.prices[tier];
      if (!Number.isInteger(list_cents) || list_cents <= 0) { res.status(400).json({ error: 'Pick one of the licenses of the track.' }); return; }
      const cents = money(b.amount);
      const floor = Math.max(MIN_CENTS, Math.ceil(list_cents * MIN_SHARE));
      if (!Number.isFinite(cents) || cents < floor) { res.status(400).json({ error: `The lowest offer for this license is ${euro(floor)}.` }); return; }
      if (cents >= list_cents) { res.status(400).json({ error: `The price is ${euro(list_cents)}: offer less, or just buy it.` }); return; }
      const open = await sql`SELECT id, beat_id, created_at, status FROM beat_offers WHERE buyer_id = ${session.uid} AND status = 'pending'`;
      const live = open.filter((o) => effective({ ...o }) === 'pending');
      if (live.length >= MAX_PENDING) { res.status(400).json({ error: `You have ${MAX_PENDING} offers waiting for an answer. Wait for a reply first.` }); return; }
      if (live.some((o) => o.beat_id === beat.id)) { res.status(400).json({ error: 'You already have an offer waiting on this track.' }); return; }
      const message = String(b.message || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      const [row] = await sql`
        INSERT INTO beat_offers (submission_id, beat_id, buyer_id, buyer_email, producer_id, tier, list_cents, offer_cents, message)
        VALUES (${beat._submissionId}, ${beat.id}, ${session.uid}, ${session.email}, ${beat._userId}, ${tier}, ${list_cents}, ${cents}, ${message || null}) RETURNING id`;
      const [prod] = await sql`SELECT email FROM beat_submissions WHERE id = ${beat._submissionId}`;
      await mail(prod && prod.email, `New offer on ${beat.title}: ${euro(cents)}`, `Someone offered ${euro(cents)} for ${beat.title}.`, 'New offer',
        `${euro(cents)} offered for ${beat.title}`, `A buyer offered ${tpl.esc(euro(cents))} for a license of ${tpl.esc(beat.title)} (listed at ${tpl.esc(euro(list_cents))}).${message ? ` They wrote: “${tpl.esc(message)}”.` : ''} You earn 80% of the price they pay. Accept or decline from your offers page; it lapses in ${PENDING_DAYS} days.`, 'See the offer');
      res.status(200).json({ ok: true, id: row.id, ...(await list(session.uid)) });
      return;
    }

    const id = Number(b.id);
    if (!Number.isInteger(id)) { res.status(400).json({ error: 'Unknown offer.' }); return; }
    const [o] = await sql`SELECT o.*, s.title FROM beat_offers o LEFT JOIN beat_submissions s ON s.id = o.submission_id WHERE o.id = ${id}`;

    if (b.do === 'decide') {
      if (!o || o.producer_id !== session.uid) { res.status(404).json({ error: 'Offer not found.' }); return; }
      if (effective(o) !== 'pending') { res.status(409).json({ error: 'This offer is no longer open.' }); return; }
      const accept = b.accept === true;
      const note = String(b.note || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      await sql`UPDATE beat_offers SET status = ${accept ? 'accepted' : 'declined'}, note = ${note || null}, decided_at = now(),
        expires_at = ${accept ? new Date(Date.now() + VALID_HOURS * 36e5).toISOString() : null} WHERE id = ${id}`;
      await mail(o.buyer_email, accept ? `Offer accepted: ${o.title}` : `Offer declined: ${o.title}`,
        accept ? `You can buy ${o.title} for ${euro(o.offer_cents)} for the next ${VALID_HOURS} hours.` : 'The producer passed on this one.',
        accept ? 'Offer accepted' : 'Offer declined', accept ? `Your ${euro(o.offer_cents)} offer was accepted` : `Your offer on ${o.title} was declined`,
        accept ? `The producer accepted ${tpl.esc(euro(o.offer_cents))} for ${tpl.esc(o.title)}. The price is yours for ${VALID_HOURS} hours: open your offers and check out.${note ? ` They wrote: “${tpl.esc(note)}”.` : ''}`
          : `The producer declined your offer for ${tpl.esc(o.title)}.${note ? ` They wrote: “${tpl.esc(note)}”.` : ''} The track is still available at the listed price.`, accept ? 'Buy at your price' : 'See your offers');
      res.status(200).json(await list(session.uid));
      return;
    }
    if (b.do === 'cancel') {
      if (!o || o.buyer_id !== session.uid) { res.status(404).json({ error: 'Offer not found.' }); return; }
      if (!['pending', 'accepted'].includes(o.status)) { res.status(409).json({ error: 'This offer is already closed.' }); return; }
      await sql`UPDATE beat_offers SET status = 'cancelled', decided_at = now() WHERE id = ${id}`;
      res.status(200).json(await list(session.uid));
      return;
    }
    res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error('offers error:', err);
    res.status(500).json({ error: 'Could not save. Please try again.' });
  }
}

// Checkout: an accepted, still valid offer of this buyer for this track and license.
async function redeemable(offerId, uid, beatId, tier) {
  await ensureTable();
  const [o] = await sql`SELECT * FROM beat_offers WHERE id = ${Number(offerId)} AND buyer_id = ${uid}`;
  if (!o || o.status !== 'accepted' || effective(o) !== 'accepted' || o.beat_id !== beatId || o.tier !== tier) return null;
  return o;
}
const markPaid = async (ids) => {
  const list = (ids || []).map(Number).filter(Number.isInteger);
  if (!list.length) return;
  await ensureTable();
  await sql`UPDATE beat_offers SET status = 'paid', used_at = now() WHERE id = ANY(${list}::int[]) AND status = 'accepted'`;
};

module.exports = { handleOffers, redeemable, markPaid, effective, MIN_SHARE, MIN_CENTS };
