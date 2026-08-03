const bcrypt = require('bcryptjs');
const { sql } = require('../_lib/db');
const { getSession } = require('../_lib/auth');

// Handles both profile-field updates and password changes — kept in a
// single function (instead of two) to stay under Vercel's Hobby-plan cap
// of 12 Serverless Functions per deployment. newPassword's presence tells
// the two actions apart.
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

  const body = req.body || {};

  if (body.newPassword !== undefined) {
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword || String(newPassword).length < 8) {
      res.status(400).json({ error: 'Current password and a new password of at least 8 characters are required.' });
      return;
    }

    try {
      const [user] = await sql`SELECT password_hash FROM users WHERE id = ${session.uid}`;
      if (!user) {
        res.status(401).json({ error: 'Not signed in.' });
        return;
      }

      const valid = await bcrypt.compare(String(currentPassword), user.password_hash);
      if (!valid) {
        res.status(400).json({ error: 'Current password is incorrect.' });
        return;
      }

      const newHash = await bcrypt.hash(String(newPassword), 10);
      await sql`UPDATE users SET password_hash = ${newHash} WHERE id = ${session.uid}`;
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error('change-password error:', err);
      res.status(500).json({ error: 'Something went wrong, please try again.' });
    }
    return;
  }

  const firstName = String(body.firstName || '').trim().slice(0, 80);
  const lastName = String(body.lastName || '').trim().slice(0, 80);

  try {
    await sql`
      UPDATE users SET first_name = ${firstName || null}, last_name = ${lastName || null}
      WHERE id = ${session.uid}
    `;
    res.status(200).json({ firstName, lastName });
  } catch (err) {
    console.error('update-profile error:', err);
    res.status(500).json({ error: 'Something went wrong, please try again.' });
  }
};
