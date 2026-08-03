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

  await resend.emails.send({
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
}

module.exports = { sendVerificationCode };
