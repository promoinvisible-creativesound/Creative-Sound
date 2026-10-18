// Type beat and genre pages (/type-beat/…, /genre/…, /type-beats): the list
// comes from the server; this plays previews in place with a small bar at
// the bottom (same look as the producer storefront) and counts the plays.
(() => {
  'use strict';
  const root = document.querySelector('.seo-page');
  if (!root) return;
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  const audio = new Audio();
  audio.preload = 'none';
  let current = null;
  let bar = null;
  const source = (() => {
    try {
      let src = sessionStorage.getItem('cs-src');
      if (!src) {
        const ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : '';
        src = ref && !ref.endsWith('creativesound.io') ? (/google\./.test(ref) ? 'google' : /bing\./.test(ref) ? 'bing' : ref) : 'direct';
        sessionStorage.setItem('cs-src', src);
      }
      return src;
    } catch (e) { return 'direct'; }
  })();
  const logged = new Set();
  const logPlay = (id) => {
    if (logged.has(id)) return;
    logged.add(id);
    const body = JSON.stringify({ beatId: id, kind: 'play', source });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/beats/event', new Blob([body], { type: 'application/json' }))) return; } catch (e) { /* fall through */ }
    fetch('/api/beats/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };

  const sync = () => {
    const playing = !audio.paused;
    root.querySelectorAll('[data-play]').forEach((btn) => {
      const mine = btn.dataset.play === current;
      btn.innerHTML = mine && playing ? PAUSE : PLAY;
      btn.setAttribute('aria-label', `${mine && playing ? 'Pause' : 'Play'} ${btn.dataset.title}`);
      btn.closest('.sf-card').classList.toggle('is-playing', mine);
    });
    if (bar) {
      const t = bar.querySelector('[data-bar-toggle]');
      t.innerHTML = playing ? PAUSE : PLAY;
      t.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
  };
  const showBar = (d) => {
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'sf-bar';
      bar.innerHTML = `
        <span class="sf-bar-art"></span>
        <span class="sf-bar-text"><b></b><small></small></span>
        <button type="button" class="sf-bar-btn" data-bar-toggle></button>
        <a class="btn btn-primary sf-bar-buy" href="#">Licenses</a>
        <span class="sf-bar-progress"><i></i></span>`;
      document.body.appendChild(bar);
      bar.querySelector('[data-bar-toggle]').addEventListener('click', () => { if (audio.paused) audio.play().catch(() => {}); else audio.pause(); });
      requestAnimationFrame(() => bar.classList.add('is-in'));
    }
    bar.querySelector('.sf-bar-art').style.backgroundImage = d.cover ? `url("${d.cover}")` : '';
    bar.querySelector('b').textContent = d.title;
    bar.querySelector('small').textContent = d.meta;
    bar.querySelector('.sf-bar-buy').href = d.href;
  };
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-play]');
    if (!btn) return;
    const d = btn.dataset;
    if (current === d.play && !audio.paused) { audio.pause(); return; }
    if (current !== d.play) { current = d.play; audio.src = d.src; logPlay(d.play); }
    showBar(d);
    audio.play().catch(() => sync());
  });
  ['play', 'pause', 'ended'].forEach((ev) => audio.addEventListener(ev, sync));
  audio.addEventListener('timeupdate', () => {
    if (!bar || !audio.duration) return;
    bar.querySelector('.sf-bar-progress i').style.transform = `scaleX(${audio.currentTime / audio.duration})`;
  });
})();
