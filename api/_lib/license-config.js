// Producer license settings on top of the fixed legal base.
// Each producer picks, per tier, the usage limits (from fixed options, so
// every value reads well in the contract), their share of publishing, and up
// to MAX_CLAUSES short clauses of their own. The store shows the result, the
// license PDF prints it, and every sale stores a snapshot of the final text
// (beat_purchases.license_snapshot) so later edits never change a contract
// that was already sold.
const LICENSES = require('../../data/beat-licenses.json');

const OPTIONS = {
  streams: [10000, 25000, 50000, 100000, 250000, 500000, 1000000, null],
  sales: [500, 1000, 2500, 5000, 10000, 25000, null],
  videos: [0, 1, 2, 5, null],
  live: ['none', 'nonprofit', 'all'],
  radio: [0, 2, 5, null],
  publishing: [0, 10, 25, 50],
};
const MAX_CLAUSES = 5;
const CLAUSE_MAX = 400;

// The terms the site used before producers could change them.
const DEFAULTS = {
  tiers: {
    mp3: { streams: 100000, sales: 2500, videos: 1, live: 'nonprofit', radio: 0, publishing: 50 },
    wav: { streams: null, sales: null, videos: null, live: 'all', radio: null, publishing: 50 },
    trackout: { streams: null, sales: null, videos: null, live: 'all', radio: null, publishing: 0 },
    project: { streams: null, sales: null, videos: null, live: 'all', radio: null, publishing: 0 },
  },
  clauses: [],
};

// null / 'unlimited' mean no cap; a missing or unknown value keeps the default.
const pick = (list, v, fallback) => {
  if (v === undefined || v === '') return fallback;
  if (v === 'unlimited') v = null;
  if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
  return list.includes(v) ? v : fallback;
};
const cleanClause = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, CLAUSE_MAX);

// Any input (DB value, request body) -> a complete, valid config.
function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const tiers = {};
  for (const id of LICENSES.order) {
    const d = DEFAULTS.tiers[id];
    const t = (src.tiers && src.tiers[id]) || {};
    tiers[id] = {
      streams: pick(OPTIONS.streams, t.streams, d.streams),
      sales: pick(OPTIONS.sales, t.sales, d.sales),
      videos: pick(OPTIONS.videos, t.videos, d.videos),
      live: pick(OPTIONS.live, t.live, d.live),
      radio: pick(OPTIONS.radio, t.radio, d.radio),
      publishing: pick(OPTIONS.publishing, t.publishing == null ? d.publishing : Number(t.publishing), d.publishing),
    };
  }
  const clauses = (Array.isArray(src.clauses) ? src.clauses : []).map(cleanClause).filter((c) => c.length >= 10).slice(0, MAX_CLAUSES);
  return { tiers, clauses };
}

const n = (x) => Number(x).toLocaleString('en-US');
const isUnlimited = (t) => t.streams === null && t.sales === null && t.videos === null && t.live === 'all' && t.radio === null;
const LABELS = {
  streams: (v) => (v === null ? 'Unlimited' : `Up to ${n(v)} audio streams`),
  sales: (v) => (v === null ? 'Unlimited' : `Up to ${n(v)} sales / downloads`),
  videos: (v) => (v === null ? 'Unlimited' : v === 0 ? 'Not included' : `${v} music video${v === 1 ? '' : 's'}`),
  performances: (v) => ({ none: 'Not included', nonprofit: 'Non-profit live performances', all: 'Unlimited, profit and non-profit' }[v]),
  radio: (v) => (v === null ? 'Unlimited radio stations' : v === 0 ? 'Not included' : `Up to ${v} radio stations`),
};
const baseName = (id) => LICENSES.tiers[id].name.replace(/\s+(Lease|Unlimited)$/i, '');

// What the store shows for one tier (same shape as data/beat-licenses.json).
function tierView(id, t) {
  const unlimited = isUnlimited(t);
  return {
    name: `${baseName(id)} ${unlimited ? 'Unlimited' : 'Lease'}`,
    unlimited,
    terms: {
      streams: LABELS.streams(t.streams),
      sales: LABELS.sales(t.sales),
      videos: LABELS.videos(t.videos),
      performances: LABELS.performances(t.live),
      radio: LABELS.radio(t.radio),
    },
    publishing: t.publishing,
  };
}
// Public view for a track: every tier + the producer's own clauses.
function storeView(raw) {
  const c = normalize(raw);
  const tiers = {};
  LICENSES.order.forEach((id) => { tiers[id] = tierView(id, c.tiers[id]); });
  return { tiers, clauses: c.clauses };
}

/* -------------------------------- Contract -------------------------------- */
function usageClause(t) {
  if (isUnlimited(t)) return 'Usage. There is no cap on streams, sales, downloads, music videos, live performances or radio play of the Song.';
  const parts = [
    t.streams === null ? 'unlimited audio streams' : `up to ${n(t.streams)} audio streams`,
    t.sales === null ? 'unlimited sales and downloads' : `up to ${n(t.sales)} sales or downloads`,
    t.videos === null ? 'unlimited music videos' : t.videos === 0 ? 'no music videos' : `${t.videos} music video${t.videos === 1 ? '' : 's'}`,
    { none: 'no live performances', nonprofit: 'non-profit live performances only', all: 'unlimited live performances, profit and non-profit' }[t.live],
    t.radio === null ? 'unlimited radio broadcasting' : t.radio === 0 ? 'no radio broadcasting' : `radio broadcasting on up to ${t.radio} stations`,
  ];
  return `Usage limits. The Song may be exploited with ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}. Once a limit is reached, the Licensee must buy a license with higher limits for the same Beat before further use.`;
}

function publishingClause(pct) {
  if (!pct) return 'Publishing. No share of the writer’s or publishing royalties of the Song is owed to the Producer under this license. The only obligation towards the Producer is the credit above.';
  return `Publishing. The composition of the Song is shared: the Producer holds ${pct}% of the writer’s share and ${pct}% of the publishing share, unless the parties agree otherwise in writing. Each party may register its share with its collecting society (for example SIAE).`;
}

// The full, fixed legal base with the producer's choices filled in.
function contractTerms(id, t, producer, hasClauses) {
  const files = LICENSES.tiers[id].files.map((x) => LICENSES.fileLabels[x]).join(', ');
  const out = [
    `Grant. ${producer} (the "Producer") grants the Licensee a non-exclusive, non-transferable, worldwide license to use the instrumental (the "Beat") to create one new musical work (the "Song") and to exploit the Song within the usage rights above.`,
    `Files. The Licensee receives: ${files}. The files may only be used to record, mix, master and release the Song.`,
  ];
  if (id === 'trackout') out.push('Stems. The track stems may be used to mix and arrange the Beat for the Song (levels, effects, muting or rearranging parts). The stems may not be shared, sold or used in any other work.');
  if (id === 'project') out.push('Project file. The project file and its stems may be used to edit and rearrange the Beat for the Song. The project file, its samples, presets and stems remain the Producer’s work and may not be shared, sold, used to build other beats, or used in any other work.');
  out.push(
    usageClause(t),
    'Ownership. The Producer keeps all rights and the copyright in the Beat. The Licensee owns the lyrics, melodies and vocal recordings they add, and the master recording of the Song, subject to this license.',
    `Credit. The Licensee must credit the Producer as "${producer}" wherever credits are shown, including streaming metadata, video descriptions and physical releases.`,
    publishingClause(t.publishing),
    'Content ID. The Licensee may not register the Beat, or the Song as a whole, with content-identification systems (YouTube Content ID and similar). The Producer will clear claims on the Licensee’s releases on request.',
    'Sync. Music videos are covered as listed above. Use of the Song in films, TV, adverts, video games or other synchronisation needs a separate agreement with the Producer.',
    'Non-exclusive. The Producer may license the Beat to others. If exclusive rights are later sold, this license stays valid for the Song under the same terms.',
    'Restrictions. The Licensee may not resell, give away, re-license or distribute the Beat or its files on their own, use them in another song, sample the Beat into new instrumentals, use it to train AI models, or claim authorship of the instrumental.',
    'Warranty. The Producer confirms the Beat is original and that any samples used are cleared or royalty-free. The Licensee is responsible for the lyrics and any other material they add.',
  );
  if (hasClauses) out.push('Producer terms. The Producer’s additional terms listed below form part of this license. They apply only where they do not reduce the rights granted above or conflict with this agreement; where they do, this agreement prevails.');
  out.push(
    'Breach. If the Licensee breaks these terms and does not fix it within 30 days of notice, this license ends and the Song may no longer be exploited.',
    'Term. This license is perpetual for the Song created under it, within the usage rights above. It is personal to the Licensee and cannot be transferred.',
    'Law. This agreement is governed by Italian law. It is the full agreement between the parties for this license.',
  );
  return out;
}

// Everything the PDF prints for one sale, frozen at purchase time.
function snapshot(id, raw, producer) {
  const c = normalize(raw);
  const t = c.tiers[id];
  const view = tierView(id, t);
  return {
    v: 1,
    name: view.name,
    unlimited: view.unlimited,
    files: LICENSES.tiers[id].files.map((x) => LICENSES.fileLabels[x]).join(', '),
    usage: [
      `Audio streams: ${view.terms.streams}`,
      `Sales and downloads: ${view.terms.sales}`,
      `Music videos: ${view.terms.videos}`,
      `Live performances: ${view.terms.performances}`,
      `Radio broadcasting: ${view.terms.radio}`,
      `Producer’s share of publishing: ${t.publishing ? `${t.publishing}%` : 'none'}`,
    ],
    terms: contractTerms(id, t, producer, c.clauses.length > 0),
    clauses: c.clauses,
  };
}

module.exports = { OPTIONS, DEFAULTS, MAX_CLAUSES, CLAUSE_MAX, normalize, storeView, snapshot };
