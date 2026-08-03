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
      SELECT license_key, created_at, amount_total, currency FROM licenses
      WHERE email = ${session.email}
      ORDER BY created_at DESC
    `;
    const [user] = await sql`SELECT first_name, last_name FROM users WHERE id = ${session.uid}`;

    res.status(200).json({
      email: session.email,
      firstName: (user && user.first_name) || '',
      lastName: (user && user.last_name) || '',
      licenses,
      orders: licenses,
      downloadUrl: process.env.DOWNLOAD_URL || null,
      latestVersion: process.env.LATEST_VERSION_URL
        ? { label: process.env.LATEST_VERSION_LABEL || 'Latest build', url: process.env.LATEST_VERSION_URL }
        : null,
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};
