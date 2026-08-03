const { sql } = require('../_lib/db');
const { getSession } = require('../_lib/auth');
const { sendVerificationCode } = require('../_lib/verification');

// Handles both verifying a code and resending one — kept in a single
// function (instead of two) to stay under Vercel's Hobby-plan cap of 12
// Serverless Functions per deployment.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }

  const { code, resend } = req.body || {};

  try {
    const [user] = await sql`
      SELECT email, verification_code, verification_expires_at, email_verified FROM users WHERE id = ${session.uid}
    `;
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }

    if (resend) {
      if (!user.email_verified) {
        await sendVerificationCode(session.uid, user.email);
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (user.email_verified) {
      res.status(200).json({ ok: true });
      return;
    }

    if (!code) {
      res.status(400).json({ error: 'Enter the code from your email.' });
      return;
    }

    if (
      !user.verification_code ||
      String(code).trim() !== user.verification_code ||
      new Date(user.verification_expires_at) < new Date()
    ) {
      res.status(400).json({ error: 'That code is incorrect or has expired. Request a new one.' });
      return;
    }

    await sql`
      UPDATE users SET email_verified = true, verification_code = NULL, verification_expires_at = NULL
      WHERE id = ${session.uid}
    `;
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('verify-email error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
