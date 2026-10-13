// Orders (profile-orders.html): every purchase on the account (plugin,
// packs, tracks), newest first, grouped by month, with totals on top.
(() => {
  'use strict';
  const root = document.getElementById('orders-v2');
  if (!root) return;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents, cur) => {
    if (!cents) return 'Free';
    try { return new Intl.NumberFormat('en-IE', { style: 'currency', currency: (cur || 'eur').toUpperCase() }).format(cents / 100); } catch (e) { return `€${(cents / 100).toFixed(2)}`; }
  };
  const day = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const month = (d) => new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const PACK_ART = {
    'creative-presets-vol-1': 'assets/img/creative-presets-tile.webp',
    'creative-presets-vol-2': 'assets/img/creative-presets-2-tile.webp',
  };

  function rows(data) {
    const out = [];
    (data.licenses || []).forEach((l) => out.push({
      kind: 'plugins', label: 'Plugin', name: 'Creative Dist 2.0', date: l.created_at,
      cents: l.amount_total, cur: l.currency, art: 'assets/img/gui-full.webp', plugin: true,
      ref: l.license_key ? `License ${String(l.license_key).slice(0, 7)}…` : '',
    }));
    (data.packs || []).forEach((p) => out.push({
      kind: 'packs', label: 'Pack', name: p.name, date: p.created_at,
      cents: p.amount_total, cur: p.currency, art: PACK_ART[p.pack_id] || 'assets/img/preset-packs-usb.webp', ref: 'Serum presets',
    }));
    (data.beats || []).forEach((b) => out.push({
      kind: 'tracks', label: 'Track', name: b.title, date: b.created_at,
      cents: b.price_cents, cur: b.currency, art: b.cover, ref: `${b.tier_name} · prod. ${b.producer}`,
    }));
    return out.sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  function paint(list, filter) {
    const shown = filter === 'all' ? list : list.filter((r) => r.kind === filter);
    if (!shown.length) {
      $('#or-list').innerHTML = `<div class="lp-list"><div class="lp-empty"><p>${list.length ? 'Nothing in this category yet.' : 'No orders yet.'}</p><a href="packs.html" class="lp-link">Browse the store ›</a></div></div>`;
      return;
    }
    const groups = new Map();
    shown.forEach((r) => { const k = month(r.date); groups.set(k, [...(groups.get(k) || []), r]); });
    $('#or-list').innerHTML = [...groups].map(([m, items]) => `
      <p class="pe-group-label">${esc(m)}</p>
      <div class="lp-list">${items.map((r) => `
        <article class="lp-item or-item">
          ${r.art ? `<img class="lp-art${r.plugin ? ' lp-art-plugin' : ''}" src="${esc(r.art)}" alt="" loading="lazy">` : '<span class="lp-art lp-art-empty"></span>'}
          <div class="lp-main">
            <b>${esc(r.name)}</b>
            <small><span class="or-kind">${r.label}</span> ${esc(r.ref)}</small>
          </div>
          <div class="or-side"><b>${money(r.cents, r.cur)}</b><small>${day(r.date)}</small></div>
        </article>`).join('')}
      </div>`).join('');
  }

  fetch('/api/auth/me')
    .then((r) => {
      if (r.status === 401) { window.location.href = 'login.html'; return null; }
      return r.ok ? r.json() : Promise.reject(new Error('Could not load your orders.'));
    })
    .then((data) => {
      if (!data) return;
      const list = rows(data);
      const paid = list.filter((r) => r.cents > 0);
      // Totals per currency (normally just EUR).
      const totals = {};
      paid.forEach((r) => { const c = (r.cur || 'eur').toLowerCase(); totals[c] = (totals[c] || 0) + r.cents; });
      $('#or-total').textContent = Object.keys(totals).length ? Object.entries(totals).map(([c, v]) => money(v, c)).join(' + ') : money(0);
      $('#or-count').textContent = String(list.length);
      const last = list.length ? new Date(list[0].date) : null;
      $('#or-last').textContent = last ? last.toLocaleDateString('en-GB', last.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' }) : '—';
      let filter = ['plugins', 'packs', 'tracks'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'all';
      const seg = $('#or-seg');
      const sync = () => seg.querySelectorAll('button').forEach((b) => { const on = b.dataset.show === filter; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('[data-show]');
        if (!b) return;
        filter = b.dataset.show;
        sync();
        paint(list, filter);
        try { history.replaceState(null, '', filter === 'all' ? location.pathname : `#${filter}`); } catch (err) {}
      });
      sync();
      paint(list, filter);
      root.removeAttribute('aria-busy');
    })
    .catch((err) => { $('#or-list').innerHTML = `<p class="auth-error visible">${esc(err.message)}</p>`; });
})();
