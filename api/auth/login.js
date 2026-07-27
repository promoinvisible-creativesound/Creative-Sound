const bcrypt = require('bcryptjs');
const { sql } = require('../_lib/db');
const { signToken, setSessionCookie } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const [user] = await sql`SELECT id, email, password_hash FROM users WHERE email = ${normalizedEmail}`;
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const valid = await bcrypt.compare(String(password), user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const token = signToken({ uid: user.id, email: user.email });
    setSessionCookie(res, token);
    res.status(200).json({ email: user.email });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
