// TEMPORARY — one-off "Creative Dist 2.0 / Flux" update announcement to
// every existing license holder. Removed right after use. Runs server-side
// so it can use DOWNLOAD_URL / RESEND_API_KEY / FROM_EMAIL already
// configured in production without those values ever being copied anywhere.
const { sql } = require('./_lib/db');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const ADMIN_TOKEN = 'fdcae7577e101fc198938e338edfbacf';

function buildEmailHtml() {
  const downloadUrl = process.env.DOWNLOAD_URL;
  const downloadBlock = downloadUrl
    ? `<p style="margin-top:28px;"><a href="${downloadUrl}" style="display:inline-block;background:#e8862c;color:#0a0a09;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;">Download Creative Dist 2.0</a></p>`
    : '';

  return `
    <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px;max-width:560px;">
      <h1 style="color:#FFB347;font-size:22px;">Creative Dist 2.0 is here</h1>
      <p>The update is free for everyone who already owns a license — including you.</p>
      <p style="margin-top:20px;">The new module is <strong style="color:#FFB347;">Flux</strong>: instead of picking one effect,
      Flux blends two — Algo A and Algo B, each chosen independently from nine algorithms
      (Sweep, Ring, Flanger, Tremolo, Cloud, Shimmer, Resonator, Doubler, Formant) — and morphs
      continuously between them instead of just switching. 14 built-in combinations, or build your own.</p>
      ${downloadBlock}
      <p style="margin-top:24px;">Your existing license already unlocks the new version — nothing else to do.</p>
      <p style="margin-top:32px;color:#8a877e;font-size:13px;">Creative Sound — sound tools by Invisible</p>
    </div>
  `;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { token, dryRun } = req.body || {};
  if (token !== ADMIN_TOKEN) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  try {
    const rows = await sql`SELECT DISTINCT email FROM licenses ORDER BY email`;
    const emails = rows.map((r) => r.email);

    if (dryRun) {
      res.status(200).json({ ok: true, dryRun: true, count: emails.length, emails });
      return;
    }

    const results = [];
    for (const email of emails) {
      const { error } = await resend.emails.send({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: 'Creative Dist 2.0 is here — free update (new Flux module)',
        html: buildEmailHtml(),
      });
      results.push({ email, ok: !error, error: error ? error.message || String(error) : null });
    }

    res.status(200).json({ ok: true, sent: results.filter((r) => r.ok).length, total: results.length, results });
  } catch (err) {
    console.error('admin-send-update error:', err);
    res.status(500).json({ error: err.message });
  }
};
