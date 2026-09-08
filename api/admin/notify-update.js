const { Resend } = require('resend');
const { sql } = require('../_lib/db');

const resend = new Resend(process.env.RESEND_API_KEY);

function buildUpdateEmailHtml() {
  const siteUrl = process.env.SITE_URL || '';
  const btn = (href, label) => `<a href="${href}" style="display:inline-block;background:#e8862c;color:#0a0a09;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:0 8px 8px 0;">${label}</a>`;

  return `
    <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;">
      <h1 style="color:#FFB347;font-size:22px;">Important fix for your Creative Dist 2.0 build</h1>
      <p>The installer you downloaded was missing the latest 2.0 update. It's fixed now &mdash; the current build includes <strong>Flux</strong>, a new module that blends two algorithms into one and morphs between them in real time, plus refinements across Saturation and Bode Shifter.</p>
      <p>Please re-download and reinstall using the links below, free of charge, with your existing license key:</p>
      <p style="margin-top:20px;">
        ${btn(`${siteUrl}/assets/downloads/Creative-Dist-Mac.zip`, 'Download for macOS')}
        ${btn(`${siteUrl}/assets/downloads/Creative-Dist-Windows.zip`, 'Download for Windows')}
      </p>
      <p style="margin-top:28px;">You can also always grab the current build from your account:
        <a href="${siteUrl}/profile-license.html" style="color:#FFB347;">${siteUrl}/profile-license.html</a>
      </p>
      <p style="margin-top:32px;color:#8a877e;font-size:13px;">Creative Sound — sound tools by Invisible</p>
    </div>
  `;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const auth = req.headers['x-admin-secret'];
  if (!auth || auth !== process.env.ADMIN_TASK_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const dryRun = req.query && req.query.dryRun === '1';

  try {
    const rows = await sql`SELECT DISTINCT email FROM licenses ORDER BY email`;
    const emails = rows.map((r) => r.email);

    if (dryRun) {
      res.status(200).json({ dryRun: true, count: emails.length, emails });
      return;
    }

    const results = [];
    for (const email of emails) {
      try {
        const { error } = await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: email,
          subject: 'Important fix for Creative Dist 2.0 — update your installer now',
          html: buildUpdateEmailHtml(),
        });
        results.push({ email, ok: !error, error: error ? error.message : null });
      } catch (err) {
        results.push({ email, ok: false, error: err.message });
      }
    }

    const failures = results.filter((r) => !r.ok);
    res.status(200).json({ total: results.length, sent: results.length - failures.length, failed: failures.length, failures });
  } catch (err) {
    console.error('notify-update error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};
