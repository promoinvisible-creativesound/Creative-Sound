// Private messages: the inbox page (messages.html: conversations on the left, the open chat on
// the right; one column on phones). Data: /api/messages (_lib/messages.js).
// A conversation can be about a track: track pages open it with ?beat=<id>
// (the track is attached to the first message), and "New message" lets you
// search a track and write to its producer about it.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const me = window.csMe || fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const send = (payload) => fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Could not send. Try again.'); return d; });
  const ago = (d) => {
    const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 604800) return `${Math.floor(s / 86400)}d`;
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const avatar = (u, cls = '') => (u.photo
    ? `<span class="ms-avatar ${cls}" style="background-image:url('${esc(u.photo)}')" aria-hidden="true"></span>`
    : `<span class="ms-avatar ${cls}" aria-hidden="true">${esc((u.name || '?').slice(0, 1).toUpperCase())}</span>`);
  // Send on Enter (Shift+Enter for a new line), like every chat app.
  const enterSends = (ta, form) => ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });

  /* ------------------------------- Inbox page ------------------------------- */
  const page = $('[data-messages-page]');
  if (!page) return;
  const list = $('#ms-list');
  const chat = $('#ms-chat');
  const params = () => new URLSearchParams(location.search);
  let current = null;
  let threads = [];
  let attached = null; // id of the track the next message is about

  // Store tracks (titles, covers) for the cards in the chat and the picker.
  let catalogue = null;
  const loadCatalogue = () => catalogue || (catalogue = fetch('/api/beats/catalogue')
    .then((r) => (r.ok ? r.json() : { beats: [] }))
    .then((d) => new Map((d.beats || []).filter((b) => b.source === 'producer').map((b) => [b.id, b])))
    .catch(() => new Map()));
  const trackUrl = (b) => `track.html?id=${encodeURIComponent(b.id)}`;
  const thumb = (b, cls = '') => `<span class="ms-thumb ${cls}" aria-hidden="true"${b && b.cover ? ` style="background-image:url('${esc(b.cover)}')"` : ''}></span>`;

  const NEW_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
  const paintList = () => {
    const head = `<button type="button" class="ms-new" data-new>${NEW_ICON}<span>New message</span></button>`;
    list.innerHTML = head + (threads.length ? threads.map((t) => `
      <a href="messages.html?with=${t.user.id}" class="ms-thread${t.user.id === current ? ' is-active' : ''}${t.unread ? ' is-unread' : ''}" data-with="${t.user.id}">
        ${avatar(t.user)}
        <span class="ms-thread-text"><b>${esc(t.user.name)}</b><small>${t.last.mine ? 'You: ' : ''}${esc(t.last.body)}</small></span>
        <span class="ms-thread-meta"><time>${ago(t.last.at)}</time>${t.unread ? `<span class="ms-badge">${t.unread}</span>` : ''}</span>
      </a>`).join('')
      : '<div class="ms-empty-list"><b>No messages yet</b><span>Pick a track and write to its producer about it.</span></div>');
  };
  const loadThreads = () => fetch('/api/messages').then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((d) => { threads = d.threads; paintList(); });

  // A message about a track shows the track as a small card above the text,
  // only when the track changes from the previous one.
  const trackCard = (b) => `<a class="ms-track" href="${trackUrl(b)}">${thumb(b)}<span><small>Track</small><b>${esc(b.title)}</b></span></a>`;
  const bubble = (m, prevBeat, cat) => {
    const b = m.beatId && m.beatId !== prevBeat ? cat.get(m.beatId) : null;
    return `<div class="ms-msg${m.mine ? ' is-mine' : ''}">${b ? trackCard(b) : ''}<p>${esc(m.body)}</p><time>${ago(m.at)}</time></div>`;
  };
  const bubbles = (list, cat) => {
    let prev = null;
    return list.map((m) => { const h = bubble(m, prev, cat); if (m.beatId) prev = m.beatId; return h; }).join('');
  };

  // target: a member id, or { beat: trackId } to open the chat with that
  // track's producer with the track attached.
  const openChat = async (target, push) => {
    const byBeat = target && typeof target === 'object' ? target.beat : null;
    current = byBeat ? null : target;
    attached = byBeat;
    page.classList.toggle('has-chat', !!target);
    paintList();
    if (!target) {
      chat.innerHTML = '<div class="ms-placeholder"><b>Your messages</b><span>Pick a conversation, or start a new one about a track.</span><button type="button" class="btn btn-primary" data-new>New message</button></div>';
      return;
    }
    if (push) history.pushState(null, '', byBeat ? `messages.html?beat=${encodeURIComponent(byBeat)}` : `messages.html?with=${target}`);
    chat.innerHTML = '<div class="ms-placeholder"><span>Loading…</span></div>';
    const [r, cat] = await Promise.all([fetch(`/api/messages?${byBeat ? `beat=${encodeURIComponent(byBeat)}` : `with=${target}`}`), loadCatalogue()]);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      chat.innerHTML = `<div class="ms-placeholder"><span>${esc(d.error || 'Could not load this conversation.')}</span><button type="button" class="btn btn-ghost" data-new>Pick another track</button></div>`;
      return;
    }
    const u = d.user;
    const id = u.id;
    current = id;
    paintList();
    chat.innerHTML = `
      <header class="ms-chat-head">
        <button type="button" class="ms-back" aria-label="Back to conversations">‹</button>
        ${avatar(u, 'is-sm')}
        <div><b>${esc(u.name)}</b>${u.handle ? `<a href="artist.html?u=${encodeURIComponent(u.handle)}">@${esc(u.handle)}</a>` : ''}</div>
      </header>
      <div class="ms-msgs" id="ms-msgs">${d.messages.length ? bubbles(d.messages, cat) : `<div class="ms-start">${avatar(u)}<b>${esc(u.name)}</b><span>Ask about exclusives, custom beats or a collab. Your email is never shown.</span></div>`}</div>
      <div class="ms-attach" id="ms-attach"></div>
      <form class="ms-compose">
        <button type="button" class="ms-attach-btn" aria-label="Attach a track" title="Attach a track"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg></button>
        <textarea name="body" rows="1" maxlength="2000" placeholder="Write a message…" aria-label="Write a message"></textarea>
        <button type="submit" class="ms-send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
      </form>
      <small class="ms-error" aria-live="polite"></small>`;
    const msgs = $('#ms-msgs');
    msgs.scrollTop = msgs.scrollHeight;
    let lastBeat = [...d.messages].reverse().find((m) => m.beatId);
    lastBeat = lastBeat ? lastBeat.beatId : null;
    const form = $('.ms-compose', chat);
    const ta = $('textarea', form);
    // The attached track sits above the composer as a chip (× removes it).
    const paintAttach = () => {
      const b = attached && cat.get(attached);
      $('#ms-attach').innerHTML = b ? `<div class="ms-chip">${thumb(b)}<span><small>About</small><b>${esc(b.title)}</b></span><button type="button" class="ms-chip-x" aria-label="Remove track">×</button></div>` : '';
      ta.placeholder = b ? `Write about ${b.title}…` : 'Write a message…';
    };
    paintAttach();
    $('#ms-attach').addEventListener('click', (e) => { if (e.target.closest('.ms-chip-x')) { attached = null; paintAttach(); ta.focus(); } });
    $('.ms-attach-btn', form).addEventListener('click', () => openPicker({
      title: `Tracks by ${u.name}`,
      filter: (b) => (u.handle && b.producerHandle ? b.producerHandle.toLowerCase() === u.handle.toLowerCase() : b.producer === u.name),
      onPick: (b) => { attached = b.id; paintAttach(); ta.focus(); },
    }));
    $('.ms-back', chat).addEventListener('click', () => { history.pushState(null, '', 'messages.html'); openChat(null); });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; });
    enterSends(ta, form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) return;
      const btn = $('.ms-send', form);
      btn.disabled = true;
      $('.ms-error', chat).textContent = '';
      try {
        const out = await send({ to: id, beatId: attached || undefined, body });
        const start = $('.ms-start', msgs);
        if (start) start.remove();
        msgs.insertAdjacentHTML('beforeend', bubble(out.message, lastBeat, cat));
        if (out.message.beatId) lastBeat = out.message.beatId;
        msgs.scrollTop = msgs.scrollHeight;
        ta.value = ''; ta.style.height = 'auto';
        attached = null; paintAttach();
        if (params().get('beat')) history.replaceState(null, '', `messages.html?with=${id}`);
        loadThreads();
      } catch (err) { $('.ms-error', chat).textContent = err.message; } finally { btn.disabled = false; ta.focus(); }
    });
    if (!d.messages.length || attached) ta.focus({ preventScroll: true });
    loadThreads();
    document.dispatchEvent(new CustomEvent('cs:messages-read'));
  };

  /* ------------------------------ Track picker ------------------------------ */
  // Search the store's tracks and pick one: from "New message" it opens the
  // chat with that track's producer; inside a chat it attaches the track.
  const picker = document.createElement('dialog');
  picker.className = 'ms-picker';
  picker.innerHTML = `
    <div class="ms-picker-inner">
      <div class="ms-picker-head"><b id="ms-picker-title">New message</b><button type="button" class="ms-picker-close" aria-label="Close">×</button></div>
      <label class="ms-picker-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" placeholder="Search a track or producer" aria-label="Search tracks" autocomplete="off"></label>
      <div class="ms-picker-list" role="listbox" aria-label="Tracks"></div>
    </div>`;
  document.body.appendChild(picker);
  const pickList = $('.ms-picker-list', picker);
  const pickInput = $('input', picker);
  let pickCfg = null;
  const paintPicker = async () => {
    const cat = await loadCatalogue();
    const q = pickInput.value.trim().toLowerCase();
    const items = [...cat.values()].filter((b) => (!pickCfg.filter || pickCfg.filter(b))
      && (!q || [b.title, b.producer, b.genre, b.mood, ...(b.tags || [])].join(' ').toLowerCase().includes(q)));
    pickList.innerHTML = items.length ? items.slice(0, 40).map((b) => `
      <button type="button" class="ms-pick" data-pick="${esc(b.id)}" role="option">
        ${thumb(b, 'is-lg')}
        <span class="ms-pick-text"><b>${esc(b.title)}</b><small>${esc(b.producer)} · ${b.bpm} BPM${b.genre ? ` · ${esc(b.genre)}` : ''}</small></span>
        <svg class="ms-pick-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>`).join('')
      : `<div class="ms-pick-empty">${q ? 'No tracks match your search.' : 'No tracks yet.'}</div>`;
  };
  const openPicker = (cfg) => {
    pickCfg = cfg;
    $('#ms-picker-title', picker).textContent = cfg.title;
    pickInput.value = '';
    paintPicker();
    picker.showModal();
    setTimeout(() => pickInput.focus(), 50);
  };
  pickInput.addEventListener('input', paintPicker);
  $('.ms-picker-close', picker).addEventListener('click', () => picker.close());
  picker.addEventListener('click', async (e) => {
    if (e.target === picker) { picker.close(); return; }
    const p = e.target.closest('[data-pick]');
    if (!p) return;
    const b = (await loadCatalogue()).get(p.dataset.pick);
    picker.close();
    pickCfg.onPick(b);
  });
  const newMessage = () => openPicker({ title: 'New message', onPick: (b) => openChat({ beat: b.id }, true) });

  page.addEventListener('click', (e) => { if (e.target.closest('[data-new]')) newMessage(); });
  list.addEventListener('click', (e) => {
    const a = e.target.closest('[data-with]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    openChat(Number(a.dataset.with), true);
  });
  const fromUrl = () => {
    const beat = params().get('beat');
    if (beat) return { beat };
    return Number(params().get('with')) || null;
  };
  window.addEventListener('popstate', () => openChat(fromUrl()));

  me.then((user) => {
    if (!user || !user.email) { location.href = 'login.html'; return; }
    loadThreads().catch(() => { list.innerHTML = '<div class="ms-empty-list"><span>Could not load your messages.</span></div>'; });
    openChat(fromUrl());
  });
})();
