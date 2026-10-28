// One track page and one profile page for search engines (and link previews).
//   /track.html?id=<id>   shell: track-shell.html, filled in with that track
//   /@<handle>            shell: artist.html, filled in with that profile
// Both keep the existing page and the script that builds it in the browser;
// only what is read before any script runs changes: head tags, structured
// data and a plain heading. A track or profile that does not exist answers a
// real 404 (and is never indexed), and a hiccup serves the plain shell.
const fs = require('fs');
const path = require('path');
const { publicBeat, getBeat } = require('./catalogue');

const shells = {};
// Literal paths so the deploy bundles both shells with the function.
const readers = {
  'track-shell.html': () => fs.readFileSync(path.join(__dirname, '..', '..', 'track-shell.html'), 'utf8'),
  'artist.html': () => fs.readFileSync(path.join(__dirname, '..', '..', 'artist.html'), 'utf8'),
};
const readShell = (file) => shells[file] || (shells[file] = readers[file]());

const OK_CACHE = 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400';
const GONE_CACHE = 'public, max-age=0, s-maxage=60';

module.exports = function build(h) {
  const { esc, euro, slug, trackUrl, plural, SITE } = h;
  const clip = (t, n) => {
    const x = String(t || '').replace(/\s+/g, ' ').trim();
    return x.length > n ? `${x.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : x;
  };
  const absolute = (u) => (!u ? '' : /^https?:/.test(u) ? u : `${SITE}${u.startsWith('/') ? '' : '/'}${u}`);
  const ldTag = (ld) => `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;

  function setHead(html, { title, desc, canonical, image, ld, noindex }) {
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
    ['meta name="description"', 'meta property="og:description"', 'meta name="twitter:description"'].forEach((tag) => {
      html = html.replace(new RegExp(`(<${tag} content=")[^"]*"`), `$1${esc(desc)}"`);
    });
    ['meta property="og:title"', 'meta name="twitter:title"'].forEach((tag) => {
      html = html.replace(new RegExp(`(<${tag} content=")[^"]*"`), `$1${esc(title)}"`);
    });
    if (image) {
      ['meta property="og:image"', 'meta name="twitter:image"'].forEach((tag) => {
        html = html.replace(new RegExp(`(<${tag} content=")[^"]*"`), `$1${esc(image)}"`);
      });
    }
    html = html.replace(/(<link rel="canonical" href=")[^"]*"/, `$1${canonical}"`);
    html = html.replace(/(<meta property="og:url" content=")[^"]*"/, `$1${canonical}"`);
    if (ld) html = html.replace(/(<link rel="canonical"[^>]*>)/, `$1\n${ldTag(ld)}`);
    if (noindex) html = html.replace('<meta charset="UTF-8">', '<meta charset="UTF-8">\n<meta name="robots" content="noindex,follow">');
    return html;
  }

  function renderTrack(b) {
    const by = b.credit || b.producer;
    const title = `${b.title} by ${by} | ${b.genre} track | Creative Sound`;
    const prices = Object.values(b.prices || {}).filter((x) => x > 0);
    const low = prices.length ? Math.min(...prices) : null;
    const style = [b.genre, b.mood].filter(Boolean).join(', ');
    const lead = `${b.title} by ${by}: ${style} track${b.bpm ? `, ${b.bpm} BPM` : ''}${b.key ? `, ${b.key}` : ''}. MP3, WAV and trackout licenses${low ? ` from ${euro(low)}` : ''}.`;
    // The producer's own words go last and only if they fit.
    const desc = clip(b.about && lead.length < 110 ? `${lead} ${b.about}` : lead, 160);
    const canonical = `${SITE}${trackUrl(b)}`;
    const image = absolute(b.cover) || `${SITE}/assets/img/gui-full.png`;
    const crumbs = [['Tracks', '/beats.html'], ...(b.genre ? [[b.genre, `/genre/${slug(b.genre)}`]] : []), [b.title, trackUrl(b)]];
    const ld = [
      {
        '@context': 'https://schema.org', '@type': 'Product', name: `${b.title} by ${by}`, description: desc, image, url: canonical,
        category: 'Music track license', brand: { '@type': 'Brand', name: b.producer },
        ...(low ? { offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: (low / 100).toFixed(2), highPrice: (Math.max(...prices) / 100).toFixed(2), offerCount: prices.length, availability: 'https://schema.org/InStock', url: canonical } } : {}),
      },
      { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: `${SITE}${c[1]}` })) },
    ];
    let html = setHead(readShell('track-shell.html'), { title, desc, canonical, image, ld });
    const a = html.indexOf('<main');
    const z = html.indexOf('</main>') + '</main>'.length;
    const inner = `<main class="beat-page" data-track-page>
  <div class="bp-wrap"><p class="bp-loading">Loading track…</p><h1 class="sr-only">${esc(b.title)} by ${esc(by)}</h1><p class="sr-only">${esc(desc)}</p></div>
</main>`;
    html = html.slice(0, a) + inner + html.slice(z);
    return html;
  }

  function renderProfile({ profile: p, tracks }) {
    const producer = p.role === 'producer';
    const name = p.displayName || p.handle;
    const title = `${name}${producer ? ' · Tracks' : ''} | Creative Sound`;
    const canonical = `${SITE}/@${encodeURIComponent(p.handle)}`;
    const genres = p.genres && p.genres.length ? ` (${p.genres.slice(0, 3).join(', ')})` : '';
    const base = producer ? `${name} on Creative Sound: ${plural(tracks.length, 'track')} to preview and license${genres}.` : `${name} on Creative Sound.`;
    const desc = clip(p.store && p.store.headline ? `${p.store.headline} ${base}` : p.bio ? `${clip(p.bio, 100)} ${base}` : base, 160);
    const image = absolute(p.photo) || `${SITE}/assets/img/gui-full.png`;
    const sameAs = [
      p.instagram && `https://instagram.com/${encodeURIComponent(p.instagram)}`,
      p.tiktok && `https://www.tiktok.com/@${encodeURIComponent(p.tiktok)}`,
      p.youtube, p.spotify,
    ].filter(Boolean);
    const ld = [
      {
        '@context': 'https://schema.org', '@type': 'ProfilePage', url: canonical, name: title,
        mainEntity: { '@type': 'Person', name, url: canonical, description: desc, ...(p.photo ? { image } : {}), ...(sameAs.length ? { sameAs } : {}) },
      },
      ...(tracks.length ? [{
        '@context': 'https://schema.org', '@type': 'ItemList', numberOfItems: tracks.length,
        itemListElement: tracks.slice(0, 50).map((b, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}${trackUrl(b)}`, name: b.title })),
      }] : []),
    ];
    // Members who only listen have nothing to index.
    let html = setHead(readShell('artist.html'), { title, desc, canonical, image, ld, noindex: p.role !== 'producer' && p.role !== 'artist' });
    const list = tracks.length ? `<ul class="sr-only">${tracks.slice(0, 50).map((b) => `<li><a href="${trackUrl(b)}">${esc(b.title)}</a></li>`).join('')}</ul>` : '';
    html = html.replace(/(<main[^>]*data-artist-page[^>]*>)[\s\S]*?(<\/main>)/, (m, open, close) => `${open}<h1 class="sr-only">${esc(name)}</h1><p class="sr-only">${esc(p.bio || desc)}</p>${list}${close}`);
    return html;
  }

  function send(res, status, html, cache) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', cache);
    res.end(html);
  }

  // A real 404 (the page script still shows its own message), never indexed.
  function gone(res, shell, title) {
    send(res, 404, setHead(readShell(shell), { title, desc: 'This page is not available.', canonical: `${SITE}/beats.html`, noindex: true }), GONE_CACHE);
  }

  return async function handle(req, res, kind) {
    const shell = kind === 'track' ? 'track-shell.html' : 'artist.html';
    try {
      if (kind === 'track') {
        const id = String((req.query && req.query.id) || '').slice(0, 80);
        if (!id) { res.statusCode = 302; res.setHeader('Location', '/beats.html'); res.end(); return; }
        const beat = await getBeat(id);
        if (!beat) { gone(res, shell, 'Track not available | Creative Sound'); return; }
        send(res, 200, renderTrack(publicBeat(beat)), OK_CACHE);
        return;
      }
      const found = await require('./profile').publicProfile(req.query && req.query.handle);
      if (!found) { gone(res, shell, 'Profile not found | Creative Sound'); return; }
      send(res, 200, renderProfile(found), OK_CACHE);
    } catch (err) {
      console.error(`seo ${kind} page error:`, err);
      // Never leave a visitor without the page: serve the plain shell.
      try { send(res, 200, readShell(shell), 'no-store'); } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Something went wrong, please try again.');
      }
    }
  };
};
