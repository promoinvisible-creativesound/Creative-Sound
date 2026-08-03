const bcrypt = require('bcryptjs');
const { sql } = require('../_lib/db');
const { signToken, setSessionCookie } = require('../_lib/auth');
const { sendVerificationCode } = require('../_lib/verification');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email, password } = req.body || {};
  if (!email || !password || String(password).length < 8) {
    res.status(400).json({ error: 'Email and a password of at least 8 characters are required.' });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const existing = await sql`SELECT id FROM users WHERE email = ${normalizedEmail}`;
    if (existing.length) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const [user] = await sql`
      INSERT INTO users (email, password_hash) VALUES (${normalizedEmail}, ${passwordHash})
      RETURNING id, email
    `;

    await sendVerificationCode(user.id, user.email);

    const token = signToken({ uid: user.id, email: user.email });
    setSessionCookie(res, token);
    res.status(200).json({ email: user.email, needsVerification: true });
  } catch (err) {
    console.error('signup error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
