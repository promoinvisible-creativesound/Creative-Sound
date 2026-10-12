// Home page (home.html): the news banner from data/news.json and the
// newest tracks from data/beats.json, with a play button on each card.
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];

  /* ---------------------------------- News ---------------------------------- */
  fetch('/data/news.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((n) => {
      const box = $('#ho-news');
      if (!box || !n || n.show === false || !n.title) return;
      box.href = n.link || '/';
      box.querySelector('img').src = n.image || 'assets/img/gui-full-v2.webp';
      const set = (k, v) => { const el = box.querySelector(`[data-news="${k}"]`); if (el) el.textContent = v || ''; };
      set('kicker', n.kicker || 'News');
      set('title', n.title);
      set('text', n.text);
      set('cta', n.cta || 'Read more');
      const d = n.date ? new Date(`${n.date}T12:00:00`) : null;
      set('date', d && !Number.isNaN(d) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
      if (!n.date) box.querySelector('.ho-news-date').hidden = true;
      box.hidden = false;
    })
    .catch(() => {});

  /* --------------------------------- Tracks --------------------------------- */
  const grid = $('#ho-tracks');
  const audio = new Audio();
  audio.preload = 'none';
  let playing = null;

  const euro = (c) => `€${(c / 100).toFixed(2).replace(/\.00$/, '')}`;
  const minPrice = (b) => Math.min(...Object.values(b.prices || {}).filter((p) => p > 0));

  function card(b, i) {
    const tint = TINTS.includes(b.tint) ? b.tint : 'amber';
    return `
      <a class="ho-track t-${tint}" href="beats/${encodeURIComponent(b.id)}.html" data-id="${esc(b.id)}" style="--i:${i}">
        <span class="ho-track-art">
          <span class="ho-cover t-${tint}"></span>
          <button type="button" class="ho-play" data-src="${esc(b.preview)}" aria-label="Play ${esc(b.title)}">
            <svg class="ho-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>
            <svg class="ho-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>
          </button>
        </span>
        <span class="ho-track-body">
          <b class="ho-track-title">${esc(b.title)}</b>
          <span class="ho-track-meta">${esc(b.producer)} · ${b.bpm} BPM · ${esc(b.key)}</span>
          <span class="ho-track-price">From <b>${euro(minPrice(b))}</b></span>
        </span>
      </a>`;
  }

  fetch('/data/beats.json')
    .then((r) => r.json())
    .then((data) => {
      const beats = (data.beats || []).filter((b) => b.status !== 'hidden' && b.preview);
      const newest = [...beats].sort((a, b) => new Date(b.released) - new Date(a.released)).slice(0, 4);
      grid.innerHTML = newest.map(card).join('');
      grid.removeAttribute('aria-busy');
      // Hero stack shows the colours of the featured tracks.
      const featured = beats.filter((b) => b.featured).slice(0, 3);
      const covers = document.querySelectorAll('#ho-stack .ho-cover');
      featured.forEach((b, i) => { if (covers[i]) covers[i].className = `ho-cover t-${TINTS.includes(b.tint) ? b.tint : 'amber'}`; });
    })
    .catch(() => { grid.closest('.ho-section').hidden = true; });

  // Play on the card without leaving the page; the card itself links on.
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
  audio.addEventListener('play', () => { if (playing) playing.classList.add('is-playing'); });
  audio.addEventListener('pause', () => { if (playing) playing.classList.remove('is-playing'); });
  audio.addEventListener('ended', () => { if (playing) playing.classList.remove('is-playing'); });
})();
