// Home page (home.html): the latest tracks from data/beats.json, each with
// a play button so a preview starts without leaving the page.
(() => {
  'use strict';
  const grid = document.getElementById('ho-tracks');
  if (!grid) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];
  const audio = new Audio();
  audio.preload = 'none';
  let playing = null;

  const card = (b, i) => `
    <a class="ho-track t-${TINTS.includes(b.tint) ? b.tint : 'amber'}" href="beats/${encodeURIComponent(b.id)}.html" style="--i:${i}">
      <span class="ho-track-art">
        <span class="ho-cover"></span>
        <button type="button" class="ho-play" data-src="${esc(b.preview)}" aria-label="Play ${esc(b.title)}">
          <svg class="ho-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>
          <svg class="ho-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>
        </button>
      </span>
      <span class="ho-track-body">
        <b class="ho-track-title">${esc(b.title)}</b>
        <span class="ho-track-meta">${esc(b.producer)} · ${b.bpm} BPM</span>
      </span>
    </a>`;

  fetch('/data/beats.json')
    .then((r) => r.json())
    .then((data) => {
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
  const sync = () => { if (playing) playing.classList.toggle('is-playing', !audio.paused); };
  audio.addEventListener('play', sync);
  audio.addEventListener('pause', sync);
  audio.addEventListener('ended', sync);
})();
