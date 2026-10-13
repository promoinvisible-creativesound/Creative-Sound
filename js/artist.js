// Public profile (artist.html?u=<username>): photo, name, verified badge,
// bio, Instagram / TikTok, genres and, for producers, their tracks on sale.
(() => {
  'use strict';
  const root = document.querySelector('[data-artist-page]');
  if (!root) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (c) => `€${(c / 100).toFixed(2)}`;
  const VERIFIED = '<svg class="bt-verified" viewBox="0 0 24 24" role="img" aria-label="Verified producer"><title>Verified producer</title><path class="bt-verified-seal" d="M12.0 1.0L12.9 1.4L13.7 2.3L14.4 2.9L15.4 2.8L16.5 2.4L17.5 2.5L18.1 3.3L18.3 4.5L18.6 5.4L19.5 5.7L20.7 5.9L21.5 6.5L21.6 7.5L21.2 8.6L21.1 9.6L21.7 10.3L22.6 11.1L23.0 12.0L22.6 12.9L21.7 13.7L21.1 14.4L21.2 15.4L21.6 16.5L21.5 17.5L20.7 18.1L19.5 18.3L18.6 18.6L18.3 19.5L18.1 20.7L17.5 21.5L16.5 21.6L15.4 21.2L14.4 21.1L13.7 21.7L12.9 22.6L12.0 23.0L11.1 22.6L10.3 21.7L9.6 21.1L8.6 21.2L7.5 21.6L6.5 21.5L5.9 20.7L5.7 19.5L5.4 18.6L4.5 18.3L3.3 18.1L2.5 17.5L2.4 16.5L2.8 15.4L2.9 14.4L2.3 13.7L1.4 12.9L1.0 12.0L1.4 11.1L2.3 10.3L2.9 9.6L2.8 8.6L2.4 7.5L2.5 6.5L3.3 5.9L4.5 5.7L5.4 5.4L5.7 4.5L5.9 3.3L6.5 2.5L7.5 2.4L8.6 2.8L9.6 2.9L10.3 2.3L11.1 1.4Z"/><path class="bt-verified-tick" d="M7.6 12.4l3 3 5.8-6.2"/></svg>';
  const ICON_IG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';
  const ICON_TT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4v10.5a3.5 3.5 0 1 1-3-3.46"/><path d="M16 4a5 5 0 0 0 5 5"/></svg>';
  const ROLE = { producer: 'Producer', artist: 'Artist', listener: 'Member' };
  const u = new URLSearchParams(location.search).get('u') || '';

  const missing = () => {
    root.innerHTML = '<div class="pf-missing"><h1>Profile not found</h1><p>This page may have moved or the username changed.</p><a href="beats.html" class="btn btn-primary">Browse tracks</a></div>';
  };
  if (!u) { missing(); return; }

  fetch(`/api/profile/public?u=${encodeURIComponent(u)}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then(({ profile: p, tracks }) => {
      const initials = (p.displayName || p.handle).split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
      const genresLabel = p.role === 'producer' ? 'Produces' : 'Into';
      document.title = `${p.displayName} | Creative Sound`;
      root.innerHTML = `
        <section class="pf-hero">
          <div class="pf-avatar">${p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.displayName)}">` : esc(initials)}</div>
          <div class="pf-id">
            ${p.role ? `<span class="pf-role">${ROLE[p.role] || ''}</span>` : ''}
            <h1 class="pf-name">${esc(p.displayName)}${p.verified ? VERIFIED : ''}</h1>
            <p class="pf-handle">@${esc(p.handle)}</p>
            ${p.bio ? `<p class="pf-bio">${esc(p.bio)}</p>` : ''}
            <div class="pf-meta">
              ${p.instagram ? `<a class="pf-social" href="https://instagram.com/${encodeURIComponent(p.instagram)}" target="_blank" rel="noopener noreferrer">${ICON_IG}Instagram</a>` : ''}
              ${p.tiktok ? `<a class="pf-social" href="https://www.tiktok.com/@${encodeURIComponent(p.tiktok)}" target="_blank" rel="noopener noreferrer">${ICON_TT}TikTok</a>` : ''}
            </div>
            ${p.genres.length ? `<div class="pf-genres"><span class="pf-genres-label">${genresLabel}</span>${p.genres.map((g) => `<span>${esc(g)}</span>`).join('')}</div>` : ''}
          </div>
        </section>
        ${p.role === 'producer' ? `
          <section class="pf-section" aria-labelledby="pf-tracks-title">
            <h2 id="pf-tracks-title">Tracks</h2>
            ${tracks.length ? `<div class="pf-tracks">${tracks.map((b, i) => `
              <a class="pf-track" href="track.html?id=${encodeURIComponent(b.id)}" style="--i:${i}">
                <span class="pf-track-art">${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy">` : ''}</span>
                <span class="pf-track-body"><b>${esc(b.title)}</b><span>${b.bpm} BPM · ${esc(b.key)} · ${esc(b.genre)}</span><em>${euro(Math.min(...Object.values(b.prices).filter((x) => x > 0)))}</em></span>
              </a>`).join('')}</div>` : '<p class="pf-empty">No tracks on sale yet.</p>'}
          </section>` : ''}`;
    })
    .catch(missing);
})();
