const crypto = require('crypto');
const { Resend } = require('resend');
const { sql } = require('./db');
const tpl = require('./emailTemplate');

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
    html: tpl.renderEmail({
      siteUrl: process.env.SITE_URL || 'https://creativesound.io',
      preheader: `Your code is ${code}`,
      kicker: 'Confirm your email',
      title: 'Your confirmation code',
      content: [
        tpl.paragraph('Enter this code to finish creating your Creative Sound account:'),
        `<div style="margin:22px 0 4px;padding:18px;border-radius:16px;background:#0f0e0d;border:1px solid #2a2826;text-align:center;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:36px;font-weight:700;letter-spacing:10px;color:#f5b06a;">${code}</div>`,
        tpl.paragraph('<span style="color:#8e8e93;font-size:13.5px;">This code expires in 15 minutes. If you didn\'t create this account, you can ignore this email.</span>'),
      ].join(''),
    }),
  });
  if (error) {
    console.error('resend send error:', error);
    throw new Error('Could not send the confirmation email. Please try again shortly.');
  }
}

module.exports = { sendVerificationCode };
