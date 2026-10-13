const { sql } = require('../_lib/db');
const { getSession } = require('../_lib/auth');
const { PACKS, downloadUrl, ensureTable } = require('../_lib/packs');
const { beatsForAccount, savedForAccount } = require('../_lib/beats');
const { roleFor, previewAllowed, isAdmin } = require('../_lib/account');

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
    const [user] = await sql`SELECT * FROM users WHERE id = ${session.uid}`;
    // Profile photo (public profile) for the header avatar.
    const photo = user && user.avatar_path && user.handle
      ? `/api/profile/photo?u=${encodeURIComponent(user.handle)}&v=${encodeURIComponent(String(user.avatar_path).split('?v=')[1] || '1')}`
      : null;

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

    // Beat purchases, same rule: never break the account pages.
    let beats = [];
    let savedBeats = [];
    try {
      beats = await beatsForAccount(session.email);
      savedBeats = await savedForAccount(session.email);
    } catch (err) {
      console.error('me beats error:', err);
    }

    let role = null;
    try { role = await roleFor(session.uid); } catch (err) { console.error('me role error:', err); }

    res.status(200).json({
      email: session.email,
      role,
      preview: previewAllowed(session),
      isAdmin: isAdmin(session),
      beats,
      savedBeats,
      firstName: (user && user.first_name) || '',
      lastName: (user && user.last_name) || '',
      photo,
      licenses,
      orders: licenses,
      packs,
    });
  } catch (err) {
    console.error('me error:', err);
    res.status(500).json({ error: 'Something went wrong.' });
  }
};
