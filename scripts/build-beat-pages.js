#!/usr/bin/env node
/* Generates one static page per beat: beats/<id>.html
   Run after editing data/beats.json:   node scripts/build-beat-pages.js

   Each page reuses beats.html as the template (header, footer, cart,
   license picker, player and scripts) with its own <main>, title, meta and
   Open Graph tags, so a shared link previews the right beat and Google can
   index it. Interactivity (play, licensing, cart, related tracks) comes from
   js/beats.js, which reads data-beat-id from <main>.

   It also removes pages of beats no longer in the catalogue and keeps
   sitemap.xml in sync (demo beats are noindex and stay out of it). */
// Private preview: the store is only visible to the accounts in
// ADMIN_EMAILS (see js/preview-gate.js). Pages stay noindex and out of the
// sitemap until this is set to false for the public launch.
const PREVIEW = false;
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://creativesound.io';
const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/beats.json'), 'utf8'));
const LIC = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/beat-licenses.json'), 'utf8'));
const template = fs.readFileSync(path.join(ROOT, 'beats.html'), 'utf8');
const EOL = template.includes('\r\n') ? '\r\n' : '\n';
const OUT = path.join(ROOT, 'beats');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euro = (c) => `€${(c / 100).toFixed(2)}`;
const tiersOf = (b) => LIC.order.filter((t) => b.prices && b.prices[t] > 0);

// Page markup lives in js/beat-markup.js, shared with track.html (tracks
// uploaded by producers), so both kinds of page stay identical.
const { beatMainHtml } = require('../js/beat-markup.js');
const mainFor = (b) => beatMainHtml(b, { LIC, producers: catalogue.producers, eol: EOL });

function pageFor(b) {
  const url = `${SITE}/beats/${b.id}.html`;
  const tiers = tiersOf(b);
  const prices = tiers.map((t) => b.prices[t]);
  const title = `${b.title} (prod. ${b.producer}) | ${b.genre} track | Creative Sound`;
  const desc = `${b.title}: ${b.genre.toLowerCase()} track by ${b.producer}, ${b.bpm} BPM in ${b.key}. Preview it and license it from ${euro(Math.min(...prices))}: MP3, WAV, stems or FL Studio project.`;
  const image = b.cover ? `${SITE}/${b.cover}` : `${SITE}/assets/img/gui-full.png`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${b.title} (prod. ${b.producer})`,
    description: desc,
    image,
    url,
    category: 'Beat / instrumental license',
    brand: { '@type': 'Brand', name: 'Creative Sound' },
    offers: { '@type': 'AggregateOffer', priceCurrency: 'EUR', lowPrice: (Math.min(...prices) / 100).toFixed(2), highPrice: (Math.max(...prices) / 100).toFixed(2), offerCount: prices.length, availability: 'https://schema.org/InStock' },
  };

  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = html.replace(/(<meta name="description" content=")[^"]*"/, `$1${esc(desc)}"`);
  html = html.replace(/(<meta property="og:description" content=")[^"]*"/, `$1${esc(desc)}"`);
  html = html.replace(/(<meta name="twitter:description" content=")[^"]*"/, `$1${esc(desc)}"`);
  html = html.replace(/(<meta property="og:title" content=")[^"]*"/, `$1${esc(title)}"`);
  html = html.replace(/(<meta name="twitter:title" content=")[^"]*"/, `$1${esc(title)}"`);
  html = html.replace(/(<meta property="og:image" content=")[^"]*"/, `$1${esc(image)}"`);
  html = html.replace(/(<meta name="twitter:image" content=")[^"]*"/, `$1${esc(image)}"`);
  html = html.split(`${SITE}/beats.html`).join(url);
  // Pages live in /beats/, assets are linked relatively from the site root.
  html = html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">${EOL}<base href="/">`);
  const robots = b.demo || PREVIEW ? `${EOL}<meta name="robots" content="noindex,follow">` : '';
  html = html.replace(/(<link rel="canonical"[^>]*>)/, `$1${robots}${EOL}<script type="application/ld+json">${JSON.stringify(ld)}</script>`);
  const a = html.indexOf('<main');
  const z = html.indexOf('</main>') + '</main>'.length;
  html = html.slice(0, a) + mainFor(b).replace(/\r?\n/g, EOL) + html.slice(z);
  return html;
}

/* --------------------------------- Build --------------------------------- */
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
const beats = (catalogue.beats || []).filter((b) => b.status !== 'hidden' && tiersOf(b).length);
const wanted = new Set();
for (const b of beats) {
  if (!/^[a-z0-9-]+$/.test(b.id)) throw new Error(`Beat id "${b.id}" must be lowercase letters, digits and dashes.`);
  const file = `${b.id}.html`;
  wanted.add(file);
  fs.writeFileSync(path.join(OUT, file), pageFor(b));
}
for (const f of fs.readdirSync(OUT)) if (f.endsWith('.html') && !wanted.has(f)) fs.unlinkSync(path.join(OUT, f));

// track.html: the page for tracks uploaded by producers (track.html?id=...).
// Same template as every beat page; js/beats.js fills <main> from the live
// catalogue (/api/beats/catalogue) with js/beat-markup.js.
{
  let html = template;
  html = html.replace(/<title>[^<]*<\/title>/, '<title>Track | Creative Sound</title>');
  html = html.split(`${SITE}/beats.html`).join(`${SITE}/track.html`);
  const a = html.indexOf('<main');
  const z = html.indexOf('</main>') + '</main>'.length;
  html = html.slice(0, a)
    + `<main class="beat-page" data-track-page>${EOL}  <div class="bp-wrap"><p class="bp-loading">Loading track…</p></div>${EOL}</main>`
    + html.slice(z);
  html = html.replace(/(<script src="js\/beats\.js[^"]*"><\/script>)/,`<script src="js/beat-markup.js?v=7"></script>${EOL}$1${EOL}<script src="js/messages.js?v=2"></script>`);
  fs.writeFileSync(path.join(ROOT, 'track.html'), html);
}

// Sitemap: beats.html plus every non-demo beat page.
const smPath = path.join(ROOT, 'sitemap.xml');
let sm = fs.readFileSync(smPath, 'utf8');
const smEol = sm.includes('\r\n') ? '\r\n' : '\n';
sm = sm.replace(/\s*<url>\s*<loc>https:\/\/creativesound\.io\/beats(\.html|\/[^<]+)<\/loc>[\s\S]*?<\/url>/g, '');
const today = new Date().toISOString().slice(0, 10);
const entry = (loc, pri) => `  <url>${smEol}    <loc>${loc}</loc>${smEol}    <lastmod>${today}</lastmod>${smEol}    <changefreq>weekly</changefreq>${smEol}    <priority>${pri}</priority>${smEol}  </url>${smEol}`;
// While the store is in private preview nothing goes in the sitemap.
const add = PREVIEW ? '' : [entry(`${SITE}/beats.html`, '0.8'), ...beats.filter((b) => !b.demo).map((b) => entry(`${SITE}/beats/${b.id}.html`, '0.6'))].join('');
sm = sm.replace('</urlset>', `${add}</urlset>`);
fs.writeFileSync(smPath, sm);

console.log(`Built ${beats.length} beat page(s) in beats/ (${beats.filter((b) => b.demo).length} demo, noindex). Sitemap updated.`);
