const Stripe = require('stripe');
const { Resend } = require('resend');
const { sql } = require('./_lib/db');
const { generateLicenseKey } = require('./_lib/license');
const { PACKS, downloadUrl, ensureTable, classifySession } = require('./_lib/packs');
const { renderEmail, button, codeBlock, steps, paragraph, accountLine } = require('./_lib/emailTemplate');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Vercel parses the body as JSON by default, but Stripe's signature check
// needs the exact raw bytes that were sent — this route reads them itself.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function buildEmailHtml(licenseKey) {
  const siteUrl = process.env.SITE_URL || '';
  const content = [
    paragraph('Thanks for grabbing Creative Dist 2.0. Your license key and the installers are below.'),
    codeBlock('License key', licenseKey),
    '<div style="margin-top:22px;">',
    button(`${siteUrl}/assets/downloads/Creative-Dist-Mac.zip`, 'Download for macOS'),
    button(`${siteUrl}/assets/downloads/Creative-Dist-Windows.zip`, 'Download for Windows'),
    '</div>',
    steps([
      'Download the installer for your system and run it.',
      'Open Creative Dist in your DAW. On first launch, paste your license key into the activation screen.',
      'Keep this email. Your key and downloads also live in your account.',
    ]),
    accountLine(siteUrl),
  ].join('');
  return renderEmail({
    siteUrl,
    preheader: 'Your Creative Dist license key and downloads.',
    kicker: 'Order confirmed',
    title: 'Your license',
    content,
  });
}

// A pack checkout gets an email with that pack's download link and nothing
// else: no license key and no Creative Dist installer. The purchase row is
// what later unlocks the download in the buyer's account.
function buildPackEmailHtml(packName, url) {
  const siteUrl = process.env.SITE_URL || '';
  const content = [
    paragraph(`Thanks for grabbing ${packName}. Your download is ready.`),
    '<div style="margin-top:22px;">',
    button(url, 'Download pack'),
    '</div>',
    steps([
      'Download the zip file with the button above.',
      'Unzip it and copy the preset folder into your Serum presets folder.',
      'Restart Serum, open the preset browser and start with a fresh sound.',
    ]),
    paragraph('You can also download this pack any time from your account, under Your packs.'),
    accountLine(siteUrl),
  ].join('');
  return renderEmail({
    siteUrl,
    preheader: `Your ${packName} download is ready.`,
    kicker: 'Download ready',
    title: packName,
    content,
  });
}

async function handlePackPurchase(session, email, packId) {
  const pack = PACKS[packId];
  const url = downloadUrl(packId);
  if (!url) {
    // Misconfigured deployment: fail so Stripe retries once the env var is set.
    throw new Error(`No download URL configured for ${packId} (${pack.urlEnv}).`);
  }
  await ensureTable();
  await sql`
    INSERT INTO pack_purchases (email, pack_id, stripe_session_id, amount_total, currency)
    VALUES (${email}, ${packId}, ${session.id}, ${session.amount_total || null}, ${session.currency || null})
    ON CONFLICT (stripe_session_id) DO NOTHING
  `;

  try {
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: `Your ${pack.name} download`,
      html: buildPackEmailHtml(pack.name, url),
    });
    if (error) console.error('Resend rejected the pack email:', error);
  } catch (err) {
    // The purchase is saved and the pack shows up in the account already.
    console.error('Failed to send pack email:', err);
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const signature = req.headers['stripe-signature'];
  const rawBody = await readRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details && session.customer_details.email;

    if (email) {
      const normalizedEmail = email.trim().toLowerCase();

      // Decide what was bought. A license is only ever minted for Creative
      // Dist: packs never get one, and a free checkout we can't identify
      // doesn't fall through to one either.
      let kind = { kind: 'unknown' };
      let lookupFailed = false;
      try {
        kind = await classifySession(stripe, session);
      } catch (err) {
        lookupFailed = true;
        console.error('Payment link lookup failed:', err);
      }

      if (kind.kind === 'pack') {
        console.log('checkout', session.id, 'pack', kind.packId);
        try {
          await handlePackPurchase(session, normalizedEmail, kind.packId);
        } catch (err) {
          console.error('Failed to record pack purchase, asking Stripe to retry:', err);
          res.status(500).json({ error: 'Temporary error, please retry.' });
          return;
        }
        res.status(200).json({ received: true });
        return;
      }

      if (kind.kind !== 'dist' && !(session.amount_total > 0)) {
        if (lookupFailed) {
          // Free checkout and Stripe couldn't tell us which product: retry later.
          res.status(500).json({ error: 'Temporary error, please retry.' });
          return;
        }
        console.error('Unrecognised free checkout, no email sent:', session.id, session.payment_link, session.client_reference_id);
        try {
          await resend.emails.send({
            from: process.env.FROM_EMAIL,
            to: 'hello@creativesound.io',
            subject: 'Unrecognised free checkout',
            html: `<p>A free checkout from ${normalizedEmail} did not match any known pack or product, so no email was sent to the buyer.</p><p>Stripe session: ${session.id}<br>Payment link: ${session.payment_link || 'none'}<br>client_reference_id: ${session.client_reference_id || 'none'}</p>`,
          });
        } catch (err) {
          console.error('Failed to send the unrecognised-checkout alert:', err);
        }
        res.status(200).json({ received: true });
        return;
      }

      // Creative Dist (or a paid checkout we couldn't classify): license flow.
      console.log('checkout', session.id, 'creative-dist license');
      let licenseKey;
      try {
        // Idempotent against Stripe webhook retries: reuse the license
        // already tied to this checkout session instead of minting a new one.
        const [existing] = await sql`SELECT license_key FROM licenses WHERE stripe_session_id = ${session.id}`;
        if (existing) {
          licenseKey = existing.license_key;
        } else {
          licenseKey = generateLicenseKey();
          await sql`
            INSERT INTO licenses (email, license_key, stripe_session_id, amount_total, currency)
            VALUES (${normalizedEmail}, ${licenseKey}, ${session.id}, ${session.amount_total || null}, ${session.currency || null})
          `;
        }
      } catch (err) {
        // Don't email a license key that was never actually saved — that
        // leaves the customer holding a key their account can't find. Fail
        // the webhook instead so Stripe retries it (its own idempotent
        // "existing" lookup above means a retry is safe and self-healing).
        console.error('Failed to persist license, asking Stripe to retry:', err);
        res.status(500).json({ error: 'Temporary error, please retry.' });
        return;
      }

      try {
        // The Resend SDK returns { data, error } instead of throwing on
        // API-level failures (bad key, unverified domain, ...) — without
        // this check a failed send looked identical to a successful one.
        const { error } = await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: email,
          subject: 'Your Creative Dist license',
          html: buildEmailHtml(licenseKey),
        });
        if (error) {
          console.error('Resend rejected the license email:', error);
        }
      } catch (err) {
        // Payment already succeeded — log for manual follow-up rather than
        // failing the webhook (Stripe would otherwise retry the charge event).
        console.error('Failed to send license email:', err);
      }
    } else {
      console.error('checkout.session.completed with no customer email:', session.id);
    }
  }

  res.status(200).json({ received: true });
};
