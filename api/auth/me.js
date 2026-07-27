const { sql } = require('../_lib/db');
const { getSession } = require('../_lib/auth');

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }

  try {
    const licenses = await sql`
      SELECT license_key, created_at FROM licenses
      WHERE email = ${session.email}
      ORDER BY created_at DESC
    `;
    res.status(200).json({
      email: session.email,
      licenses,
      downloadUrl: process.env.DOWNLOAD_URL || null,
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};
