// Private messages: the "Message the producer" box on track pages and the
// inbox page (messages.html: conversations on the left, the open chat on
// the right; one column on phones). Data: /api/messages (_lib/messages.js).
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

  /* ------------------------- Track page: message box ------------------------ */
  // The track page is rendered by beats.js after the catalogue loads, so wait
  // for the box to appear.
  const bindBox = (box) => {
    const form = $('.bp-message-form', box);
    const ta = $('textarea', form);
    const status = $('.bp-message-status', form);
    const btn = $('button[type="submit"]', form);
    me.then((user) => {
      if (user && user.email) return;
      form.innerHTML = '<div class="bp-message-guest"><span>Sign in to message the producer. It\'s free.</span><a class="btn btn-primary" href="login.html">Sign in</a><a class="btn btn-ghost" href="signup.html">Create account</a></div>';
    });
    enterSends(ta, form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body) { ta.focus(); return; }
      btn.disabled = true; status.className = 'bp-message-status'; status.textContent = 'Sending…';
      try {
        const out = await send({ beatId: box.dataset.messageBeat, body });
        ta.value = '';
        status.classList.add('is-ok');
        status.innerHTML = `Sent. <a href="messages.html?with=${out.with}">Open the conversation ›</a>`;
      } catch (err) {
        status.classList.add('is-bad');
        status.textContent = err.message;
      } finally { btn.disabled = false; }
    });
  };
  if ($('[data-track-page]') || $('.beat-page')) {
    let tries = 0;
    const wait = setInterval(() => {
      const box = $('#bp-message');
      if (box) { clearInterval(wait); bindBox(box); } else if (++tries > 60) clearInterval(wait);
    }, 250);
  }

  /* ------------------------------- Inbox page ------------------------------- */
  const page = $('[data-messages-page]');
  if (!page) return;
  const list = $('#ms-list');
  const chat = $('#ms-chat');
  let current = Number(new URLSearchParams(location.search).get('with')) || null;
  let threads = [];

  const paintList = () => {
    list.innerHTML = threads.length ? threads.map((t) => `
      <a href="messages.html?with=${t.user.id}" class="ms-thread${t.user.id === current ? ' is-active' : ''}${t.unread ? ' is-unread' : ''}" data-with="${t.user.id}">
        ${avatar(t.user)}
        <span class="ms-thread-text"><b>${esc(t.user.name)}</b><small>${t.last.mine ? 'You: ' : ''}${esc(t.last.body)}</small></span>
        <span class="ms-thread-meta"><time>${ago(t.last.at)}</time>${t.unread ? `<span class="ms-badge">${t.unread}</span>` : ''}</span>
      </a>`).join('')
      : '<div class="ms-empty-list"><b>No messages yet</b><span>Open a track and use "Message the producer" to start a conversation.</span><a class="btn btn-primary" href="beats.html">Browse tracks</a></div>';
  };
  const loadThreads = () => fetch('/api/messages').then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((d) => { threads = d.threads; paintList(); });

  const bubble = (m) => `<div class="ms-msg${m.mine ? ' is-mine' : ''}"><p>${esc(m.body)}</p><time>${ago(m.at)}</time></div>`;
  const openChat = async (id, push) => {
    current = id;
    page.classList.toggle('has-chat', !!id);
    paintList();
    if (!id) { chat.innerHTML = '<div class="ms-placeholder"><b>Your messages</b><span>Pick a conversation on the left.</span></div>'; return; }
    if (push) history.pushState(null, '', `messages.html?with=${id}`);
    chat.innerHTML = '<div class="ms-placeholder"><span>Loading…</span></div>';
    const r = await fetch(`/api/messages?with=${id}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { chat.innerHTML = `<div class="ms-placeholder"><span>${esc(d.error || 'Could not load this conversation.')}</span></div>`; return; }
    const u = d.user;
    chat.innerHTML = `
      <header class="ms-chat-head">
        <button type="button" class="ms-back" aria-label="Back to conversations">‹</button>
        ${avatar(u, 'is-sm')}
        <div><b>${esc(u.name)}</b>${u.handle ? `<a href="artist.html?u=${encodeURIComponent(u.handle)}">@${esc(u.handle)}</a>` : ''}</div>
      </header>
      <div class="ms-msgs" id="ms-msgs">${d.messages.map(bubble).join('')}</div>
      <form class="ms-compose">
        <textarea name="body" rows="1" maxlength="2000" placeholder="Write a message…" aria-label="Write a message"></textarea>
        <button type="submit" class="ms-send" aria-label="Send"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg></button>
      </form>
      <small class="ms-error" aria-live="polite"></small>`;
    const msgs = $('#ms-msgs');
    msgs.scrollTop = msgs.scrollHeight;
    $('.ms-back', chat).addEventListener('click', () => { history.pushState(null, '', 'messages.html'); openChat(null); });
    const form = $('.ms-compose', chat);
    const ta = $('textarea', form);
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
        const out = await send({ to: id, body });
        msgs.insertAdjacentHTML('beforeend', bubble(out.message));
        msgs.scrollTop = msgs.scrollHeight;
        ta.value = ''; ta.style.height = 'auto';
        loadThreads();
      } catch (err) { $('.ms-error', chat).textContent = err.message; } finally { btn.disabled = false; ta.focus(); }
    });
    loadThreads();
    document.dispatchEvent(new CustomEvent('cs:messages-read'));
  };

  list.addEventListener('click', (e) => {
    const a = e.target.closest('[data-with]');
    if (!a || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    openChat(Number(a.dataset.with), true);
  });
  window.addEventListener('popstate', () => openChat(Number(new URLSearchParams(location.search).get('with')) || null));

  me.then((user) => {
    if (!user || !user.email) { location.href = 'login.html'; return; }
    loadThreads().catch(() => { list.innerHTML = '<div class="ms-empty-list"><span>Could not load your messages.</span></div>'; });
    openChat(current);
  });
})();
