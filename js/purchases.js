// "Licenses & downloads" (profile-license.html): everything the account
// owns, split into Plugins, Packs and Tracks, with a segmented filter.
(() => {
  'use strict';
  const root = document.getElementById('purchases-root');
  if (!root) return;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const PACK_ART = {
    'creative-presets-vol-1': 'assets/img/creative-presets-tile.webp',
    'creative-presets-vol-2': 'assets/img/creative-presets-2-tile.webp',
  };
  const DL = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/></svg>';
  const COPY = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="2"/><path d="M10.5 5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5H5"/></svg>';
  const pill = (href, text, primary, attrs = '') => `<a href="${esc(href)}" class="lp-pill${primary ? ' is-primary' : ''}" ${attrs}>${DL}<span>${esc(text)}</span></a>`;
  const empty = (text, href, cta) => `<div class="lp-empty"><p>${text}</p><a href="${href}" class="lp-link">${cta} ›</a></div>`;

  function plugins(list) {
    if (!list.length) return empty('No plugin licenses on this account yet.', 'creative-dist-2', 'Get Creative Dist 2.0');
    return list.map((lic) => `
      <article class="lp-item">
        <img class="lp-art lp-art-plugin" src="assets/img/gui-full.webp" alt="" loading="lazy">
        <div class="lp-main">
          <b>Creative Dist 2.0</b>
          <small>Issued ${day(lic.created_at)}</small>
          <div class="lp-key"><code>${esc(lic.license_key)}</code><button type="button" class="lp-copy" data-copy="${esc(lic.license_key)}" aria-label="Copy license key">${COPY}</button></div>
        </div>
        <div class="lp-actions">
          ${pill('assets/downloads/Creative-Dist-Mac.zip', 'macOS', true, 'download')}
          ${pill('assets/downloads/Creative-Dist-Windows.zip', 'Windows', true, 'download')}
        </div>
      </article>`).join('');
  }

  function packs(list) {
    const seen = new Set();
    const unique = list.filter((p) => (seen.has(p.pack_id) ? false : seen.add(p.pack_id)));
    if (!unique.length) return empty('No packs on this account yet.', 'packs.html', 'Browse packs');
    return unique.map((p) => `
      <article class="lp-item">
        <img class="lp-art" src="${PACK_ART[p.pack_id] || 'assets/img/preset-packs-usb.webp'}" alt="" loading="lazy">
        <div class="lp-main">
          <b>${esc(p.name)}</b>
          <small>Serum presets · Added ${day(p.created_at)}</small>
        </div>
        <div class="lp-actions">
          ${p.download_url ? pill(p.download_url, 'Download', true) : '<small class="lp-wait">Being prepared</small>'}
        </div>
      </article>`).join('');
  }

  function tracks(list) {
    if (!list.length) return empty('No tracks on this account yet.', 'beats.html', 'Browse tracks');
    return list.map((b) => `
      <article class="lp-item">
        ${b.cover ? `<img class="lp-art" src="${esc(b.cover)}" alt="" loading="lazy">` : '<span class="lp-art lp-art-empty"></span>'}
        <div class="lp-main">
          <b>${esc(b.title)}</b>
          <small>${esc(b.tier_name)} · prod. ${esc(b.producer)} · ${day(b.created_at)}</small>
          <small class="lp-id">License ${esc(b.license_id)} · <a class="lp-link lp-view" href="/api/beats/license?id=${encodeURIComponent(b.license_id)}&view=1" target="_blank" rel="noopener">View terms</a></small>
        </div>
        <div class="lp-actions">
          ${b.files.length ? b.files.map((f) => pill(f.url, f.label, f.type === 'wav')).join('') : '<small class="lp-wait">Files being prepared</small>'}
          ${pill(`/api/beats/license?id=${encodeURIComponent(b.license_id)}`, 'License PDF', false)}
        </div>
      </article>`).join('');
  }

  function paint(data) {
    const groups = {
      plugins: data.licenses || [],
      packs: data.packs || [],
      tracks: data.beats || [],
    };
    $('#lp-plugins').innerHTML = plugins(groups.plugins);
    $('#lp-packs').innerHTML = packs(groups.packs);
    $('#lp-tracks').innerHTML = tracks(groups.tracks);
    $('#lp-count-plugins').textContent = groups.plugins.length;
    $('#lp-count-packs').textContent = new Set(groups.packs.map((p) => p.pack_id)).size;
    $('#lp-count-tracks').textContent = groups.tracks.length;
    root.removeAttribute('aria-busy');
  }

  // Segmented filter: All / Plugins / Packs / Tracks
  const seg = $('#lp-seg');
  const show = (which) => {
    seg.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.show === which;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    root.querySelectorAll('.lp-group').forEach((g) => { g.hidden = which !== 'all' && g.dataset.group !== which; });
    try { history.replaceState(null, '', which === 'all' ? location.pathname : `#${which}`); } catch (e) {}
  };
  seg.addEventListener('click', (e) => { const b = e.target.closest('[data-show]'); if (b) show(b.dataset.show); });
  const start = location.hash.slice(1);
  if (['plugins', 'packs', 'tracks'].includes(start)) show(start);

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); b.classList.add('is-done'); setTimeout(() => b.classList.remove('is-done'), 1400); } catch (err) {}
  });

  fetch('/api/auth/me')
    .then((r) => {
      if (r.status === 401) { window.location.href = 'login.html'; return null; }
      return r.ok ? r.json() : Promise.reject(new Error('Could not load your purchases.'));
    })
    .then((d) => { if (d) paint(d); })
    .catch((err) => { root.innerHTML = `<p class="auth-error visible">${esc(err.message)}</p>`; });
})();
