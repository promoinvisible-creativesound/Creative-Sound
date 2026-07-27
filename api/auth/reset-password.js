const bcrypt = require('bcryptjs');
const { sql } = require('../_lib/db');
const { signToken, setSessionCookie } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { token, password } = req.body || {};
  if (!token || !password || String(password).length < 8) {
    res.status(400).json({ error: 'A password of at least 8 characters is required.' });
    return;
  }

  try {
    const [reset] = await sql`
      SELECT id, user_id, expires_at, used FROM password_resets WHERE token = ${token}
    `;

    if (!reset || reset.used || new Date(reset.expires_at) < new Date()) {
      res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
      return;
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const [user] = await sql`
      UPDATE users SET password_hash = ${passwordHash} WHERE id = ${reset.user_id}
      RETURNING id, email
    `;
    await sql`UPDATE password_resets SET used = true WHERE id = ${reset.id}`;

    const sessionToken = signToken({ uid: user.id, email: user.email });
    setSessionCookie(res, sessionToken);
    res.status(200).json({ email: user.email });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
