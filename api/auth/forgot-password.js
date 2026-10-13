const crypto = require('crypto');
const { Resend } = require('resend');
const { sql } = require('../_lib/db');
const tpl = require('../_lib/emailTemplate');

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

      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: user.email,
        subject: 'Reset your Creative Sound password',
        html: tpl.renderEmail({
          siteUrl,
          preheader: 'Choose a new password for your Creative Sound account.',
          kicker: 'Security',
          title: 'Reset your password',
          content: [
            tpl.paragraph('Someone (hopefully you) asked to reset the password on this account.'),
            `<div style="margin-top:22px;">${tpl.button(resetUrl, 'Choose a new password')}</div>`,
            tpl.paragraph('<span style="color:#8e8e93;font-size:13.5px;">This link expires in 1 hour. If you didn\'t request this, you can ignore this email.</span>'),
          ].join(''),
        }),
      });
      // Resend returns { data, error } rather than throwing on API-level
      // failures (e.g. an unverified sending domain), so this has to be
      // checked explicitly or a failed send silently looks successful.
      if (error) {
        console.error('resend send error:', error);
        res.status(500).json({ error: 'Something went wrong, please try again.' });
        return;
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
