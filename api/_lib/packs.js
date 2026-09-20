// Free/paid sound packs, kept apart from the Creative Dist license flow: a pack
// purchase never mints a license key, it only records who may download which
// pack. The download URLs live in environment variables (never in the repo,
// which is public) and are only handed to a signed-in owner or emailed to the
// address that checked out.
const { sql } = require('./db');

// paymentLinkSlugs are the last path segments of each buy.stripe.com link that
// sells the pack (the current free link, plus the old paid Vol. 1 link so a
// checkout that still comes through it also gets the pack email, not a license).
const PACKS = {
  'creative-presets-vol-1': {
    name: 'Creative Presets Vol. 1',
    paymentLinkSlugs: ['4gM9AL75dgJs29yfX36EU04', 'dRm6ozgFN8cWeWkbGN6EU02'],
    urlEnv: 'PACK_URL_CREATIVE_PRESETS_VOL_1',
  },
  'creative-presets-vol-2': {
    name: 'Creative Presets Vol. 2',
    paymentLinkSlugs: ['dRmaEP4X52SCcOcfX36EU03'],
    urlEnv: 'PACK_URL_CREATIVE_PRESETS_VOL_2',
  },
};

// The Creative Dist checkout link. Only used to recognise a Creative Dist
// purchase that happens to be free (e.g. a 100% coupon).
const DIST_LINK_SLUGS = ['00w6oz89h8cW6pO6mt6EU01'];

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

// Works out what a checkout session was for:
//   { kind: 'pack', packId }  a pack (client_reference_id set by the site's
//                             buttons, or the payment link it came from)
//   { kind: 'dist' }          the Creative Dist link
//   { kind: 'unknown' }       anything else
// Throws if Stripe can't be asked about the payment link.
async function classifySession(stripe, session) {
  const ref = session.client_reference_id;
  if (ref && PACKS[ref]) return { kind: 'pack', packId: ref };
  const metaId = session.metadata && session.metadata.pack_id;
  if (metaId && PACKS[metaId]) return { kind: 'pack', packId: metaId };

  const link = session.payment_link;
  if (!link) return { kind: 'unknown' };
  const linkId = typeof link === 'string' ? link : link.id;

  let url = linkUrlCache.get(linkId);
  if (url === undefined) {
    const full = await stripe.paymentLinks.retrieve(linkId);
    url = String(full.url || '').split('?')[0];
    linkUrlCache.set(linkId, url);
  }
  const packId = Object.keys(PACKS).find((id) => PACKS[id].paymentLinkSlugs.some((s) => url.endsWith('/' + s)));
  if (packId) return { kind: 'pack', packId };
  if (DIST_LINK_SLUGS.some((s) => url.endsWith('/' + s))) return { kind: 'dist' };
  return { kind: 'unknown' };
}

module.exports = { PACKS, downloadUrl, ensureTable, classifySession };
