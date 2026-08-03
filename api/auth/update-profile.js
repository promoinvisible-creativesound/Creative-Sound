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

  const firstName = String((req.body && req.body.firstName) || '').trim().slice(0, 80);
  const lastName = String((req.body && req.body.lastName) || '').trim().slice(0, 80);

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
