const { sql } = require('../_lib/db');
const { getSession } = require('../_lib/auth');

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

  const { code } = req.body || {};
  if (!code) {
    res.status(400).json({ error: 'Enter the code from your email.' });
    return;
  }

  try {
    const [user] = await sql`
      SELECT verification_code, verification_expires_at, email_verified FROM users WHERE id = ${session.uid}
    `;
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }

    if (user.email_verified) {
      res.status(200).json({ ok: true });
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
