/* Beat page markup, shared by scripts/build-beat-pages.js (static pages for
   the catalogue in data/beats.json) and js/beats.js (track.html, the page
   for tracks uploaded by producers and approved on the review page). One
   template, so both kinds of page look and behave the same.
   Node:    require('./js/beat-markup.js').beatMainHtml(beat, { LIC, producers, eol })
   Browser: window.CSBeatMarkup.beatMainHtml(beat, { LIC, producers }) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CSBeatMarkup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  let LIC = null;
  let PRODUCERS = {};
  let EOL = '\n';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (c) => `€${(c / 100).toFixed(2)}`;
  const tiersOf = (b) => LIC.order.filter((t) => b.prices && b.prices[t] > 0);
  const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];
  const VERIFIED = '<svg class="bt-verified" viewBox="0 0 24 24" role="img" aria-label="Verified producer"><title>Verified producer</title><path class="bt-verified-seal" d="M12.0 1.0L12.9 1.4L13.7 2.3L14.4 2.9L15.4 2.8L16.5 2.4L17.5 2.5L18.1 3.3L18.3 4.5L18.6 5.4L19.5 5.7L20.7 5.9L21.5 6.5L21.6 7.5L21.2 8.6L21.1 9.6L21.7 10.3L22.6 11.1L23.0 12.0L22.6 12.9L21.7 13.7L21.1 14.4L21.2 15.4L21.6 16.5L21.5 17.5L20.7 18.1L19.5 18.3L18.6 18.6L18.3 19.5L18.1 20.7L17.5 21.5L16.5 21.6L15.4 21.2L14.4 21.1L13.7 21.7L12.9 22.6L12.0 23.0L11.1 22.6L10.3 21.7L9.6 21.1L8.6 21.2L7.5 21.6L6.5 21.5L5.9 20.7L5.7 19.5L5.4 18.6L4.5 18.3L3.3 18.1L2.5 17.5L2.4 16.5L2.8 15.4L2.9 14.4L2.3 13.7L1.4 12.9L1.0 12.0L1.4 11.1L2.3 10.3L2.9 9.6L2.8 8.6L2.4 7.5L2.5 6.5L3.3 5.9L4.5 5.7L5.4 5.4L5.7 4.5L5.9 3.3L6.5 2.5L7.5 2.4L8.6 2.8L9.6 2.9L10.3 2.3L11.1 1.4Z"/><path class="bt-verified-tick" d="M7.6 12.4l3 3 5.8-6.2"/></svg>';
  const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  function art(b) {
    return b.cover
      ? `<div class="bt-art"><img src="${esc(b.cover)}" alt="${esc(b.title)} cover art"></div>`
      : '<div class="bt-art"><div class="bt-art-gen" aria-hidden="true"></div></div>';
  }

  function mainFor(b) {
    // A beat may carry its own badge (producer uploads, set by the owner);
    // catalogue beats use the producers map.
    const verified = typeof b.verified === 'boolean' ? b.verified : !!(PRODUCERS[b.producer] && PRODUCERS[b.producer].verified);
    const tint = TINTS.includes(b.tint) ? b.tint : 'amber';
    const tiers = tiersOf(b);
    const facts = [['BPM', b.bpm], ['Key', b.key], ['Genre', b.genre], ['Mood', b.mood], ['Released', fmtDate(b.released)]];
    return `<main class="beat-page bt-tint-${tint}" data-beat-id="${esc(b.id)}">
    <div class="bp-wrap">
      <nav class="bp-crumbs" aria-label="Breadcrumb"><a href="beats.html">Tracks</a><span aria-hidden="true">/</span><span>${esc(b.title)}</span></nav>

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
          <p class="bp-producer">${b.producerHandle ? `<a href="artist.html?u=${encodeURIComponent(b.producerHandle)}">${esc(b.producer)}</a>` : esc(b.producer)}${verified ? VERIFIED : ''}</p>
          <ul class="bp-facts">${facts.map(([k, v]) => `<li><span>${k}</span><b>${esc(v)}</b></li>`).join('')}</ul>
          ${b.tags && b.tags.length ? `<div class="bp-tags">${b.tags.map((t) => `<a href="beats.html">#${esc(t)}</a>`).join('')}</div>` : ''}
          <div class="bp-actions">
            <button type="button" class="btn btn-primary" data-play-beat aria-label="Play preview">
              <svg class="bt-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>
              <svg class="bt-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
              Preview
            </button>
            <a href="#licensing" class="btn btn-ghost" onclick="document.getElementById('licensing').scrollIntoView({behavior:'smooth'});return false;">Licenses from ${euro(Math.min(...tiers.map((t) => b.prices[t])))}</a>
            <button type="button" class="btn btn-ghost bp-save" data-save="${esc(b.id)}" aria-pressed="false" aria-label="Save ${esc(b.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3l-1.3-1.2C5.8 14.7 3 12.1 3 8.9 3 6.3 5 4.3 7.6 4.3c1.5 0 2.9.7 3.8 1.8h1.2c.9-1.1 2.3-1.8 3.8-1.8C19 4.3 21 6.3 21 8.9c0 3.2-2.8 5.8-7.7 10.2z"/></svg><span class="bt-save-text">Save</span></button>
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
                <span><span class="bp-tier-name">${esc(t.unlimited ? t.name.replace(/\s*unlimited$/i, '') : t.name)}${t.unlimited ? '<span class="bt-tier-pill">Unlimited</span>' : ''}</span><span class="bp-tier-files">${esc(t.files.map((f) => LIC.fileLabels[f]).join(' + '))}</span></span>
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
        <div class="bp-section-head"><h2 id="bp-about-title">About this track</h2></div>
        <div class="bp-about"><p>${esc(b.about)}</p></div>
      </section>` : ''}

      <section class="bp-section" aria-labelledby="bp-more-title">
        <div class="bp-section-head"><h2 id="bp-more-title">More from ${esc(b.producer)}</h2><a href="beats.html">See all tracks</a></div>
        <div class="bp-row" id="bp-more"></div>
      </section>
    </div>
  </main>`;
  }

  function beatMainHtml(b, ctx) {
    LIC = ctx.LIC;
    PRODUCERS = ctx.producers || {};
    EOL = ctx.eol || '\n';
    return mainFor(b);
  }
  return { beatMainHtml, esc, euro, tiersOf };
});
