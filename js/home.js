// Home page (index.html, served on "/"): the latest tracks from
// data/beats.json, each with a play button so a preview starts without
// leaving the page.
(() => {
  'use strict';
  // Cover colour (accent) overrides the fixed tint on producer tracks.
  const accentStyle = (b) => { if (!/^#[0-9a-f]{6}$/i.test(b.accent || '')) return ''; const n = parseInt(b.accent.slice(1), 16); const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; return '--fx:' + rgb.join(',') + ';--fx-hi:' + rgb.map((c) => Math.round(c + (255 - c) * 0.35)).join(',') + ';'; };
  // "/" used to be the Creative Dist page: old links like /#pricing (emails,
  // Stripe, bookmarks) go on to that section of /creative-dist-2.
  const CD_SECTIONS = ['hero', 'artists', 'pricing', 'demo', 'stories', 'chain', 'saturation', 'noise', 'bode', 'flux', 'eq', 'output', 'get-it'];
  if (CD_SECTIONS.includes(location.hash.slice(1))) {
    location.replace(`creative-dist-2${location.hash}`);
    return;
  }
  const grid = document.getElementById('ho-tracks');
  if (!grid) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];
  // Same verified badge as the store (js/beats.js).
  const VERIFIED = '<svg class="bt-verified" viewBox="0 0 24 24" role="img" aria-label="Verified producer"><title>Verified producer</title><path class="bt-verified-seal" d="M12.0 1.0L12.9 1.4L13.7 2.3L14.4 2.9L15.4 2.8L16.5 2.4L17.5 2.5L18.1 3.3L18.3 4.5L18.6 5.4L19.5 5.7L20.7 5.9L21.5 6.5L21.6 7.5L21.2 8.6L21.1 9.6L21.7 10.3L22.6 11.1L23.0 12.0L22.6 12.9L21.7 13.7L21.1 14.4L21.2 15.4L21.6 16.5L21.5 17.5L20.7 18.1L19.5 18.3L18.6 18.6L18.3 19.5L18.1 20.7L17.5 21.5L16.5 21.6L15.4 21.2L14.4 21.1L13.7 21.7L12.9 22.6L12.0 23.0L11.1 22.6L10.3 21.7L9.6 21.1L8.6 21.2L7.5 21.6L6.5 21.5L5.9 20.7L5.7 19.5L5.4 18.6L4.5 18.3L3.3 18.1L2.5 17.5L2.4 16.5L2.8 15.4L2.9 14.4L2.3 13.7L1.4 12.9L1.0 12.0L1.4 11.1L2.3 10.3L2.9 9.6L2.8 8.6L2.4 7.5L2.5 6.5L3.3 5.9L4.5 5.7L5.4 5.4L5.7 4.5L5.9 3.3L6.5 2.5L7.5 2.4L8.6 2.8L9.6 2.9L10.3 2.3L11.1 1.4Z"/><path class="bt-verified-tick" d="M7.6 12.4l3 3 5.8-6.2"/></svg>';
  let producers = {};
  const euro = (c) => `€${(c / 100).toFixed(2)}`;
  const minPrice = (b) => Math.min(...Object.values(b.prices || {}).filter((p) => p > 0));
  const audio = new Audio();
  audio.preload = 'none';
  let playing = null;

  const card = (b, i) => `
    <a class="ho-track t-${TINTS.includes(b.tint) ? b.tint : 'amber'}" href="${b.source === 'producer' ? `track.html?id=${encodeURIComponent(b.id)}` : `beats/${encodeURIComponent(b.id)}.html`}" style="--i:${i};${accentStyle(b)}">
      <span class="ho-track-art">
        ${b.cover ? `<img class="ho-cover-img" src="${esc(b.cover)}" alt="" loading="lazy">` : '<span class="ho-cover"></span>'}
        <button type="button" class="ho-play" data-src="${esc(b.preview)}" aria-label="Play ${esc(b.title)}">
          <svg class="ho-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>
          <svg class="ho-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>
        </button>
      </span>
      <span class="ho-track-body">
        <b class="ho-track-title">${esc(b.title)}</b>
        <span class="ho-track-producer">${esc(b.producer)}${(typeof b.verified === 'boolean' ? b.verified : !!(producers[b.producer] && producers[b.producer].verified)) ? VERIFIED : ''}</span>
        <span class="ho-track-specs"><span>${b.bpm} BPM</span><span>${esc(b.key)}</span><span class="ho-track-genre">${esc(b.genre)}</span></span>
        <span class="ho-track-foot"><b>${euro(minPrice(b))}</b></span>
      </span>
    </a>`;

  // Live catalogue (approved producer uploads included); static file as fallback.
  fetch('/api/beats/catalogue')
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .catch(() => fetch('/data/beats.json').then((r) => r.json()))
    .then((data) => {
      producers = data.producers || {};
      const latest = (data.beats || [])
        .filter((b) => b.status !== 'hidden' && b.preview)
        .sort((a, b) => new Date(b.released) - new Date(a.released))
        .slice(0, 4);
      grid.innerHTML = latest.map(card).join('');
      grid.removeAttribute('aria-busy');
    })
    .catch(() => { grid.hidden = true; });

  // Play on the cover; the rest of the card links to the track page.
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.ho-play');
    if (!btn) return;
    e.preventDefault();
    const cardEl = btn.closest('.ho-track');
    if (playing === cardEl && !audio.paused) { audio.pause(); return; }
    if (playing !== cardEl) {
      if (playing) playing.classList.remove('is-playing');
      playing = cardEl;
      audio.src = btn.dataset.src;
    }
    audio.play().catch(() => {});
  });
  // Pointer tilt like the pack cards (max 6deg), fine pointers only.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    let current = null;
    let last = null;
    let frame = 0;
    const reset = (c) => { if (!c) return; c.classList.remove('is-tilting'); c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); };
    const apply = () => {
      frame = 0;
      if (!current || !last) return;
      const r = current.getBoundingClientRect();
      current.style.setProperty('--ry', `${(((last.clientX - r.left) / r.width - 0.5) * 12).toFixed(2)}deg`);
      current.style.setProperty('--rx', `${((0.5 - (last.clientY - r.top) / r.height) * 8.4).toFixed(2)}deg`);
    };
    grid.addEventListener('pointermove', (e) => {
      const c = e.target.closest('.ho-track');
      if (c !== current) { reset(current); current = c; if (c) c.classList.add('is-tilting'); }
      last = e;
      if (current && !frame) frame = requestAnimationFrame(apply);
    });
    grid.addEventListener('pointerleave', () => { reset(current); current = null; });
  }

  const sync = () => { if (playing) playing.classList.toggle('is-playing', !audio.paused); };
  audio.addEventListener('play', sync);
  audio.addEventListener('pause', sync);
  audio.addEventListener('ended', sync);

  // "Sell your tracks": play the step animation once the tile is in view,
  // and size the travelling light to the line between the first and last step.
  const sell = document.getElementById('ho-sell');
  if (sell) {
    const flow = sell.querySelector('.ho-sf');
    const span = () => {
      const s = flow.querySelectorAll('.ho-sf-step');
      if (s.length > 2) flow.style.setProperty('--sf-span', `${s[2].offsetLeft - s[0].offsetLeft}px`);
    };
    span();
    window.addEventListener('resize', span, { passive: true });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        if (entries.some((en) => en.isIntersecting)) { sell.classList.add('is-in'); io.disconnect(); }
      }, { threshold: 0.35 });
      io.observe(sell);
    } else {
      sell.classList.add('is-in');
    }
  }
})();
