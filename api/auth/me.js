const { sql } = require('../_lib/db');
const { getSession } = require('../_lib/auth');
const { PACKS, downloadUrl, ensureTable } = require('../_lib/packs');

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

    // Pack purchases are separate from licenses. A failure here must never
    // stop the account pages from loading, so it just yields an empty list.
    let packs = [];
    try {
      await ensureTable();
      const rows = await sql`
        SELECT pack_id, created_at, amount_total, currency FROM pack_purchases
        WHERE email = ${session.email}
        ORDER BY created_at DESC
      `;
      packs = rows
        .filter((r) => PACKS[r.pack_id])
        .map((r) => ({
          pack_id: r.pack_id,
          name: PACKS[r.pack_id].name,
          created_at: r.created_at,
          amount_total: r.amount_total,
          currency: r.currency,
          download_url: downloadUrl(r.pack_id),
        }));
    } catch (err) {
      console.error('me packs error:', err);
    }

    res.status(200).json({
      email: session.email,
      firstName: (user && user.first_name) || '',
      lastName: (user && user.last_name) || '',
      licenses,
      orders: licenses,
      packs,
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};
