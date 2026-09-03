// TEMPORARY — one-off manual license grant, to be removed right after use.
// Runs server-side so it can use CREATIVEDIST_PRIVATE_KEY (a Sensitive env
// var, unreadable from the Vercel dashboard) without that value ever having
// to be copied/pasted anywhere.
const { sql } = require('./_lib/db');
const { generateLicenseKey } = require('./_lib/license');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_TOKEN = '67cc985f5462d8b3b4df5e8c4afadd47';

function buildEmailHtml(licenseKey) {
  const downloadUrl = process.env.DOWNLOAD_URL;
  const downloadBlock = downloadUrl
    ? `<a href="${downloadUrl}" style="display:inline-block;background:#e8862c;color:#0a0a09;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;">Download Creative Dist</a>`
    : `<p>We're finishing up your build — you'll get a separate email with the download link very shortly. If you don't hear from us within 24h, just reply to this email.</p>`;

  return `
    <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;">
      <h1 style="color:#FFB347;font-size:22px;">Thanks for grabbing Creative Dist</h1>
      <p>Your license key:</p>
      <p style="font-family:monospace;font-size:16px;letter-spacing:1px;background:#0d0d0c;border:1px solid rgba(255,255,255,0.18);padding:12px 16px;border-radius:8px;display:inline-block;word-break:break-all;">${licenseKey}</p>
      <p style="margin-top:28px;">${downloadBlock}</p>
      <p style="margin-top:24px;">
        Create an account with this same email to find your license and download
        link any time from your profile:
        <a href="${process.env.SITE_URL || ''}/signup.html" style="color:#FFB347;">${process.env.SITE_URL || ''}/signup.html</a>
      </p>
      <p style="margin-top:32px;color:#8a877e;font-size:13px;">Creative Sound — sound tools by Invisible</p>
    </div>
  `;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email, token, replaceOldKey } = req.body || {};
  if (token !== ADMIN_TOKEN) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!email) {
    res.status(400).json({ error: 'email required' });
    return;
  }

  try {
    if (replaceOldKey) {
      await sql`DELETE FROM licenses WHERE email = ${email} AND license_key = ${replaceOldKey}`;
    }

    const licenseKey = generateLicenseKey();
    await sql`
      INSERT INTO licenses (email, license_key, stripe_session_id, amount_total, currency)
      VALUES (${email}, ${licenseKey}, NULL, 2500, 'eur')
    `;

    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: 'Your Creative Dist license',
      html: buildEmailHtml(licenseKey),
    });

    if (error) {
      res.status(500).json({ error: 'license saved but email failed', detail: error, licenseKey });
      return;
    }

    res.status(200).json({ ok: true, licenseKey });
  } catch (err) {
    console.error('admin-grant-license error:', err);
    res.status(500).json({ error: err.message });
  }
};
