const Stripe = require('stripe');
const { Resend } = require('resend');

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

function generateLicenseKey() {
  const segment = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CD-${segment()}-${segment()}-${segment()}`;
}

function buildEmailHtml(licenseKey) {
  const downloadUrl = process.env.DOWNLOAD_URL;
  const downloadBlock = downloadUrl
    ? `<a href="${downloadUrl}" style="display:inline-block;background:#e8862c;color:#0a0a09;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;">Download Creative Dist</a>`
    : `<p>We're finishing up your build — you'll get a separate email with the download link very shortly. If you don't hear from us within 24h, just reply to this email.</p>`;

  return `
    <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;">
      <h1 style="color:#FFB347;font-size:22px;">Thanks for grabbing Creative Dist</h1>
      <p>Your license key:</p>
      <p style="font-family:monospace;font-size:18px;letter-spacing:1px;background:#0d0d0c;border:1px solid rgba(255,255,255,0.18);padding:12px 16px;border-radius:8px;display:inline-block;">${licenseKey}</p>
      <p style="margin-top:28px;">${downloadBlock}</p>
      <p style="margin-top:32px;color:#8a877e;font-size:13px;">Creative Sound — sound tools by Invisible</p>
    </div>
  `;
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
      const licenseKey = generateLicenseKey();
      try {
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: email,
          subject: 'Your Creative Dist license',
          html: buildEmailHtml(licenseKey),
        });
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
