// "Notify me" sign-ups for things that aren't out yet (first use: sample
// packs on packs.html). Stores one row per email + topic and tells the
// studio inbox about each new sign-up. Nothing is sent to the subscriber
// now; the list is used once, when the topic launches.
const { Resend } = require('resend');
const { sql } = require('./_lib/db');

const resend = new Resend(process.env.RESEND_API_KEY);
const TOPICS = { 'sample-packs': 'Sample packs' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS notify_signups (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          topic TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_notify_signups_email_topic ON notify_signups (lower(email), topic)`;
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  // Honeypot: real visitors never see or fill this field.
  if (body.website) {
    res.status(200).json({ ok: true });
    return;
  }

  const email = String(body.email || '').trim();
  const topic = String(body.topic || '');
  if (!TOPICS[topic]) {
    res.status(400).json({ error: 'Unknown topic.' });
    return;
  }
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    res.status(400).json({ error: 'Please enter a valid email address.' });
    return;
  }

  let isNew = false;
  try {
    await ensureTable();
    const rows = await sql`
      INSERT INTO notify_signups (email, topic)
      VALUES (${email}, ${topic})
      ON CONFLICT ((lower(email)), topic) DO NOTHING
      RETURNING id
    `;
    isNew = rows.length > 0;
  } catch (err) {
    console.error('notify signup error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
    return;
  }

  if (isNew) {
    try {
      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: 'hello@creativesound.io',
        subject: `Notify me: ${TOPICS[topic]} — ${email}`,
        html: `
          <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;">
            <h1 style="color:#FFB347;font-size:18px;">New "notify me" sign-up</h1>
            <p><strong>Topic:</strong> ${escapeHtml(TOPICS[topic])}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p style="color:#8a877e;font-size:13px;">Stored in the notify_signups table.</p>
          </div>
        `,
      });
      if (error) console.error('notify owner email error:', error);
    } catch (err) {
      // The sign-up is saved either way; the inbox ping is a convenience.
      console.error('notify owner email error:', err);
    }
  }

  res.status(200).json({ ok: true });
};
