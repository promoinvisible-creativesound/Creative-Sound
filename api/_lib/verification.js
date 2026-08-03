const crypto = require('crypto');
const { Resend } = require('resend');
const { sql } = require('./db');

const resend = new Resend(process.env.RESEND_API_KEY);
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function sendVerificationCode(userId, email) {
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await sql`
    UPDATE users SET verification_code = ${code}, verification_expires_at = ${expiresAt.toISOString()}
    WHERE id = ${userId}
  `;

  // The Resend SDK returns { data, error } instead of throwing on API-level
  // failures (e.g. an unverified sending domain) — without this check a
  // failed send looks identical to a successful one and the caller has no
  // way to know the code never actually reached the user.
  const { error } = await resend.emails.send({
    from: process.env.FROM_EMAIL,
    to: email,
    subject: `${code} — confirm your Creative Sound account`,
    html: `
      <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;">
        <h1 style="color:#FFB347;font-size:20px;">Confirm your account</h1>
        <p>Enter this code to finish creating your Creative Sound account:</p>
        <p style="margin:24px 0;font-family:'DejaVu Sans Mono',Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#e8862c;">${code}</p>
        <p style="color:#8a877e;font-size:13px;">This code expires in 15 minutes. If you didn't create this account, you can ignore this email.</p>
      </div>
    `,
  });
  if (error) {
    console.error('resend send error:', error);
    throw new Error('Could not send the confirmation email. Please try again shortly.');
  }
}

module.exports = { sendVerificationCode };
