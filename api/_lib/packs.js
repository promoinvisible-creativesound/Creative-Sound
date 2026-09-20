// Free/paid sound packs, kept apart from the Creative Dist license flow: a pack
// purchase never mints a license key, it only records who may download which
// pack. The download URLs live in environment variables (never in the repo,
// which is public) and are only handed to a signed-in owner or emailed to the
// address that checked out.
const { sql } = require('./db');

// paymentLinkSlug is the last path segment of the pack's buy.stripe.com link.
const PACKS = {
  'creative-presets-vol-1': {
    name: 'Creative Presets Vol. 1',
    paymentLinkSlug: '4gM9AL75dgJs29yfX36EU04',
    urlEnv: 'PACK_URL_CREATIVE_PRESETS_VOL_1',
  },
  'creative-presets-vol-2': {
    name: 'Creative Presets Vol. 2',
    paymentLinkSlug: 'dRmaEP4X52SCcOcfX36EU03',
    urlEnv: 'PACK_URL_CREATIVE_PRESETS_VOL_2',
  },
};

function downloadUrl(packId) {
  const pack = PACKS[packId];
  const raw = pack && process.env[pack.urlEnv];
  if (!raw) return null;
  // Dropbox share links open a preview page with dl=0; dl=1 starts the download.
  return raw.trim().replace(/([?&])dl=0(?=&|$)/, '$1dl=1');
}

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS pack_purchases (
          id SERIAL PRIMARY KEY,
          email TEXT NOT NULL,
          pack_id TEXT NOT NULL,
          stripe_session_id TEXT,
          amount_total INTEGER,
          currency TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_purchases_session ON pack_purchases (stripe_session_id)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_pack_purchases_email ON pack_purchases (email)`;
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  return tableReady;
}

const linkUrlCache = new Map();

// Returns the pack id a checkout session was for, or null when it belongs to
// anything else (i.e. Creative Dist, which keeps its license flow).
async function packIdForSession(stripe, session) {
  const metaId = session.metadata && session.metadata.pack_id;
  if (metaId && PACKS[metaId]) return metaId;

  const link = session.payment_link;
  if (!link) return null;
  const linkId = typeof link === 'string' ? link : link.id;

  let url = linkUrlCache.get(linkId);
  if (url === undefined) {
    const full = await stripe.paymentLinks.retrieve(linkId);
    url = String(full.url || '').split('?')[0];
    linkUrlCache.set(linkId, url);
  }
  return Object.keys(PACKS).find((id) => url.endsWith('/' + PACKS[id].paymentLinkSlug)) || null;
}

module.exports = { PACKS, downloadUrl, ensureTable, packIdForSession };
