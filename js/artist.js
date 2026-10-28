// Public profile / producer storefront (creativesound.io/@handle, or
// artist.html?u=handle): banner, colour, pinned tracks, all tracks with a
// genre filter and sort, previews played in place, Share and Message.
(() => {
  'use strict';
  const root = document.querySelector('[data-artist-page]');
  if (!root) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (c) => `€${(c / 100).toFixed(2)}`;
  const VERIFIED = '<svg class="bt-verified" viewBox="0 0 24 24" role="img" aria-label="Verified producer"><title>Verified producer</title><path class="bt-verified-seal" d="M12.0 1.0L12.9 1.4L13.7 2.3L14.4 2.9L15.4 2.8L16.5 2.4L17.5 2.5L18.1 3.3L18.3 4.5L18.6 5.4L19.5 5.7L20.7 5.9L21.5 6.5L21.6 7.5L21.2 8.6L21.1 9.6L21.7 10.3L22.6 11.1L23.0 12.0L22.6 12.9L21.7 13.7L21.1 14.4L21.2 15.4L21.6 16.5L21.5 17.5L20.7 18.1L19.5 18.3L18.6 18.6L18.3 19.5L18.1 20.7L17.5 21.5L16.5 21.6L15.4 21.2L14.4 21.1L13.7 21.7L12.9 22.6L12.0 23.0L11.1 22.6L10.3 21.7L9.6 21.1L8.6 21.2L7.5 21.6L6.5 21.5L5.9 20.7L5.7 19.5L5.4 18.6L4.5 18.3L3.3 18.1L2.5 17.5L2.4 16.5L2.8 15.4L2.9 14.4L2.3 13.7L1.4 12.9L1.0 12.0L1.4 11.1L2.3 10.3L2.9 9.6L2.8 8.6L2.4 7.5L2.5 6.5L3.3 5.9L4.5 5.7L5.4 5.4L5.7 4.5L5.9 3.3L6.5 2.5L7.5 2.4L8.6 2.8L9.6 2.9L10.3 2.3L11.1 1.4Z"/><path class="bt-verified-tick" d="M7.6 12.4l3 3 5.8-6.2"/></svg>';
  const ICON_IG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';
  const ICON_TT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4v10.5a3.5 3.5 0 1 1-3-3.46"/><path d="M16 4a5 5 0 0 0 5 5"/></svg>';
  const ICON_MAIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6 8.5-6"/></svg>';
  const ICON_YT = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="4"/><path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor" stroke="none"/></svg>';
  const ICON_SP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M7.2 9.4c3.4-1 7-.7 9.8.9M7.7 12.5c2.8-.8 5.7-.5 8 .8M8.3 15.4c2.2-.6 4.4-.4 6.2.6"/></svg>';
  const ROLE = { producer: 'Producer', artist: 'Artist', listener: 'Member' };
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';
  const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
  const ICON_MSG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';
  const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const ICON_PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/></svg>';

  // Handle from /@handle (storefront link) or artist.html?u=handle.
  const fromPath = /^\/@([^/?#]+)/.exec(location.pathname);
  const u = fromPath ? decodeURIComponent(fromPath[1]) : new URLSearchParams(location.search).get('u') || '';

  const missing = () => {
    root.innerHTML = '<div class="pf-missing"><h1>Profile not found</h1><p>This page may have moved or the username changed.</p><a href="/beats.html" class="btn btn-primary">Browse tracks</a></div>';
  };
  if (!u) { missing(); return; }

  const minPrice = (b) => Math.min(...Object.values(b.prices || {}).filter((x) => x > 0));
  const trackUrl = (b) => `/track.html?id=${encodeURIComponent(b.id)}`;
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');

  /* ---------------------------------- Player -------------------------------- */
  // One preview at a time, played right on the storefront; a small bar at the
  // bottom keeps the controls in reach while scrolling.
  const audio = new Audio();
  audio.preload = 'none';
  let byId = new Map();
  let current = null;
  let bar = null;
  const source = (() => { try { return sessionStorage.getItem('cs-src') || 'direct'; } catch (e) { return 'direct'; } })();
  const logged = new Set();
  const logPlay = (b) => {
    if (logged.has(b.id)) return;
    logged.add(b.id);
    const body = JSON.stringify({ beatId: b.id, kind: 'play', source });
    try { if (navigator.sendBeacon && navigator.sendBeacon('/api/beats/event', new Blob([body], { type: 'application/json' }))) return; } catch (e) { /* fall through */ }
    fetch('/api/beats/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  };
  const sync = () => {
    const playing = !audio.paused;
    root.querySelectorAll('[data-play]').forEach((btn) => {
      const on = btn.dataset.play === current && playing;
      btn.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
      btn.setAttribute('aria-label', `${on ? 'Pause' : 'Play'} ${byId.get(btn.dataset.play).title}`);
      btn.closest('.sf-card, .sf-feat').classList.toggle('is-playing', btn.dataset.play === current);
    });
    if (bar) {
      const t = bar.querySelector('[data-bar-toggle]');
      t.innerHTML = playing ? ICON_PAUSE : ICON_PLAY;
      t.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    }
  };
  const showBar = (b) => {
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
      bar.style.setProperty('--sf-accent', getComputedStyle(root).getPropertyValue('--sf-accent').trim() || '#e8862c');
      bar.querySelector('[data-bar-toggle]').addEventListener('click', () => toggle(current));
      requestAnimationFrame(() => bar.classList.add('is-in'));
    }
    bar.querySelector('.sf-bar-art').style.backgroundImage = b.cover ? `url("${b.cover}")` : '';
    bar.querySelector('b').textContent = b.title;
    bar.querySelector('small').textContent = [b.bpm ? `${b.bpm} BPM` : '', b.key, b.genre].filter(Boolean).join(' · ');
    bar.querySelector('.sf-bar-buy').href = trackUrl(b);
  };
  const toggle = (id) => {
    const b = byId.get(id);
    if (!b) return;
    if (current === id && !audio.paused) { audio.pause(); return; }
    if (current !== id) { current = id; audio.src = b.preview; logPlay(b); }
    showBar(b);
    audio.play().catch(() => sync());
  };
  ['play', 'pause', 'ended'].forEach((ev) => audio.addEventListener(ev, sync));
  audio.addEventListener('timeupdate', () => {
    if (!bar || !audio.duration) return;
    bar.querySelector('.sf-bar-progress i').style.transform = `scaleX(${audio.currentTime / audio.duration})`;
  });

  /* ---------------------------------- Render -------------------------------- */
  const meta = (b) => [b.bpm ? `${b.bpm} BPM` : '', b.key, b.genre].filter(Boolean).map(esc).join(' · ');
  const card = (b, i) => `
    <article class="sf-card" style="--i:${i}${b.accent ? `; --c:${b.accent}` : ''}">
      <div class="sf-card-art">
        ${b.cover ? `<img src="${esc(b.coverSm || b.cover)}" alt="" loading="lazy" decoding="async">` : ''}
        <button type="button" class="sf-play" data-play="${esc(b.id)}" aria-label="Play ${esc(b.title)}">${ICON_PLAY}</button>
      </div>
      <a class="sf-card-body" href="${trackUrl(b)}">
        <b>${esc(b.title)}</b>
        <span>${meta(b)}</span>
        ${Number.isFinite(minPrice(b)) ? `<em>From ${euro(minPrice(b))}</em>` : ''}
      </a>
    </article>`;
  const feat = (b, i) => `
    <article class="sf-feat" style="--i:${i}${b.accent ? `; --c:${b.accent}` : ''}">
      <div class="sf-feat-art">
        ${b.cover ? `<img src="${esc(b.coverSm || b.cover)}" alt="" loading="lazy" decoding="async">` : ''}
        <button type="button" class="sf-play sf-play-lg" data-play="${esc(b.id)}" aria-label="Play ${esc(b.title)}">${ICON_PLAY}</button>
      </div>
      <div class="sf-feat-body">
        <span class="sf-pin">${ICON_PIN}Pinned</span>
        <b>${esc(b.title)}</b>
        <span>${meta(b)}</span>
        <a class="sf-feat-buy" href="${trackUrl(b)}">${Number.isFinite(minPrice(b)) ? `From ${euro(minPrice(b))}` : 'View track'}</a>
      </div>
    </article>`;

  fetch(`/api/profile/public?u=${encodeURIComponent(u)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(({ profile: p, tracks }) => {
      const initials = (p.displayName || p.handle).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const genresLabel = p.role === 'producer' ? 'Produces' : 'Into';
      const store = p.store || {};
      const isProducer = p.role === 'producer';
      const link = `${location.origin}/@${p.handle}`;
      document.title = `${p.displayName}${isProducer ? ' · Tracks' : ''} | Creative Sound`;
      if (fromPath === null && isProducer && history.replaceState) history.replaceState(null, '', `/@${p.handle}`);
      if (store.accent) {
        root.style.setProperty('--sf-accent', store.accent);
        root.style.setProperty('--sf-accent-rgb', rgb(store.accent));
      }
      byId = new Map(tracks.map((b) => [b.id, b]));
      const pinned = (store.pinned || []).map((id) => byId.get(id)).filter(Boolean);
      const genres = [...new Set(tracks.map((b) => b.genre).filter(Boolean))];
      root.classList.toggle('is-store', isProducer);
      root.innerHTML = `
        <section class="pf-hero sf-hero${store.banner ? ' has-banner' : ''}">
          ${isProducer ? `<div class="sf-banner" aria-hidden="true">${store.banner ? `<img src="${esc(store.banner)}" alt="">` : ''}</div>` : ''}
          <div class="pf-avatar">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.displayName)}">` : esc(initials)}</div>
          <div class="pf-id">
            ${p.role ? `<span class="pf-role">${ROLE[p.role] || ''}</span>` : ''}
            <h1 class="pf-name">${esc(p.displayName)}${p.verified ? VERIFIED : ''}</h1>
            <p class="pf-handle">@${esc(p.handle)}${isProducer ? ` · ${tracks.length} track${tracks.length === 1 ? '' : 's'}` : ''}</p>
            ${store.headline ? `<p class="sf-headline">${esc(store.headline)}</p>` : ''}
            ${p.bio ? `<p class="pf-bio">${esc(p.bio)}</p>` : ''}
            <div class="pf-meta">
              <span class="sf-actions" data-actions><button type="button" class="sf-act" data-share>${ICON_SHARE}<span>Share</span></button></span>
              ${p.instagram ? `<a class="pf-social" href="https://instagram.com/${encodeURIComponent(p.instagram)}" target="_blank" rel="noopener noreferrer">${ICON_IG}Instagram</a>` : ''}
              ${p.tiktok ? `<a class="pf-social" href="https://www.tiktok.com/@${encodeURIComponent(p.tiktok)}" target="_blank" rel="noopener noreferrer">${ICON_TT}TikTok</a>` : ''}
              ${p.youtube ? `<a class="pf-social" href="${esc(p.youtube)}" target="_blank" rel="noopener noreferrer">${ICON_YT}YouTube</a>` : ''}
              ${p.spotify ? `<a class="pf-social" href="${esc(p.spotify)}" target="_blank" rel="noopener noreferrer">${ICON_SP}Spotify</a>` : ''}
              ${p.contactEmail ? `<a class="pf-social" href="mailto:${encodeURIComponent(p.contactEmail).replace('%40', '@')}">${ICON_MAIL}Email</a>` : ''}
            </div>
            ${p.genres.length ? `<div class="pf-genres"><span class="pf-genres-label">${genresLabel}</span>${p.genres.map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
          </div>
        </section>
        ${isProducer && pinned.length ? `
          <section class="pf-section" aria-labelledby="sf-feat-title">
            <h2 id="sf-feat-title">Featured</h2>
            <div class="sf-feats sf-feats-${pinned.length}">${pinned.map(feat).join('')}</div>
          </section>` : ''}
        ${isProducer ? `
          <section class="pf-section" aria-labelledby="pf-tracks-title">
            <div class="sf-tracks-head">
              <h2 id="pf-tracks-title">All tracks</h2>
              ${tracks.length > 1 ? `<label class="sf-sort"><span>Sort</span><select data-sort>
                <option value="new">Newest</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option><option value="bpm">BPM</option>
              </select></label>` : ''}
            </div>
            ${genres.length > 1 ? `<div class="sf-chips" role="group" aria-label="Filter by genre"><button type="button" class="is-on" data-genre="" aria-pressed="true">All</button>${genres.map((g) => `<button type="button" data-genre="${esc(g)}" aria-pressed="false">${esc(g)}</button>`).join('')}</div>` : ''}
            ${tracks.length ? '<div class="sf-grid" data-grid></div>' : '<p class="pf-empty">No tracks on sale yet.</p>'}
          </section>` : ''}`;

      // Grid: genre filter + sort.
      let genre = '';
      let sort = 'new';
      const grid = root.querySelector('[data-grid]');
      const paint = () => {
        if (!grid) return;
        let list = tracks.filter((b) => !genre || b.genre === genre);
        if (sort === 'new') list = list.slice().sort((a, b) => String(b.released).localeCompare(String(a.released)));
        if (sort === 'low') list = list.slice().sort((a, b) => minPrice(a) - minPrice(b));
        if (sort === 'high') list = list.slice().sort((a, b) => minPrice(b) - minPrice(a));
        if (sort === 'bpm') list = list.slice().sort((a, b) => (a.bpm || 0) - (b.bpm || 0));
        grid.innerHTML = list.map(card).join('');
        sync();
      };
      paint();
      root.addEventListener('click', (e) => {
        const play = e.target.closest('[data-play]');
        if (play) { toggle(play.dataset.play); return; }
        const chip = e.target.closest('[data-genre]');
        if (chip) {
          genre = chip.dataset.genre;
          root.querySelectorAll('[data-genre]').forEach((c) => { const on = c === chip; c.classList.toggle('is-on', on); c.setAttribute('aria-pressed', String(on)); });
          paint();
          return;
        }
        const share = e.target.closest('[data-share]');
        if (share) {
          const label = share.querySelector('span');
          if (navigator.share && matchMedia('(pointer: coarse)').matches) {
            navigator.share({ title: `${p.displayName} on Creative Sound`, url: link }).catch(() => {});
            return;
          }
          (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => {
            label.textContent = 'Link copied';
            setTimeout(() => { label.textContent = 'Share'; }, 1800);
          }).catch(() => { window.prompt('Copy your link', link); });
        }
      });
      const sel = root.querySelector('[data-sort]');
      if (sel) sel.addEventListener('change', () => { sort = sel.value; paint(); });

      // Message the producer, or edit your own storefront.
      const actions = root.querySelector('[data-actions]');
      if (actions) {
        Promise.resolve(window.csMe).then((me) => {
          const own = me && me.handle && me.handle.toLowerCase() === p.handle.toLowerCase();
          actions.insertAdjacentHTML('afterbegin', own
            ? (isProducer ? `<a class="sf-act is-main" href="/profile-producer.html#storefront">${ICON_EDIT}<span>Edit storefront</span></a>` : `<a class="sf-act is-main" href="/profile-public.html">${ICON_EDIT}<span>Edit profile</span></a>`)
            : `<a class="sf-act is-main" href="/messages.html?with=${encodeURIComponent(p.uid)}">${ICON_MSG}<span>Message</span></a>`);
        });
      }
    })
    .catch(missing);
})();
