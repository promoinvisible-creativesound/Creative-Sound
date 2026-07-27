const crypto = require('crypto');
const { Resend } = require('resend');
const { sql } = require('../_lib/db');

const resend = new Resend(process.env.RESEND_API_KEY);
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email } = req.body || {};
  if (!email) {
    res.status(400).json({ error: 'Email is required.' });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const [user] = await sql`SELECT id, email FROM users WHERE email = ${normalizedEmail}`;

    // Always respond the same way whether or not the account exists, so this
    // endpoint can't be used to check which emails have accounts.
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      await sql`
        INSERT INTO password_resets (user_id, token, expires_at)
        VALUES (${user.id}, ${token}, ${expiresAt.toISOString()})
      `;

      const siteUrl = process.env.SITE_URL || `https://${req.headers.host}`;
      const resetUrl = `${siteUrl}/reset-password.html?token=${token}`;

      await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: user.email,
        subject: 'Reset your Creative Sound password',
        html: `
          <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;">
            <h1 style="color:#FFB347;font-size:20px;">Reset your password</h1>
            <p>Someone (hopefully you) asked to reset the password on this account.</p>
            <p style="margin-top:24px;">
              <a href="${resetUrl}" style="display:inline-block;background:#e8862c;color:#0a0a09;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;">Choose a new password</a>
            </p>
            <p style="margin-top:24px;color:#8a877e;font-size:13px;">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
          </div>
        `,
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
