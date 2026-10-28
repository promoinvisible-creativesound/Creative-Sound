// Search landing pages for producer tracks, rendered on the server so search
// engines read the full list without running any script:
//   /type-beat/<slug>   "Travis Scott Type Beats" (from each track's type beat field)
//   /genre/<slug>       "Trap Beats" (from the track genre)
//   /mood/<slug>        "Dark Beats" (from the track mood)
//   /tag/<slug>         "808 Beats" (from the track tags; noindex under 2 tracks)
//   /type-beats         hub: every type beat and genre with tracks
//   /sitemap-store.xml  tracks, these pages and producer storefronts
//   /track.html?id=     one track, and /@handle one profile: see seo-single.js
// The page shell (header, footer, styles) is artist.html, read at runtime so
// it always matches the live site; js/seo-page.js plays previews in place.
const fs = require('fs');
const path = require('path');
const { liveBeats, publicBeat } = require('./catalogue');

const SITE = 'https://creativesound.io';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (c) => `€${(c / 100).toFixed(2)}`;
const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const minPrice = (b) => Math.min(...Object.values(b.prices || {}).filter((x) => x > 0));
const trackUrl = (b) => `/track.html?id=${encodeURIComponent(b.id)}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

let shell = null;
function template() {
  if (!shell) shell = fs.readFileSync(path.join(__dirname, '..', '..', 'artist.html'), 'utf8');
  return shell;
}

async function tracks() {
  return (await liveBeats()).filter((b) => b.source === 'producer').map(publicBeat);
}

// Groups: { slug -> { name, tracks } }, the most used spelling wins.
function groups(list, pick) {
  const out = new Map();
  list.forEach((b) => {
    [...new Set(pick(b).map((n) => String(n || '').trim()).filter(Boolean))].forEach((name) => {
      const s = slug(name);
      if (!s) return;
      if (!out.has(s)) out.set(s, { slug: s, names: new Map(), tracks: [] });
      const g = out.get(s);
      g.names.set(name, (g.names.get(name) || 0) + 1);
      g.tracks.push(b);
    });
  });
  out.forEach((g) => { g.name = [...g.names.entries()].sort((a, b) => b[1] - a[1])[0][0]; });
  return out;
}
const typeGroups = (list) => groups(list, (b) => b.typeBeat || []);
const genreGroups = (list) => groups(list, (b) => [b.genre]);
const moodGroups = (list) => groups(list, (b) => [b.mood]);
const tagGroups = (list) => groups(list, (b) => b.tags || []);
// Tags are stored lowercase; show them the way people search them.
const TAG_NAMES = { rnb: 'R&B', 'r&b pop': 'R&B Pop', 'lo-fi': 'Lo-Fi', 'lofi hip hop': 'Lofi Hip Hop', edm: 'EDM', 'k-pop': 'K-Pop', 'uk drill': 'UK Drill', 'uk garage': 'UK Garage', 'ny drill': 'NY Drill', tiktok: 'TikTok', youtube: 'YouTube', 'instagram reels': 'Instagram Reels', 'g-funk': 'G-Funk', 'hi-hats': 'Hi-Hats', 'rolling hi-hats': 'Rolling Hi-Hats', pluggnb: 'PluggnB' };
const tagName = (t) => TAG_NAMES[t] || String(t).replace(/(^|[\s-])([a-z])/g, (m, a, c) => a + c.toUpperCase());
const THIN = 2;

/* --------------------------------- Markup --------------------------------- */
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
const meta = (b) => [b.bpm ? `${b.bpm} BPM` : '', b.key, b.genre].filter(Boolean).join(' · ');
const card = (b, i) => `
      <article class="sf-card" style="--i:${i}${b.accent ? `; --c:${b.accent}` : ''}">
        <div class="sf-card-art">
          ${b.cover ? `<img src="${esc(b.coverSm || b.cover)}" alt="${esc(b.title)} cover" loading="lazy" decoding="async">` : ''}
          <button type="button" class="sf-play" data-play="${esc(b.id)}" data-src="${esc(b.preview)}" data-title="${esc(b.title)}" data-meta="${esc(meta(b))}" data-cover="${esc(b.cover || '')}" data-href="${trackUrl(b)}" aria-label="Play ${esc(b.title)}">${PLAY}</button>
        </div>
        <div class="sf-card-body">
          <a href="${trackUrl(b)}"><b>${esc(b.title)}</b></a>
          <span>${b.producerHandle ? `<a href="/@${esc(b.producerHandle)}">${esc(b.producer)}</a>` : esc(b.producer)}${(b.coProducers || []).slice(0, 1).map((c) => ` &amp; ${c.handle ? `<a href="/@${esc(c.handle)}">${esc(c.name)}</a>` : esc(c.name)}`).join('')}${(b.coProducers || []).length > 1 ? ` <a href="${trackUrl(b)}">+${b.coProducers.length - 1}</a>` : ''} · ${esc(meta(b))}</span>
          ${Number.isFinite(minPrice(b)) ? `<em>From ${euro(minPrice(b))}</em>` : ''}
        </div>
      </article>`;
const chips = (items, base) => items.map((g) => `<a class="seo-chip" href="/${base}/${g.slug}">${esc(g.name)}<small>${g.tracks.length}</small></a>`).join('');

function page({ title, desc, canonical, h1, kicker, intro, crumbs, body, ld }) {
  let html = template();
  const full = `${title} | Creative Sound`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(full)}</title>`);
  ['meta name="description"', 'meta property="og:description"', 'meta name="twitter:description"'].forEach((tag) => {
    html = html.replace(new RegExp(`(<${tag} content=")[^"]*"`), `$1${esc(desc)}"`);
  });
  ['meta property="og:title"', 'meta name="twitter:title"'].forEach((tag) => {
    html = html.replace(new RegExp(`(<${tag} content=")[^"]*"`), `$1${esc(full)}"`);
  });
  html = html.replace(/(<link rel="canonical" href=")[^"]*"/, `$1${canonical}"`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*"/, `$1${canonical}"`);
  html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<base href="/">');
  html = html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`);
  html = html.replace(/<script src="js\/artist\.js\?v=\d+"><\/script>/, '<script src="js/seo-page.js?v=1"></script>');
  const main = `<main class="pf-page is-store seo-page">
    <nav class="seo-crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${c[1]}">${esc(c[0])}</a><span aria-hidden="true">/</span>` : `<span aria-current="page">${esc(c[0])}</span>`)).join('')}</nav>
    <header class="seo-hero">
      ${kicker ? `<span class="pf-role">${esc(kicker)}</span>` : ''}
      <h1>${esc(h1)}</h1>
      <p>${intro}</p>
    </header>
    ${body}
  </main>`;
  const a = html.indexOf('<main');
  const z = html.indexOf('</main>') + '</main>'.length;
  return html.slice(0, a) + main + html.slice(z);
}

function listingBody(g, all, others, otherBase, otherLabel, faq, sellLine) {
  return `
    <section class="pf-section" aria-label="Tracks">
      <div class="sf-grid">${g.tracks.map(card).join('')}</div>
    </section>
    <section class="pf-section seo-faq" aria-labelledby="seo-faq-title">
      <h2 id="seo-faq-title">Good to know</h2>
      ${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${a}</p></details>`).join('')}
    </section>
    ${others.length ? `<section class="pf-section" aria-labelledby="seo-more-title">
      <h2 id="seo-more-title">${esc(otherLabel)}</h2>
      <div class="seo-chips">${chips(others, otherBase)}</div>
    </section>` : ''}
    <p class="seo-sell">${sellLine} <a href="/signup.html?role=producer">Sell your tracks on Creative Sound</a></p>`;
}

function ldFor({ name, canonical, desc, list, crumbs, faq }) {
  return [
    {
      '@context': 'https://schema.org', '@type': 'CollectionPage', name, url: canonical, description: desc,
      mainEntity: {
        '@type': 'ItemList', numberOfItems: list.length,
        itemListElement: list.map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}${trackUrl(b)}`, name: `${b.title} by ${b.credit || b.producer}` })),
      },
    },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: `${SITE}${c[1]}` })) },
    ...(faq ? [{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') } })) }] : []),
  ];
}

const facts = (list) => {
  const bpms = list.map((b) => b.bpm).filter(Boolean);
  const prices = list.map(minPrice).filter(Number.isFinite);
  return {
    bpm: bpms.length ? (Math.min(...bpms) === Math.max(...bpms) ? `${bpms[0]} BPM` : `${Math.min(...bpms)} to ${Math.max(...bpms)} BPM`) : '',
    from: prices.length ? euro(Math.min(...prices)) : '',
    producers: new Set(list.map((b) => b.producer)).size,
  };
};
const LICENSE_A = 'Yes. Every track is sold with a license: MP3, WAV, stems or the full project, depending on the one you pick. The license PDF you get at checkout says what you can do (streams, sales, videos, live shows) and how to credit the producer.';
const PREVIEW_A = 'Yes. Press play on any cover to hear the preview right here. Some producers also offer a free tagged download for private testing.';

function renderType(g, all) {
  const name = g.name;
  const f = facts(g.tracks);
  const title = `${name} Type Beats`;
  const desc = `${plural(g.tracks.length, `${name} type beat`)} for sale${f.bpm ? `, ${f.bpm}` : ''}. Preview every track and license it instantly${f.from ? ` from ${f.from}` : ''}: MP3, WAV, stems or project files.`;
  const canonical = `${SITE}/type-beat/${g.slug}`;
  const crumbs = [['Tracks', '/beats.html'], ['Type beats', '/type-beats'], [name, `/type-beat/${g.slug}`]];
  const faq = [
    [`Are these beats made by ${name}?`, `No. "Type beat" means the track is made in the style of ${esc(name)}. Each one is an original instrumental by an independent producer on Creative Sound, not affiliated with or endorsed by ${esc(name)}.`],
    [`Can I use a ${name} type beat for my own song?`, LICENSE_A],
    ['Can I listen before buying?', PREVIEW_A],
  ];
  const others = [...typeGroups(all).values()].filter((x) => x.slug !== g.slug).sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 24);
  const intro = `${plural(g.tracks.length, 'original track')} in the style of ${esc(name)}${f.producers > 1 ? ` from ${f.producers} producers` : ''}${f.bpm ? `, ${esc(f.bpm)}` : ''}. Press play to preview, then license the one you like${f.from ? ` from ${esc(f.from)}` : ''}.`;
  return page({
    title, desc, canonical, h1: title, kicker: 'Type beat', intro, crumbs,
    body: listingBody(g, all, others, 'type-beat', 'More type beats', faq, `Making ${esc(name)} type beats?`),
    ld: ldFor({ name: title, canonical, desc, list: g.tracks, crumbs, faq }),
  });
}

function renderGenre(g, all) {
  const name = g.name;
  const f = facts(g.tracks);
  const title = `${name} Beats for Sale`;
  const desc = `${plural(g.tracks.length, `${name.toLowerCase()} beat`)} from independent producers${f.bpm ? `, ${f.bpm}` : ''}. Preview and license instantly${f.from ? ` from ${f.from}` : ''}: MP3, WAV, stems or project files.`;
  const canonical = `${SITE}/genre/${g.slug}`;
  const crumbs = [['Tracks', '/beats.html'], ['Genres', '/type-beats'], [name, `/genre/${g.slug}`]];
  const faq = [
    [`Can I use these ${name.toLowerCase()} beats commercially?`, LICENSE_A],
    ['Can I listen before buying?', PREVIEW_A],
    ['Who makes these beats?', 'Independent producers who sell on Creative Sound. Open a producer\'s name to see their storefront with all their tracks.'],
  ];
  const types = [...typeGroups(g.tracks).values()];
  const others = types.length ? types : [...genreGroups(all).values()].filter((x) => x.slug !== g.slug);
  const intro = `${plural(g.tracks.length, `${esc(name.toLowerCase())} track`)}${f.producers > 1 ? ` from ${f.producers} producers` : ''}${f.bpm ? `, ${esc(f.bpm)}` : ''}. Press play to preview, then license the one you like${f.from ? ` from ${esc(f.from)}` : ''}.`;
  return page({
    title, desc, canonical, h1: `${name} Beats`, kicker: 'Genre', intro, crumbs,
    body: listingBody(g, all, others.slice(0, 24), types.length ? 'type-beat' : 'genre', types.length ? `${name} type beats` : 'Other genres', faq, `Producing ${esc(name.toLowerCase())}?`),
    ld: ldFor({ name: title, canonical, desc, list: g.tracks, crumbs, faq }),
  });
}

function renderFacet(kind, g, all) {
  const name = kind === 'tag' ? tagName(g.name) : g.name;
  const f = facts(g.tracks);
  const title = `${name} Beats`;
  const desc = `${plural(g.tracks.length, `${name.toLowerCase()} beat`)} from independent producers${f.bpm ? `, ${f.bpm}` : ''}. Preview and license instantly${f.from ? ` from ${f.from}` : ''}: MP3, WAV, stems or project files.`;
  // A tag that is also a genre or mood (trap, dark…) points search engines to that page.
  const main = kind === 'tag' ? (genreGroups(all).has(g.slug) ? 'genre' : moodGroups(all).has(g.slug) ? 'mood' : null) : null;
  const canonical = `${SITE}/${main || kind}/${g.slug}`;
  const crumbs = [['Tracks', '/beats.html'], [kind === 'tag' ? 'Tags' : 'Moods', '/type-beats'], [name, `/${kind}/${g.slug}`]];
  const faq = [
    [`Can I use these ${name.toLowerCase()} beats commercially?`, LICENSE_A],
    ['Can I listen before buying?', PREVIEW_A],
  ];
  const source = kind === 'tag' ? tagGroups(all) : moodGroups(all);
  const others = [...source.values()].filter((x) => x.slug !== g.slug && (kind !== 'tag' || x.tracks.length >= THIN)).sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 30)
    .map((x) => ({ ...x, name: kind === 'tag' ? tagName(x.name) : x.name }));
  const intro = `${plural(g.tracks.length, 'track')} ${kind === 'tag' ? `tagged ${esc(name)}` : `with a ${esc(name.toLowerCase())} mood`}${f.producers > 1 ? ` from ${f.producers} producers` : ''}${f.bpm ? `, ${esc(f.bpm)}` : ''}. Press play to preview, then license the one you like${f.from ? ` from ${esc(f.from)}` : ''}.`;
  let html = page({
    title: `${title} for Sale`, desc, canonical, h1: title, kicker: kind === 'tag' ? 'Tag' : 'Mood', intro, crumbs,
    body: listingBody(g, all, others, kind, kind === 'tag' ? 'More tags' : 'More moods', faq, 'Producer?'),
    ld: ldFor({ name: title, canonical, desc, list: g.tracks, crumbs, faq }),
  });
  if (kind === 'tag' && g.tracks.length < THIN) html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta name="robots" content="noindex,follow">');
  return html;
}

function renderHub(all) {
  const types = [...typeGroups(all).values()].sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name));
  const genres = [...genreGroups(all).values()].sort((a, b) => b.tracks.length - a.tracks.length);
  const moods = [...moodGroups(all).values()].sort((a, b) => b.tracks.length - a.tracks.length);
  const tagsList = [...tagGroups(all).values()].filter((x) => x.tracks.length >= THIN).sort((a, b) => b.tracks.length - a.tracks.length).slice(0, 80).map((x) => ({ ...x, name: tagName(x.name) }));
  const latest = all.slice().sort((a, b) => String(b.released).localeCompare(String(a.released))).slice(0, 12);
  const canonical = `${SITE}/type-beats`;
  const crumbs = [['Tracks', '/beats.html'], ['Type beats and genres', '/type-beats']];
  const desc = `Browse type beats and genres on Creative Sound: ${genres.slice(0, 5).map((g) => g.name).join(', ')} and more. Preview every track and license it instantly.`;
  return page({
    title: 'Type Beats and Genres', desc, canonical, h1: 'Type beats and genres', kicker: '', crumbs,
    intro: `${plural(all.length, 'track')} from independent producers, grouped by style. Pick a sound, press play, license the one you like.`,
    body: `
    ${genres.length ? `<section class="pf-section" aria-labelledby="seo-genres-title"><h2 id="seo-genres-title">Genres</h2><div class="seo-chips">${chips(genres, 'genre')}</div></section>` : ''}
    ${moods.length ? `<section class="pf-section" aria-labelledby="seo-moods-title"><h2 id="seo-moods-title">Moods</h2><div class="seo-chips">${chips(moods, 'mood')}</div></section>` : ''}
    ${tagsList.length ? `<section class="pf-section" aria-labelledby="seo-tags-title"><h2 id="seo-tags-title">Tags</h2><div class="seo-chips">${chips(tagsList, 'tag')}</div></section>` : ''}
    ${types.length ? `<section class="pf-section" aria-labelledby="seo-types-title"><h2 id="seo-types-title">Type beats</h2><div class="seo-chips">${chips(types, 'type-beat')}</div></section>` : ''}
    <section class="pf-section" aria-labelledby="seo-latest-title"><h2 id="seo-latest-title">Latest tracks</h2><div class="sf-grid">${latest.map(card).join('')}</div></section>
    <p class="seo-sell">Producer? <a href="/signup.html?role=producer">Sell your tracks on Creative Sound</a></p>`,
    ld: ldFor({ name: 'Type beats and genres', canonical, desc, list: latest, crumbs }),
  });
}

async function storefronts(all) {
  return [...new Set(all.map((b) => b.producerHandle).filter(Boolean))];
}

function sitemap(all, handles) {
  const day = new Date().toISOString().slice(0, 10);
  const urls = [
    [`${SITE}/type-beats`, '0.7'],
    ...[...genreGroups(all).values()].map((g) => [`${SITE}/genre/${g.slug}`, '0.7']),
    ...[...typeGroups(all).values()].map((g) => [`${SITE}/type-beat/${g.slug}`, '0.7']),
    ...[...moodGroups(all).values()].map((g) => [`${SITE}/mood/${g.slug}`, '0.6']),
    ...[...tagGroups(all).values()].filter((g) => g.tracks.length >= THIN && !genreGroups(all).has(g.slug) && !moodGroups(all).has(g.slug)).map((g) => [`${SITE}/tag/${g.slug}`, '0.5']),
    ...handles.map((h) => [`${SITE}/@${encodeURIComponent(h)}`, '0.6']),
    ...all.map((b) => [`${SITE}${trackUrl(b)}`, '0.8', b.released]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([loc, p, mod]) => `  <url><loc>${esc(loc)}</loc><lastmod>${mod || day}</lastmod><priority>${p}</priority></url>`).join('\n')}\n</urlset>\n`;
}

function notFound(res, all) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  const html = page({
    title: 'Not found', desc: 'This page has no tracks yet.', canonical: `${SITE}/type-beats`, h1: 'No tracks here yet', kicker: '',
    crumbs: [['Tracks', '/beats.html'], ['Type beats and genres', '/type-beats']],
    intro: 'There are no tracks with this style right now. Have a look at the other styles.',
    body: `<section class="pf-section"><div class="seo-chips">${chips([...genreGroups(all).values()], 'genre')}</div></section>`,
    ld: {},
  }).replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta name="robots" content="noindex,follow">');
  res.end(html);
}

async function handleSeo(req, res) {
  const kind = String((req.query && req.query.kind) || '');
  const s = slug((req.query && req.query.slug) || '');
  if (kind === 'track' || kind === 'profile') {
    await require('./seo-single')({ esc, euro, slug, trackUrl, plural, SITE })(req, res, kind);
    return;
  }
  try {
    const all = await tracks();
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400');
    if (kind === 'sitemap') {
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.end(sitemap(all, await storefronts(all)));
      return;
    }
    let html = null;
    if (kind === 'hub') html = renderHub(all);
    if (kind === 'type') { const g = typeGroups(all).get(s); if (g) html = renderType(g, all); }
    if (kind === 'genre') { const g = genreGroups(all).get(s); if (g) html = renderGenre(g, all); }
    if (kind === 'mood') { const g = moodGroups(all).get(s); if (g) html = renderFacet('mood', g, all); }
    if (kind === 'tag') { const g = tagGroups(all).get(s); if (g) html = renderFacet('tag', g, all); }
    if (!html) { notFound(res, all); return; }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch (err) {
    console.error('seo page error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Something went wrong, please try again.');
  }
}

module.exports = { handleSeo, slug };
