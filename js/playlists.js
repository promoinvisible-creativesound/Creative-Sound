/* Playlists: add a track to a playlist (button on the track page), manage them on the Saved page,
   and show one on playlist.html (the saved page's grid and player, filled from the playlist).
   API: /api/beats/playlists (api/_lib/playlists.js). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const API = '/api/beats/playlists';

  let lists = null; // my playlists, null until loaded
  const post = async (body) => {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) { location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`; throw new Error('signin'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save. Please try again.');
    lists = data.playlists;
    return lists;
  };
  const load = async () => {
    if (lists) return lists;
    const res = await fetch(API);
    if (res.status === 401) return null;
    const data = await res.json().catch(() => ({}));
    lists = res.ok ? data.playlists || [] : [];
    return lists;
  };
  const link = (slug) => `${location.origin}/playlist.html?s=${slug}`;

  /* ---------------------------- Add to playlist popover --------------------------- */
  let pop = null, popBtn = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; popBtn = null; } };
  async function openPop(btn) {
    if (pop && popBtn === btn) { closePop(); return; }
    closePop();
    const beatId = btn.dataset.playlistAdd;
    const mine = await load();
    if (!mine) { location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`; return; }
    pop = document.createElement('div');
    pop.className = 'pl-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Add to playlist');
    popBtn = btn;
    const paint = (msg) => {
      pop.innerHTML = `<b class="pl-pop-title">Add to playlist</b>
        <div class="pl-pop-list">${(lists || []).map((l) => {
    const on = l.ids.includes(beatId);
    return `<button type="button" class="pl-pop-item${on ? ' is-on' : ''}" data-pl="${l.id}" aria-pressed="${on}"><span>${esc(l.name)}</span><small>${l.count}</small><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>`;
  }).join('') || '<p class="pl-pop-none">No playlists yet.</p>'}</div>
        <form class="pl-pop-new"><input type="text" maxlength="40" placeholder="New playlist" aria-label="New playlist name"><button type="submit" class="btn btn-primary">Create</button></form>
        <p class="pl-pop-msg" role="status">${msg ? esc(msg) : ''}</p>`;
    };
    paint();
    document.body.appendChild(pop);
    const place = () => {
      if (!pop || !popBtn) return;
      const r = popBtn.getBoundingClientRect();
      const w = Math.min(300, window.innerWidth - 24);
      pop.style.width = `${w}px`;
      pop.style.left = `${Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2))}px`;
      const below = r.bottom + 8 + pop.offsetHeight <= window.innerHeight || r.top < pop.offsetHeight + 16;
      pop.style.top = `${below ? Math.min(r.bottom + 8, window.innerHeight - pop.offsetHeight - 12) : r.top - pop.offsetHeight - 8}px`;
    };
    place();
    pop.addEventListener('click', async (e) => {
      const it = e.target.closest('[data-pl]');
      if (!it) return;
      const l = lists.find((x) => x.id === Number(it.dataset.pl));
      it.disabled = true;
      try { await post({ do: l.ids.includes(beatId) ? 'remove' : 'add', id: l.id, beatId }); paint(); place(); } catch (err) { if (err.message !== 'signin') { paint(err.message); place(); } }
    });
    pop.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('input', pop);
      if (!input.value.trim()) return;
      try { await post({ do: 'create', name: input.value, beatId }); paint(); place(); } catch (err) { if (err.message !== 'signin') { paint(err.message); place(); } }
    });
    const first = $('input', pop); if (first && !matchMedia('(pointer:coarse)').matches) first.focus();
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-playlist-add]');
    if (btn) { e.preventDefault(); openPop(btn); return; }
    if (pop && !pop.contains(e.target)) closePop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  window.addEventListener('resize', closePop);

  /* ------------------------------- Saved page: my lists ------------------------------ */
  const box = $('[data-playlists-box]');
  async function paintBox(msg) {
    const mine = await load();
    if (!mine) { box.hidden = true; return; }
    box.innerHTML = `<div class="pl-box-head"><h2>Playlists</h2>
        <form class="pl-new"><input type="text" maxlength="40" placeholder="New playlist" aria-label="New playlist name"><button type="submit" class="btn btn-primary">Create</button></form></div>
      ${mine.length ? `<div class="pl-cards">${mine.map((l) => `<a class="pl-card" href="playlist.html?s=${l.slug}"><b>${esc(l.name)}</b><span>${l.count} track${l.count === 1 ? '' : 's'}</span></a>`).join('')}</div>` : '<p class="pl-none">Make a playlist, then add tracks from their page with the Playlist button. You can share it with a link.</p>'}
      <p class="pl-msg" role="status">${msg ? esc(msg) : ''}</p>`;
  }
  if (box) {
    paintBox();
    box.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = $('input', box);
      if (!input.value.trim()) return;
      try { await post({ do: 'create', name: input.value }); paintBox(); } catch (err) { if (err.message !== 'signin') paintBox(err.message); }
    });
  }

  /* ------------------------------- playlist.html ------------------------------------- */
  const tools = $('#pl-tools');
  if (tools) {
    const slug = new URLSearchParams(location.search).get('s') || '';
    let pl = null;
    const show = () => {
      $('#pl-title').textContent = pl.name;
      document.title = `${pl.name} · Playlist | Creative Sound`;
      $('#pl-sub').textContent = `${pl.owner ? `By ${pl.owner} · ` : ''}${pl.ids.length} track${pl.ids.length === 1 ? '' : 's'}`;
      tools.innerHTML = `<button type="button" class="sf-act" data-pl-share>Share link</button>${pl.mine ? '<button type="button" class="sf-act" data-pl-rename>Rename</button><button type="button" class="sf-act pl-danger" data-pl-delete>Delete</button>' : ''}`;
      let tries = 0;
      const push = () => { if (window.csPlaylistView) window.csPlaylistView.set(pl.ids); else if (tries++ < 100) setTimeout(push, 100); };
      push();
    };
    fetch(`${API}?s=${encodeURIComponent(slug)}`).then(async (r) => {
      if (!r.ok) throw new Error();
      pl = await r.json();
      show();
    }).catch(() => { $('#pl-title').textContent = 'Playlist not found'; $('#pl-sub').textContent = 'The link may be wrong, or the playlist was deleted.'; });

    tools.addEventListener('click', async (e) => {
      if (!pl) return;
      if (e.target.closest('[data-pl-share]')) {
        const b = e.target.closest('button'), url = link(pl.slug);
        try { await navigator.clipboard.writeText(url); b.textContent = 'Link copied'; setTimeout(() => { b.textContent = 'Share link'; }, 1800); } catch (err) { window.prompt('Copy the link', url); }
      } else if (e.target.closest('[data-pl-rename]')) {
        const name = window.prompt('Playlist name', pl.name);
        if (name && name.trim()) { try { await post({ do: 'rename', id: pl.id, name }); pl.name = name.trim().slice(0, 40); show(); } catch (err) { window.alert(err.message); } }
      } else if (e.target.closest('[data-pl-delete]')) {
        if (!window.confirm(`Delete "${pl.name}"? The tracks stay in the store.`)) return;
        try { await post({ do: 'delete', id: pl.id }); location.href = 'profile-saved.html'; } catch (err) { window.alert(err.message); }
      }
    });

    // Owner: a remove button on every card.
    const grid = $('#bt-saved-grid');
    const addX = () => {
      if (!pl || !pl.mine || !grid) return;
      grid.querySelectorAll('.bt-card').forEach((card) => {
        if (card.querySelector('.pl-x')) return;
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pl-x'; b.dataset.plRemove = card.dataset.id; b.setAttribute('aria-label', 'Remove from this playlist'); b.textContent = '×';
        const wrap = card.querySelector('.bt-cover-wrap'); if (wrap) wrap.appendChild(b);
      });
    };
    if (grid) {
      new MutationObserver(addX).observe(grid, { childList: true });
      grid.addEventListener('click', async (e) => {
        const x = e.target.closest('[data-pl-remove]');
        if (!x || !pl) return;
        e.preventDefault(); e.stopPropagation();
        try { await post({ do: 'remove', id: pl.id, beatId: x.dataset.plRemove }); pl.ids = pl.ids.filter((i) => i !== x.dataset.plRemove); show(); } catch (err) { window.alert(err.message); }
      }, true);
    }
  }
})();
