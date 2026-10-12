// Header account cluster, shown once we know the visitor is signed in:
// avatar (account menu), heart (saved beats), bell (updates) and bag (cart),
// each with a small dropdown. Signed out, the header keeps its plain
// search / support / account icons; the bag still appears if the cart has
// beats in it. Uses the /api/auth/me request main.js already made.
(() => {
  'use strict';
  const utils = document.querySelector('.header-utils');
  if (!utils) return;

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (cents) => `€${(cents / 100).toFixed(2)}`;
  const CHEV = '<svg class="hm-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>';
  const I = {
    heart: '<path d="M12 20.3l-1.3-1.2C5.8 14.7 3 12.1 3 8.9 3 6.3 5 4.3 7.6 4.3c1.5 0 2.9.7 3.8 1.8h1.2c.9-1.1 2.3-1.8 3.8-1.8C19 4.3 21 6.3 21 8.9c0 3.2-2.8 5.8-7.7 10.2z"/>',
    bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    bag: '<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l7-7M15 8l3 3"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    studio: '<path d="M5 4v16M12 4v16M19 4v16"/><rect x="3" y="12" width="4" height="3" rx="1"/><rect x="10" y="7" width="4" height="3" rx="1"/><rect x="17" y="14" width="4" height="3" rx="1"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.7 1.7 0 0 0 0-2l1.2-1.4-1.5-2.6-1.8.5a1.7 1.7 0 0 0-1.7-1L15 4.6h-3l-.6 1.9a1.7 1.7 0 0 0-1.7 1l-1.8-.5-1.5 2.6L7.6 11a1.7 1.7 0 0 0 0 2l-1.2 1.4 1.5 2.6 1.8-.5a1.7 1.7 0 0 0 1.7 1l.6 1.9h3l.6-1.9a1.7 1.7 0 0 0 1.7-1l1.8.5 1.5-2.6z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.1"/>',
    power: '<path d="M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  };
  const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name]}</svg>`;
  const ROLE = { producer: 'Producer', artist: 'Artist', listener: 'Member' };

  // Beat titles and prices, loaded once when a beat menu first opens.
  let catalogue = null;
  const loadCatalogue = () => catalogue || (catalogue = Promise.all([
    fetch('/data/beats.json').then((r) => r.json()),
    fetch('/data/beat-licenses.json').then((r) => r.json()),
  ]).then(([b, l]) => ({ byId: new Map(b.beats.map((x) => [x.id, x])), lic: l })).catch(() => ({ byId: new Map(), lic: { tiers: {} } })));

  /* ------------------------------ Dropdown shell --------------------------- */
  const menus = [];
  const closeAll = (except) => menus.forEach((m) => { if (m !== except) m.close(); });
  function makeMenu({ id, label, buttonHtml, cls = '', onOpen }) {
    const wrap = document.createElement('div');
    wrap.className = `hm ${cls}`;
    wrap.innerHTML = `
      <button type="button" class="hm-btn" aria-haspopup="true" aria-expanded="false" aria-controls="hm-${id}" aria-label="${esc(label)}">${buttonHtml}${CHEV}</button>
      <div class="hm-panel" id="hm-${id}" role="menu" aria-label="${esc(label)}"></div>`;
    const btn = wrap.querySelector('.hm-btn');
    const panel = wrap.querySelector('.hm-panel');
    const api = {
      wrap, btn, panel,
      open() {
        closeAll(api);
        wrap.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
        if (onOpen) onOpen(panel);
      },
      close() {
        if (!wrap.classList.contains('is-open')) return;
        wrap.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
      },
    };
    btn.addEventListener('click', () => (wrap.classList.contains('is-open') ? api.close() : api.open()));
    panel.addEventListener('click', (e) => { if (e.target.closest('a')) api.close(); });
    menus.push(api);
    return api;
  }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.hm')) closeAll(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = menus.find((m) => m.wrap.classList.contains('is-open'));
    if (open) { open.close(); open.btn.focus(); }
  });

  const item = (href, ic, text, extra = '') => `<a href="${href}" class="hm-item" role="menuitem">${icon(ic, 'hm-ic')}<span>${text}</span>${extra}</a>`;
  const empty = (ic, title, text, cta) => `
    <div class="hm-empty">${icon(ic, 'hm-empty-ic')}<b>${title}</b><span>${text}</span>${cta || ''}</div>`;

  /* --------------------------------- Account -------------------------------- */
  function accountMenu(me) {
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
    const initials = (name ? name.split(' ').map((w) => w[0]).join('') : me.email[0]).slice(0, 2).toUpperCase();
    const avatar = (size) => `<span class="hm-avatar ${size}" aria-hidden="true">${esc(initials)}</span>`;
    const producer = me.role === 'producer';
    const m = makeMenu({ id: 'account', label: 'Account menu', cls: 'hm-account', buttonHtml: avatar('') });
    m.panel.innerHTML = `
      <div class="hm-who">
        ${avatar('is-lg')}
        <span class="hm-who-text"><b>${esc(name || me.email.split('@')[0])}</b><small>${esc(me.email)}</small></span>
        ${me.role ? `<span class="hm-role">${ROLE[me.role]}</span>` : ''}
      </div>
      ${producer ? `<div class="hm-group">
        ${item('profile-producer.html', 'studio', 'Producer area')}
        ${item('upload-beat.html', 'upload', 'Upload a track', '<span class="hm-new">New</span>')}
      </div>` : ''}
      <div class="hm-group">
        ${item('profile-saved.html', 'heart', 'Saved tracks')}
        ${item('profile-license.html', 'key', 'Licenses &amp; downloads')}
        ${item('profile-orders.html', 'receipt', 'Orders')}
      </div>
      <div class="hm-group">
        ${item('profile-settings.html', 'gear', 'Settings')}
        ${item('profile-tickets.html', 'help', 'Help &amp; support')}
      </div>
      <div class="hm-group">
        <button type="button" class="hm-item hm-logout" role="menuitem">${icon('power', 'hm-ic')}<span>Log out</span></button>
      </div>`;
    m.panel.querySelector('.hm-logout').addEventListener('click', async () => {
      try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (e) {}
      window.location.href = '/';
    });
    return m;
  }

  /* ---------------------------------- Saved --------------------------------- */
  function savedMenu(me) {
    const ids = () => [...new Set([...(me.savedBeats || []), ...store.get('bt-saved', [])])];
    return makeMenu({
      id: 'saved', label: 'Saved tracks', cls: 'hm-saved', buttonHtml: icon('heart', 'hm-btn-ic'),
      onOpen: async (panel) => {
        const { byId } = await loadCatalogue();
        const list = ids().map((id) => byId.get(id)).filter(Boolean);
        panel.innerHTML = `
          <div class="hm-head"><b>Saved tracks</b>${list.length ? `<span>${list.length}</span>` : ''}</div>
          ${list.length ? `<div class="hm-beats">${list.slice(0, 4).map((b) => `
            <a href="beats/${encodeURIComponent(b.id)}.html" class="hm-beat bt-tint-${esc(b.tint || 'amber')}" role="menuitem">
              <span class="hm-beat-art" aria-hidden="true"></span>
              <span class="hm-beat-text"><b>${esc(b.title)}</b><small>${esc(b.producer)} · ${b.bpm} BPM</small></span>
            </a>`).join('')}</div>
            <a href="profile-saved.html" class="hm-foot" role="menuitem">View all saved</a>`
          : empty('heart', 'Nothing saved yet', 'Tap the heart on any track to keep it here.', '<a href="beats.html" class="hm-cta" role="menuitem">Browse tracks</a>')}`;
      },
    });
  }

  /* --------------------------------- Updates -------------------------------- */
  // For producers: review results on their submitted beats. The dot shows
  // when something changed since the menu was last opened.
  function updatesMenu(me) {
    const SEEN = 'cs-updates-seen';
    let items = [];
    const m = makeMenu({
      id: 'updates', label: 'Updates', cls: 'hm-updates', buttonHtml: `${icon('bell', 'hm-btn-ic')}<span class="hm-dot" hidden></span>`,
      onOpen: (panel) => {
        store.set(SEEN, Date.now());
        m.btn.querySelector('.hm-dot').hidden = true;
        const STATUS = { pending: ['In review', 'is-pending'], approved: ['Approved', 'is-ok'], rejected: ['Needs changes', 'is-bad'] };
        panel.innerHTML = `
          <div class="hm-head"><b>Updates</b></div>
          ${items.length ? `<div class="hm-updates-list">${items.slice(0, 5).map((s) => `
            <a href="profile-producer.html" class="hm-update" role="menuitem">
              <span class="hm-status ${STATUS[s.status][1]}">${STATUS[s.status][0]}</span>
              <b>${esc(s.title)}</b>
              ${s.reviewNote ? `<small>${esc(s.reviewNote)}</small>` : ''}
            </a>`).join('')}</div>
            <a href="profile-producer.html" class="hm-foot" role="menuitem">Open producer area</a>`
          : empty('bell', "You're all caught up", me.role === 'producer' ? 'Review results for your tracks will show up here.' : 'News about your orders and the site will show up here.')}`;
      },
    });
    if (me.role === 'producer') {
      fetch('/api/producer/submissions')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data) return;
          items = data.submissions.filter((s) => STATUS_OK.includes(s.status));
          const seen = store.get(SEEN, 0);
          const fresh = items.some((s) => s.reviewedAt && new Date(s.reviewedAt).getTime() > seen);
          m.btn.querySelector('.hm-dot').hidden = !fresh;
        })
        .catch(() => {});
    }
    return m;
  }
  const STATUS_OK = ['pending', 'approved', 'rejected'];

  /* ---------------------------------- Cart ---------------------------------- */
  function cartMenu() {
    const m = makeMenu({
      id: 'cart', label: 'Cart', cls: 'hm-cart', buttonHtml: `${icon('bag', 'hm-btn-ic')}<span class="hm-count" hidden></span>`,
      onOpen: async (panel) => {
        const { byId, lic } = await loadCatalogue();
        const cart = store.get('bt-cart', []).filter((c) => byId.has(c.id) && byId.get(c.id).prices[c.tier] > 0);
        const total = cart.reduce((s, c) => s + byId.get(c.id).prices[c.tier], 0);
        panel.innerHTML = `
          <div class="hm-head"><b>Cart</b>${cart.length ? `<span>${cart.length}</span>` : ''}</div>
          ${cart.length ? `<div class="hm-beats">${cart.map((c) => {
            const b = byId.get(c.id);
            return `
            <a href="beats/${encodeURIComponent(b.id)}.html" class="hm-beat bt-tint-${esc(b.tint || 'amber')}" role="menuitem">
              <span class="hm-beat-art" aria-hidden="true"></span>
              <span class="hm-beat-text"><b>${esc(b.title)}</b><small>${esc((lic.tiers[c.tier] || {}).name || c.tier)}</small></span>
              <span class="hm-beat-price">${euro(b.prices[c.tier])}</span>
            </a>`;
          }).join('')}</div>
            <div class="hm-total"><span>Total</span><b>${euro(total)}</b></div>
            <a href="beats.html?cart=1" class="hm-checkout" role="menuitem">Go to checkout</a>`
          : empty('bag', 'Your cart is empty', 'Pick a license on any track to add it here.', '<a href="beats.html" class="hm-cta" role="menuitem">Browse tracks</a>')}`;
      },
    });
    const paintCount = () => {
      const n = store.get('bt-cart', []).length;
      const badge = m.btn.querySelector('.hm-count');
      badge.hidden = n === 0;
      badge.textContent = String(n);
      m.btn.setAttribute('aria-label', n ? `Cart, ${n} item${n === 1 ? '' : 's'}` : 'Cart');
      return n;
    };
    m.paintCount = paintCount;
    // The store page writes the cart to localStorage; catch changes from it
    // and from other tabs.
    window.addEventListener('storage', (e) => { if (e.key === 'bt-cart') paintCount(); });
    setInterval(paintCount, 2000);
    paintCount();
    return m;
  }

  /* ------------------------------- Signed out ------------------------------- */
  I.headset = '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2.5" y="14" width="5" height="7" rx="2"/><rect x="16.5" y="14" width="5" height="7" rx="2"/>';
  I.user = '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.2a7.5 7.5 0 0 1 15 0"/>';
  I.play = '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>';
  I.mail = '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6 8.5-6"/>';
  I.login = '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4"/>';
  I.plus = '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.2a7.5 7.5 0 0 1 11-6.6M18 15v6M15 18h6"/>';

  function guestSupportMenu() {
    const m = makeMenu({ id: 'support', label: 'Help', cls: 'hm-support', buttonHtml: icon('headset', 'hm-btn-ic') });
    m.panel.innerHTML = `
      <div class="hm-head"><b>Help</b></div>
      <div class="hm-group hm-group-first">
        ${item('faq.html', 'help', 'FAQ')}
        ${item('tutorial-creative-dist.html', 'play', 'Creative Dist tutorial')}
        ${item('contact.html', 'mail', 'Contact us')}
      </div>`;
    return m;
  }
  function guestAccountMenu() {
    const m = makeMenu({ id: 'guest', label: 'Account', cls: 'hm-guest', buttonHtml: icon('user', 'hm-btn-ic') });
    m.panel.innerHTML = `
      <div class="hm-guest-intro"><b>Your Creative Sound account</b><span>Licenses, downloads, saved tracks and orders in one place.</span></div>
      <div class="hm-group">
        ${item('login.html', 'login', 'Sign in')}
        ${item('signup.html', 'plus', 'Create account')}
      </div>`;
    return m;
  }

  /* ---------------------------------- Boot ---------------------------------- */
  const me = window.csMe || fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  Promise.resolve(me).then((data) => {
    const cluster = document.createElement('div');
    cluster.className = 'hm-cluster';
    if (data && data.email) {
      document.documentElement.classList.add('is-signed-in');
      // Producers get a one-click Upload button ahead of the icons.
      if (data.role === 'producer' && !location.pathname.endsWith('/upload-beat.html')) {
        const up = document.createElement('a');
        up.href = 'upload-beat.html';
        up.className = 'hm-upload';
        up.setAttribute('aria-label', 'Upload a track');
        up.innerHTML = `${icon('upload', 'hm-upload-ic')}<span>Upload</span>`;
        cluster.append(up);
      }
      cluster.append(savedMenu(data).wrap, updatesMenu(data).wrap, cartMenu().wrap, accountMenu(data).wrap);
    } else {
      // Signed out: support and account menus in the same style, the cart
      // only when it has something in it.
      document.documentElement.classList.add('is-signed-out');
      const cart = cartMenu();
      cluster.append(guestSupportMenu().wrap);
      if (cart.paintCount()) cluster.append(cart.wrap);
      cluster.append(guestAccountMenu().wrap);
    }
    utils.appendChild(cluster);
  });
})();
