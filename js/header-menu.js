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
    key: '<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13l9-9M15.5 7.5l2.5 2.5M13 10l2 2"/>',
    box: '<path d="M4 7.5L12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    seal: '<path d="M12 2.8l2.3 1.7 2.8-.1.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.1L12 21.2l-2.3-1.7-2.8.1-.9-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.1z"/><path d="M8.8 12.2l2.2 2.2 4.2-4.4"/>',
    profile: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.6 18.4a6.4 6.4 0 0 1 10.8 0"/>',
    logout: '<path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 8l-4 4 4 4M6 12h10"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
    studio: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.3"/><circle cx="12" cy="16.9" r=".6" fill="currentColor"/>',
    power: '<path d="M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    chat: '<path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z"/>',
  };
  const TONE = { chat: 'teal', studio: 'amber', upload: 'amber', seal: 'amber', profile: 'blue', user: 'blue', heart: 'pink', key: 'yellow', box: 'green', receipt: 'green', gear: 'gray', help: 'purple', headset: 'purple', mail: 'teal', play: 'red', music: 'red', login: 'blue', plus: 'green', logout: 'gray', power: 'gray' };
  const tile = (name) => `<span class="hm-tile is-${TONE[name] || 'gray'}"><svg class="hm-ic" viewBox="0 0 24 24" aria-hidden="true">${I[name]}</svg></span>`;
  const icon = (name, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[name]}</svg>`;
  const ROLE = { producer: 'Producer', artist: 'Artist', listener: 'Member' };

  // Beat titles and prices, loaded once when a beat menu first opens.
  let catalogue = null;
  const loadCatalogue = () => catalogue || (catalogue = Promise.all([
    fetch('/api/beats/catalogue').then((r) => (r.ok ? r.json() : Promise.reject())).catch(() => fetch('/data/beats.json').then((r) => r.json())),
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

  const item = (href, ic, text, extra = '') => `<a href="${href}" class="hm-item" role="menuitem">${tile(ic)}<span>${text}</span>${extra}</a>`;
  const empty = (ic, title, text, cta) => `
    <div class="hm-empty">${icon(ic, 'hm-empty-ic')}<b>${title}</b><span>${text}</span>${cta || ''}</div>`;

  /* --------------------------------- Account -------------------------------- */
  function accountMenu(me) {
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
    const initials = (name ? name.split(' ').map((w) => w[0]).join('') : me.email[0]).slice(0, 2).toUpperCase();
    const avatar = (size) => `<span class="hm-avatar ${size}${me.photo ? ' has-photo' : ''}" aria-hidden="true">${me.photo ? `<img src="${esc(me.photo)}" alt="">` : esc(initials)}</span>`;
    const producer = me.role === 'producer';
    const m = makeMenu({ id: 'account', label: 'Account menu', cls: 'hm-account', buttonHtml: avatar('') });
    // Profile, orders and downloads come first; for the admin they sit
    // under Track review and the producer area.
    const mine = `<div class="hm-group">
        ${item('profile-public.html', 'profile', 'Public profile')}
        ${item('profile-orders.html', 'box', 'Orders')}
        ${item('profile-license.html', 'key', 'Licenses &amp; downloads')}
      </div>`;
    m.panel.innerHTML = `
      <div class="hm-who">
        ${avatar('is-lg')}
        <span class="hm-who-text"><b>${esc(name || me.email.split('@')[0])}</b><small>${esc(me.email)}</small></span>
        ${me.role ? `<span class="hm-role">${ROLE[me.role]}</span>` : ''}
      </div>
      ${me.isAdmin ? `<div class="hm-group">
        ${item('admin-review.html', 'seal', 'Track review', '<span class="hm-new">Admin</span>')}
      </div>` : ''}
      ${me.isAdmin ? '' : mine}
      ${producer ? `<div class="hm-group">
        ${item('profile-producer.html', 'studio', 'Producer area')}
        ${item('upload-beat.html', 'upload', 'Upload tracks')}
      </div>` : ''}
      ${me.isAdmin ? mine : ''}
      <div class="hm-group">
        ${item('profile-saved.html', 'heart', 'Saved tracks')}
        ${item('messages.html', 'chat', 'Messages')}
      </div>
      <div class="hm-group">
        ${item('profile-settings.html', 'gear', 'Settings')}
        ${item('profile-tickets.html', 'help', 'Help &amp; support')}
      </div>
      <div class="hm-group">
        <button type="button" class="hm-item hm-logout" role="menuitem">${tile('logout')}<span>Log out</span></button>
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
            <a href="${b.source === 'producer' ? `track.html?id=${encodeURIComponent(b.id)}` : `beats/${encodeURIComponent(b.id)}.html`}" class="hm-beat bt-tint-${esc(b.tint || 'amber')}" role="menuitem">
              <span class="hm-beat-art" aria-hidden="true"${b.cover ? ` style="background:url('${esc(b.cover)}') center/cover"` : ''}></span>
              <span class="hm-beat-text"><b>${esc(b.title)}</b><small>${esc(b.producer)} · ${b.bpm} BPM${b.key ? ` · ${esc(b.key)}` : ''}</small></span>
              ${Object.values(b.prices || {}).filter((p) => p > 0).length ? `<span class="hm-beat-price">€${(Math.min(...Object.values(b.prices).filter((p) => p > 0)) / 100).toFixed(0)}</span>` : ''}
            </a>`).join('')}</div>
            <a href="profile-saved.html" class="hm-foot hm-foot-link" role="menuitem">View all saved ›</a>`
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
        store.set(SEEN + '-prev', store.get(SEEN, 0));
        store.set(SEEN, Date.now());
        m.btn.querySelector('.hm-dot').hidden = true;
        // Each update: a status tile (clock / check / alert), the track, what
        // happened and when; unread ones (since the previous open) get a dot.
        const seenAt = store.get(SEEN + '-prev', 0);
        const STATUS = {
          pending: ['In review', 'is-pending', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 'Sent for review'],
          approved: ['Approved', 'is-ok', '<path d="M5 12.5l4.5 4.5L19 7.5"/>', 'Live in the store'],
          rejected: ['Needs changes', 'is-bad', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.1"/>', 'Check the note and upload again'],
        };
        const ago = (d) => {
          if (!d) return '';
          const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
          if (s < 60) return 'now';
          if (s < 3600) return `${Math.floor(s / 60)}m`;
          if (s < 86400) return `${Math.floor(s / 3600)}h`;
          if (s < 604800) return `${Math.floor(s / 86400)}d`;
          return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        };
        panel.innerHTML = `
          <div class="hm-head"><b>Updates</b>${items.length ? `<span>${items.length}</span>` : ''}</div>
          ${items.length ? `<div class="hm-updates-list">${items.slice(0, 6).map((s) => {
            const st = STATUS[s.status];
            const when = s.status === 'pending' ? s.submittedAt : (s.reviewedAt || s.submittedAt);
            const unread = s.status !== 'pending' && s.reviewedAt && new Date(s.reviewedAt).getTime() > seenAt;
            return `
            <a href="profile-producer.html" class="hm-update${unread ? ' is-unread' : ''}" role="menuitem">
              <span class="hm-update-ic ${st[1]}" aria-hidden="true"><svg viewBox="0 0 24 24">${st[2]}</svg></span>
              <span class="hm-update-text">
                <b>${esc(s.title || 'Untitled track')}</b>
                <small><em class="${st[1]}">${st[0]}</em> · ${s.status === 'rejected' && s.reviewNote ? esc(s.reviewNote) : st[3]}</small>
              </span>
              <time>${ago(when)}</time>
            </a>`;
          }).join('')}</div>
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

  /* -------------------------------- Messages -------------------------------- */
  // Private messages: a badge with the unread count (checked every minute
  // while the tab is visible) and the latest conversations in the dropdown.
  function messagesMenu() {
    const ago = (d) => {
      const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
      if (s < 60) return 'now';
      if (s < 3600) return `${Math.floor(s / 60)}m`;
      if (s < 86400) return `${Math.floor(s / 3600)}h`;
      return `${Math.floor(s / 86400)}d`;
    };
    const m = makeMenu({
      id: 'messages', label: 'Messages', cls: 'hm-messages', buttonHtml: `${icon('chat', 'hm-btn-ic')}<span class="hm-count" hidden></span>`,
      onOpen: async (panel) => {
        panel.innerHTML = '<div class="hm-head"><b>Messages</b></div><div class="hm-msg-loading">Loading…</div>';
        const d = await fetch('/api/messages').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const threads = (d && d.threads) || [];
        panel.innerHTML = `
          <div class="hm-head"><b>Messages</b>${d && d.unread ? `<span>${d.unread} new</span>` : ''}</div>
          ${threads.length ? `<div class="hm-updates-list">${threads.slice(0, 5).map((t) => `
            <a href="messages.html?with=${t.user.id}" class="hm-update hm-msg${t.unread ? ' is-unread' : ''}" role="menuitem">
              <span class="hm-msg-av" aria-hidden="true"${t.user.photo ? ` style="background-image:url('${esc(t.user.photo)}')"` : ''}>${t.user.photo ? '' : esc(t.user.name.slice(0, 1).toUpperCase())}</span>
              <span class="hm-update-text"><b>${esc(t.user.name)}</b><small>${t.last.mine ? 'You: ' : ''}${esc(t.last.body)}</small></span>
              <time>${ago(t.last.at)}</time>
            </a>`).join('')}</div>
            <a href="messages.html" class="hm-foot" role="menuitem">Open messages</a>`
          : empty('chat', 'No messages yet', 'Message a producer from any track page. Replies show up here.')}`;
      },
    });
    const badge = m.btn.querySelector('.hm-count');
    const paint = (n) => { badge.hidden = !n; badge.textContent = n > 9 ? '9+' : String(n); m.btn.setAttribute('aria-label', n ? `Messages, ${n} unread` : 'Messages'); };
    const check = () => { if (document.hidden) return; fetch('/api/messages?op=unread').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) paint(d.unread); }).catch(() => {}); };
    check();
    setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    document.addEventListener('cs:messages-read', () => setTimeout(check, 300));
    return m;
  }

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
            <a href="${b.source === 'producer' ? `track.html?id=${encodeURIComponent(b.id)}` : `beats/${encodeURIComponent(b.id)}.html`}" class="hm-beat bt-tint-${esc(b.tint || 'amber')}" role="menuitem">
              <span class="hm-beat-art" aria-hidden="true"${b.cover ? ` style="background:url('${esc(b.cover)}') center/cover"` : ''}></span>
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
  // Private preview: the new header only for allowed accounts; everyone
  // else keeps the plain icons.
  const allowed = window.csPreview || Promise.resolve(false);
  Promise.all([me, allowed]).then(([data, ok]) => {
    if (!ok) return;
    const cluster = document.createElement('div');
    cluster.className = 'hm-cluster';
    if (data && data.email) {
      document.documentElement.classList.add('is-signed-in');
      cluster.append(savedMenu(data).wrap, messagesMenu().wrap, updatesMenu(data).wrap, cartMenu().wrap, accountMenu(data).wrap);
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
