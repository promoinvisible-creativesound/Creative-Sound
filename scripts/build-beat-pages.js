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
const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];
const VERIFIED = '<svg class="bt-verified" viewBox="0 0 24 24" role="img" aria-label="Verified producer"><path d="M12 1.8l2.5 1.9 3.1-.2.9 3 2.6 1.7-.9 3 .9 3-2.6 1.7-.9 3-3.1-.2L12 22.2l-2.5-1.9-3.1.2-.9-3-2.6-1.7.9-3-.9-3 2.6-1.7.9-3 3.1.2z" fill="currentColor"/><path d="M8.2 12.3l2.5 2.5 5.1-5.3" fill="none" stroke="#0a0a09" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function art(b) {
  return b.cover
    ? `<div class="bt-art"><img src="${esc(b.cover)}" alt="${esc(b.title)} cover art"></div>`
    : `<div class="bt-art"><div class="bt-art-gen" aria-hidden="true"></div><span class="bt-art-word" aria-hidden="true">${esc(b.title)}</span><span class="bt-art-bpm" aria-hidden="true">${b.bpm} BPM</span></div>`;
}

function mainFor(b) {
  const verified = catalogue.producers && catalogue.producers[b.producer] && catalogue.producers[b.producer].verified;
  const tint = TINTS.includes(b.tint) ? b.tint : 'amber';
  const tiers = tiersOf(b);
  const facts = [['BPM', b.bpm], ['Key', b.key], ['Genre', b.genre], ['Mood', b.mood], ['Released', fmtDate(b.released)]];
  return `<main class="beat-page bt-tint-${tint}" data-beat-id="${esc(b.id)}">
  <div class="bp-wrap">
    <nav class="bp-crumbs" aria-label="Breadcrumb"><a href="beats.html">Beats</a><span aria-hidden="true">/</span><span>${esc(b.title)}</span></nav>

    <section class="bp-hero" aria-label="${esc(b.title)}">
      <div class="bp-cover">
        ${art(b)}
        <button type="button" class="bp-cover-play" data-play-beat aria-label="Play preview">
          <svg class="bt-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>
          <svg class="bt-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="bp-info">
        <p class="bp-kicker">${esc(b.genre)} · ${esc(b.mood)}${b.typeBeat && b.typeBeat.length ? ` · ${esc(b.typeBeat.join(', '))} type beat` : ''}</p>
        <h1 class="bp-title">${esc(b.title)}</h1>
        <p class="bp-producer">prod. ${esc(b.producer)}${verified ? VERIFIED : ''}</p>
        <ul class="bp-facts">${facts.map(([k, v]) => `<li><span>${k}</span><b>${esc(v)}</b></li>`).join('')}</ul>
        ${b.tags && b.tags.length ? `<div class="bp-tags">${b.tags.map((t) => `<a href="beats.html">#${esc(t)}</a>`).join('')}</div>` : ''}
        <div class="bp-actions">
          <button type="button" class="btn btn-primary" data-play-beat aria-label="Play preview">
            <svg class="bt-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>
            <svg class="bt-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
            Preview
          </button>
          <a href="#licensing" class="btn btn-ghost" onclick="document.getElementById('licensing').scrollIntoView({behavior:'smooth'});return false;">Licenses from ${euro(Math.min(...tiers.map((t) => b.prices[t])))}</a>
          <button type="button" class="btn btn-ghost" id="bp-share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Share</span></button>
        </div>
      </div>
    </section>

    <section class="bp-section" id="licensing" aria-labelledby="bp-licensing-title">
      <div class="bp-section-head"><h2 id="bp-licensing-title">Licensing</h2></div>
      <div class="bp-licensing">
        <div class="bp-license-box">
          <div class="bp-license-top">
            <div class="bp-total"><span>Total</span><strong id="bp-total">${euro(b.prices[tiers.includes('wav') ? 'wav' : tiers[0]])}</strong></div>
            <div class="bp-license-buttons">
              <button type="button" class="btn btn-ghost" id="bp-add">Add to cart</button>
              <button type="button" class="btn btn-primary" id="bp-buy">Buy now</button>
            </div>
          </div>
          <div class="bp-tiers" id="bp-tiers" role="radiogroup" aria-label="License">
            ${tiers.map((id) => {
              const t = LIC.tiers[id];
              return `<label class="bp-tier" data-tier="${id}">
              <input type="radio" name="bp-tier" value="${id}">
              <span class="bt-tier-radio" aria-hidden="true"></span>
              <span><span class="bp-tier-name">${esc(t.name)}${t.unlimited ? '<span class="bt-tier-pill">Unlimited</span>' : ''}</span><span class="bp-tier-files">${esc(t.files.map((f) => LIC.fileLabels[f]).join(' + '))}</span></span>
              <span class="bp-tier-price">${euro(b.prices[id])}</span>
            </label>`;
            }).join(`${EOL}            `)}
          </div>
        </div>
        <div class="bp-usage-box" aria-live="polite">
          <h3 id="bp-usage-title"></h3>
          <p>Non-exclusive. Credit "prod. by ${esc(b.producer)}". Full terms in the license PDF you receive by email.</p>
          <ul class="bp-usage" id="bp-usage"></ul>
        </div>
      </div>
    </section>

    ${b.about ? `<section class="bp-section" aria-labelledby="bp-about-title">
      <div class="bp-section-head"><h2 id="bp-about-title">About this beat</h2></div>
      <div class="bp-about"><p>${esc(b.about)}</p></div>
    </section>` : ''}

    <section class="bp-section" aria-labelledby="bp-more-title">
      <div class="bp-section-head"><h2 id="bp-more-title">More from ${esc(b.producer)}</h2><a href="beats.html">See all beats</a></div>
      <div class="bp-row" id="bp-more"></div>
    </section>

    <section class="bp-section" aria-labelledby="bp-related-title">
      <div class="bp-section-head"><h2 id="bp-related-title">Related tracks</h2></div>
      <div class="bp-row" id="bp-related"></div>
    </section>
  </div>
</main>`;
}

function pageFor(b) {
  const url = `${SITE}/beats/${b.id}.html`;
  const tiers = tiersOf(b);
  const prices = tiers.map((t) => b.prices[t]);
  const title = `${b.title} (prod. ${b.producer}) | ${b.genre} beat | Creative Sound`;
  const desc = `${b.title}: ${b.genre.toLowerCase()} beat by ${b.producer}, ${b.bpm} BPM in ${b.key}. Preview it and license it from ${euro(Math.min(...prices))}: MP3, WAV, stems or FL Studio project.`;
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
  const robots = b.demo ? `${EOL}<meta name="robots" content="noindex,follow">` : '';
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

// Sitemap: beats.html plus every non-demo beat page.
const smPath = path.join(ROOT, 'sitemap.xml');
let sm = fs.readFileSync(smPath, 'utf8');
const smEol = sm.includes('\r\n') ? '\r\n' : '\n';
sm = sm.replace(/\s*<url>\s*<loc>https:\/\/creativesound\.io\/beats(\.html|\/[^<]+)<\/loc>[\s\S]*?<\/url>/g, '');
const today = new Date().toISOString().slice(0, 10);
const entry = (loc, pri) => `  <url>${smEol}    <loc>${loc}</loc>${smEol}    <lastmod>${today}</lastmod>${smEol}    <changefreq>weekly</changefreq>${smEol}    <priority>${pri}</priority>${smEol}  </url>${smEol}`;
const add = [entry(`${SITE}/beats.html`, '0.8'), ...beats.filter((b) => !b.demo).map((b) => entry(`${SITE}/beats/${b.id}.html`, '0.6'))].join('');
sm = sm.replace('</urlset>', `${add}</urlset>`);
fs.writeFileSync(smPath, sm);

console.log(`Built ${beats.length} beat page(s) in beats/ (${beats.filter((b) => b.demo).length} demo, noindex). Sitemap updated.`);
