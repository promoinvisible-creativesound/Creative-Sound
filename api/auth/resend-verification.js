const { sql } = require('../_lib/db');
const { getSession } = require('../_lib/auth');
const { sendVerificationCode } = require('../_lib/verification');

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

  try {
    const [user] = await sql`SELECT email, email_verified FROM users WHERE id = ${session.uid}`;
    if (!user) {
      res.status(401).json({ error: 'Not signed in.' });
      return;
    }

    if (!user.email_verified) {
      await sendVerificationCode(session.uid, user.email);
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('resend-verification error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
