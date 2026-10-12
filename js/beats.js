/* Beat store: catalogue (beats.html) and single beat pages (beats/<id>.html).

   Data: data/beats.json (catalogue, producers, prices in cents per tier)
   and data/beat-licenses.json (the four tiers). The server re-reads prices
   at checkout, so nothing priced in the browser is trusted.

   Shared on both pages: persistent player with visualizer, license picker,
   cart drawer. Catalogue only: collection tiles, search, custom filter
   dropdowns, tag chips, grid/list. Beat page only: inline licensing, more
   from the producer, related tracks.

   Motion (Emil Kowalski rules, see css/beats.css): transform/opacity, strong
   curves, UI under 300ms, drawers 400ms, dropdowns grow from their trigger,
   WAAPI only for the add-to-cart flight and badge, reduced motion = gentler. */
(function () {
  const catalogueRoot = document.querySelector('.beats-page');
  const beatRoot = document.querySelector('[data-beat-id]');
  if (!catalogueRoot && !beatRoot) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} },
  };
  const track = (name, data) => { try { window.va && window.va('event', { name, data }); } catch (e) {} };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (cents) => `€${(cents / 100).toFixed(2)}`;
  const fmtTime = (s) => (isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

  let BEATS = [];
  let LIC = null;
  let PRODUCERS = {};
  let byId = new Map();

  /* ------------------------------ Shared markup ---------------------------- */
  const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];
  const tintClass = (b) => `bt-tint-${TINTS.includes(b.tint) ? b.tint : 'amber'}`;
  const beatUrl = (b) => `beats/${encodeURIComponent(b.id)}.html`;
  const art = (b) => `
    <div class="bt-art">
      ${b.cover
        ? `<img src="${esc(b.cover)}" alt="" loading="lazy">`
        : `<div class="bt-art-gen" aria-hidden="true"></div><span class="bt-art-word" aria-hidden="true">${esc(b.title)}</span>`}
    </div>`;
  const VERIFIED = '<svg class="bt-verified" viewBox="0 0 24 24" role="img" aria-label="Verified producer"><title>Verified producer</title><path class="bt-verified-seal" d="M12.0 1.0L12.9 1.4L13.7 2.3L14.4 2.9L15.4 2.8L16.5 2.4L17.5 2.5L18.1 3.3L18.3 4.5L18.6 5.4L19.5 5.7L20.7 5.9L21.5 6.5L21.6 7.5L21.2 8.6L21.1 9.6L21.7 10.3L22.6 11.1L23.0 12.0L22.6 12.9L21.7 13.7L21.1 14.4L21.2 15.4L21.6 16.5L21.5 17.5L20.7 18.1L19.5 18.3L18.6 18.6L18.3 19.5L18.1 20.7L17.5 21.5L16.5 21.6L15.4 21.2L14.4 21.1L13.7 21.7L12.9 22.6L12.0 23.0L11.1 22.6L10.3 21.7L9.6 21.1L8.6 21.2L7.5 21.6L6.5 21.5L5.9 20.7L5.7 19.5L5.4 18.6L4.5 18.3L3.3 18.1L2.5 17.5L2.4 16.5L2.8 15.4L2.9 14.4L2.3 13.7L1.4 12.9L1.0 12.0L1.4 11.1L2.3 10.3L2.9 9.6L2.8 8.6L2.4 7.5L2.5 6.5L3.3 5.9L4.5 5.7L5.4 5.4L5.7 4.5L5.9 3.3L6.5 2.5L7.5 2.4L8.6 2.8L9.6 2.9L10.3 2.3L11.1 1.4Z"/><path class="bt-verified-tick" d="M7.6 12.4l3 3 5.8-6.2"/></svg>';
  const isVerified = (name) => !!(PRODUCERS[name] && PRODUCERS[name].verified);
  const producerLine = (b) => `<span class="bt-producer">${esc(b.producer)}${isVerified(b.producer) ? VERIFIED : ''}</span>`;
  const tiersOf = (b) => LIC.order.filter((t) => b.prices && b.prices[t] > 0);
  const minPrice = (b) => Math.min(...tiersOf(b).map((t) => b.prices[t]));

  /* ---------------------------------- Saved -------------------------------- */
  // An artist can save beats to come back to (kept in this browser). Saved
  // beats get their own "Saved" collection tile.
  const saved = new Set(store.get('bt-saved', []));
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3l-1.3-1.2C5.8 14.7 3 12.1 3 8.9 3 6.3 5 4.3 7.6 4.3c1.5 0 2.9.7 3.8 1.8h1.2c.9-1.1 2.3-1.8 3.8-1.8C19 4.3 21 6.3 21 8.9c0 3.2-2.8 5.8-7.7 10.2z"/></svg>';
  const saveButton = (b) => `<button type="button" class="bt-save${saved.has(b.id) ? ' is-saved' : ''}" data-save="${esc(b.id)}" aria-pressed="${saved.has(b.id)}" aria-label="${saved.has(b.id) ? 'Remove' : 'Save'} ${esc(b.title)}${saved.has(b.id) ? ' from saved' : ''}">${HEART}</button>`;
  const toggleSave = (id) => {
    const b = byId.get(id);
    if (!b) return;
    const on = !saved.has(id);
    if (on) saved.add(id); else saved.delete(id);
    store.set('bt-saved', [...saved]);
    track(on ? 'Beat save' : 'Beat unsave', { beat: id });
    $$(`[data-save="${CSS.escape(id)}"]`).forEach((btn) => {
      btn.classList.toggle('is-saved', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${on ? 'Remove' : 'Save'} ${b.title}${on ? ' from saved' : ''}`);
      const label = btn.querySelector('.bt-save-text');
      if (label) label.textContent = on ? 'Saved' : 'Save';
      if (on && !reduceMotion) {
        btn.querySelector('svg').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], { duration: 320, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
        btn.classList.remove('is-burst');
        void btn.offsetWidth;
        btn.classList.add('is-burst');
      }
    });
    if (catalogueRoot) onSavedChange();
  };
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-save]');
    if (btn) { e.preventDefault(); e.stopPropagation(); toggleSave(btn.dataset.save); }
  }, true);

  const cardHtml = (b, i) => `
    <article class="bt-card ${tintClass(b)}" data-id="${esc(b.id)}" style="--i:${Math.min(i, 12)}">
      <div class="bt-cover-wrap">
        ${art(b)}
        <button type="button" class="bt-play" aria-label="Play ${esc(b.title)}" aria-pressed="false">
          <svg class="bt-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>
          <svg class="bt-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
        </button>
        <span class="bt-eq" aria-hidden="true"><i></i><i></i><i></i></span>
        ${saveButton(b)}
      </div>
      <div class="bt-body">
        <div class="bt-titles">
          <a class="bt-name" href="${beatUrl(b)}">${esc(b.title)}</a>
          ${producerLine(b)}
        </div>
        <div class="bt-specs" aria-label="Details">
          <span class="bt-spec"><b>${b.bpm}</b><small>BPM</small></span><span class="bt-spec">${esc(b.key)}</span><span class="bt-spec bt-spec-genre">${esc(b.genre)}</span>
        </div>
        <button type="button" class="bt-buy" data-buy aria-label="Choose a license for ${esc(b.title)}, from ${euro(minPrice(b))}">
          <span class="bt-buy-text"><span class="bt-buy-label">Licenses from</span><span class="bt-buy-price">${euro(minPrice(b))}</span></span>
          <span class="bt-buy-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 7h14l-1.4 10.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 7V5.8a3 3 0 0 1 6 0V7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
        </button>
      </div>
    </article>`;

  // Entrance once, when a list first scrolls into view.
  const enter = (container) => {
    const cards = $$('.bt-card', container);
    cards.forEach((c) => c.classList.add('bt-enter'));
    const go = () => cards.forEach((c) => { c.classList.remove('bt-enter'); c.classList.add('bt-in'); });
    if (!('IntersectionObserver' in window)) { go(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); go(); }
    }, { threshold: 0.1 });
    io.observe(container);
  };

  const bindCardClicks = (container) => {
    container.addEventListener('click', (e) => {
      const card = e.target.closest('.bt-card');
      if (!card) return;
      const beat = byId.get(card.dataset.id);
      if (e.target.closest('.bt-play')) togglePlay(beat.id);
      else if (e.target.closest('[data-buy]')) openLicense(beat, e.target.closest('[data-buy]'));
    });
  };

  /* --------------------------- Collections (tiles) -------------------------- */
  const NEW_DAYS = 30;
  const ICONS = {
    all: '<path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    new: '<path d="M12 3l2.3 5.4 5.7.5-4.3 3.8 1.3 5.6L12 15.4 7 18.3l1.3-5.6L4 8.9l5.7-.5z" fill="currentColor"/>',
    under30: '<path d="M3 12V4h8l10 10-8 8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="7.5" cy="8.5" r="1.6" fill="currentColor"/>',
    stems: '<path d="M5 18V9M10 18V5M15 18v-7M20 18V8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    project: '<path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    genre: '<path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/>',
    saved: '<path d="M12 20.3l-1.3-1.2C5.8 14.7 3 12.1 3 8.9 3 6.3 5 4.3 7.6 4.3c1.5 0 2.9.7 3.8 1.8h1.2c.9-1.1 2.3-1.8 3.8-1.8C19 4.3 21 6.3 21 8.9c0 3.2-2.8 5.8-7.7 10.2z" fill="currentColor"/>',
  };
  const collections = () => {
    const base = [
      { id: 'all', label: 'All beats', icon: 'all', test: () => true },
      { id: 'saved', label: 'Saved', icon: 'saved', test: (b) => saved.has(b.id) },
      { id: 'new', label: 'New', icon: 'new', test: (b) => (Date.now() - new Date(b.released).getTime()) / 864e5 <= NEW_DAYS },
      { id: 'under30', label: 'Under €30', icon: 'under30', test: (b) => minPrice(b) < 3000 },
      { id: 'stems', label: 'With stems', icon: 'stems', test: (b) => b.prices.trackout > 0 },
      { id: 'project', label: 'With FLP', icon: 'project', test: (b) => b.prices.project > 0 },
    ];
    const genres = [...new Set(BEATS.map((b) => b.genre))].sort();
    return base.concat(genres.map((g) => ({ id: `genre:${g}`, label: g, icon: 'genre', test: (b) => b.genre === g })));
  };
  let COLLECTIONS = [];

  /* ------------------------------ Dropdowns -------------------------------- */
  // Custom listbox: trigger pill + panel that grows from the trigger, a
  // highlight that glides between options, options settle in with a short
  // stagger. Keyboard: arrows, Home/End, Enter/Space, Escape, Tab.
  const openDropdowns = new Set();
  const makeDropdown = ({ key, label, options, value, onChange, alwaysSet }) => {
    const wrap = document.createElement('div');
    wrap.className = 'bt-dd';
    wrap.dataset.key = key;
    const id = `bt-dd-${key}`;
    wrap.innerHTML = `
      <button type="button" class="bt-dd-btn" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}">
        <span class="bt-dd-label">${esc(label)}</span>
        <span class="bt-dd-value"></span>
        <svg class="bt-dd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="bt-dd-panel" id="${id}" role="listbox" aria-label="${esc(label)}" tabindex="-1">
        <span class="bt-dd-glide" aria-hidden="true"></span>
        ${options.map((o, i) => `
          <div class="bt-dd-opt" role="option" id="${id}-${i}" data-value="${esc(o.value)}" aria-selected="false" style="--k:${i}">
            <svg class="bt-dd-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4l3 3 6.6-7"/></svg>
            <span class="bt-dd-text">${esc(o.label)}</span>
            ${o.count != null ? `<span class="bt-dd-count">${o.count}</span>` : ''}
          </div>`).join('')}
      </div>`;
    const btn = $('.bt-dd-btn', wrap);
    const panel = $('.bt-dd-panel', wrap);
    const glide = $('.bt-dd-glide', wrap);
    const opts = $$('.bt-dd-opt', wrap);
    let current = value;
    let active = -1;

    const paintValue = () => {
      const o = options.find((x) => x.value === current) || options[0];
      $('.bt-dd-value', wrap).textContent = o.short || o.label;
      wrap.classList.toggle('is-set', !alwaysSet && current !== options[0].value);
      opts.forEach((el) => el.setAttribute('aria-selected', String(el.dataset.value === current)));
    };
    const moveGlide = (i, instant) => {
      const el = opts[i];
      if (!el) { glide.style.opacity = '0'; return; }
      if (instant) glide.style.transition = 'none';
      glide.style.opacity = '1';
      glide.style.transform = `translateY(${el.offsetTop}px)`;
      glide.style.height = `${el.offsetHeight}px`;
      if (instant) { void glide.offsetWidth; glide.style.transition = ''; }
    };
    const setActive = (i, instant) => {
      active = Math.max(0, Math.min(opts.length - 1, i));
      opts.forEach((el, k) => el.classList.toggle('is-active', k === active));
      panel.setAttribute('aria-activedescendant', opts[active].id);
      moveGlide(active, instant);
    };
    const open = () => {
      openDropdowns.forEach((close) => close(true));
      // Open towards the left when the panel would run off the right edge.
      wrap.classList.remove('align-right');
      const btnRect = btn.getBoundingClientRect();
      if (btnRect.left + Math.max(panel.offsetWidth, 220) > window.innerWidth - 12) wrap.classList.add('align-right');
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      const sel = Math.max(0, opts.findIndex((el) => el.dataset.value === current));
      setActive(sel, true);
      panel.focus({ preventScroll: true });
      openDropdowns.add(close);
    };
    function close(silent) {
      if (!wrap.classList.contains('is-open')) return;
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      openDropdowns.delete(close);
      if (!silent) btn.focus({ preventScroll: true });
    }
    const choose = (i) => {
      const v = opts[i].dataset.value;
      if (v !== current) { current = v; paintValue(); onChange(v); }
      close();
    };

    btn.addEventListener('click', () => (wrap.classList.contains('is-open') ? close() : open()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
    panel.addEventListener('pointermove', (e) => {
      const el = e.target.closest('.bt-dd-opt');
      if (el) { const i = opts.indexOf(el); if (i !== active) setActive(i); }
    });
    panel.addEventListener('click', (e) => { const el = e.target.closest('.bt-dd-opt'); if (el) choose(opts.indexOf(el)); });
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(opts.length - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') close(true);
    });
    paintValue();
    return {
      el: wrap,
      reset() { current = options[0].value; paintValue(); },
    };
  };
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('.bt-dd')) openDropdowns.forEach((close) => close(true));
  });

  /* ------------------------------ Catalogue page --------------------------- */
  const grid = $('#bt-grid');
  const state = {
    col: 'all', q: '', genre: '', mood: '', bpm: '', key: '', sort: 'new',
    tags: new Set(), view: store.get('bt-view', 'grid'),
  };
  let visible = [];
  let firstRender = true;
  const dropdowns = {};

  const BPM_RANGES = [
    { value: '', label: 'Any tempo', short: 'Any' },
    { value: '0-89', label: 'Slow · under 90' },
    { value: '90-119', label: 'Mid · 90–119' },
    { value: '120-139', label: 'Up · 120–139' },
    { value: '140-999', label: 'Fast · 140+' },
  ];
  const inBpm = (b, range) => { const [lo, hi] = range.split('-').map(Number); return b.bpm >= lo && b.bpm <= hi; };

  const matches = (b, skip) => {
    const col = COLLECTIONS.find((c) => c.id === state.col);
    if (col && !col.test(b)) return false;
    if (skip !== 'genre' && state.genre && b.genre !== state.genre) return false;
    if (skip !== 'mood' && state.mood && b.mood !== state.mood) return false;
    if (skip !== 'key' && state.key && b.key !== state.key) return false;
    if (skip !== 'bpm' && state.bpm && !inBpm(b, state.bpm)) return false;
    for (const t of state.tags) if (!(b.tags || []).includes(t)) return false;
    if (state.q) {
      const hay = [b.title, b.producer, b.genre, b.mood, b.key, ...(b.tags || []), ...(b.typeBeat || [])].join(' ').toLowerCase();
      if (!state.q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  };
  const sorters = {
    new: (a, b) => new Date(b.released) - new Date(a.released),
    'price-asc': (a, b) => minPrice(a) - minPrice(b),
    'price-desc': (a, b) => minPrice(b) - minPrice(a),
    'bpm-asc': (a, b) => a.bpm - b.bpm,
  };
  const isFiltered = () => state.col !== 'all' || state.q || state.genre || state.mood || state.bpm || state.key || state.tags.size;

  const paint = () => {
    grid.innerHTML = visible.map(cardHtml).join('');
    grid.dataset.view = state.view;
    $('#bt-empty').hidden = visible.length > 0;
    $('#bt-empty p').textContent = state.col === 'saved' && !saved.size
      ? 'No saved beats yet. Tap the heart on any beat to keep it here.'
      : 'No beats match these filters.';
    $('#bt-count').textContent = `${visible.length} beat${visible.length === 1 ? '' : 's'}`;
    $('#bt-reset').hidden = !isFiltered();
    syncCards();
    renderCart();
  };
  const render = () => {
    visible = BEATS.filter((b) => matches(b)).sort(sorters[state.sort]);
    if (firstRender) { firstRender = false; paint(); enter(grid); return; }
    if (reduceMotion) { paint(); return; }
    grid.classList.add('is-swapping');
    setTimeout(() => { paint(); grid.classList.remove('is-swapping'); }, 150);
  };

  const tileHtml = (c) => {
    const items = BEATS.filter(c.test);
    // Up to four covers of the collection make the tile's collage.
    const mosaic = items.slice(0, 4).map((b) => `<span class="bt-col-tile ${tintClass(b)}">${art(b)}</span>`).join('');
    const empty = !items.length && c.id !== 'saved';
    return `
      <button type="button" class="bt-col${c.id === state.col ? ' is-active' : ''}" role="tab" aria-selected="${c.id === state.col}" data-col="${esc(c.id)}" ${empty ? 'disabled' : ''}>
        <span class="bt-col-disc">
          <span class="bt-col-mosaic n${Math.min(items.length, 4)}" aria-hidden="true">${mosaic}</span>
          <span class="bt-col-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[c.icon]}</svg></span>
          <svg class="bt-col-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="48"/></svg>
        </span>
        <span class="bt-col-label">${esc(c.label)}</span>
        <span class="bt-col-count">${items.length} beat${items.length === 1 ? '' : 's'}</span>
      </button>`;
  };
  // Saving/unsaving refreshes the Saved tile in place, and the grid when
  // the Saved collection is the one being shown.
  function onSavedChange() {
    const tile = $('.bt-col[data-col="saved"]');
    const c = COLLECTIONS.find((x) => x.id === 'saved');
    if (tile && c) {
      const tmp = document.createElement('div');
      tmp.innerHTML = tileHtml(c).trim();
      const fresh = tmp.firstElementChild;
      tile.replaceWith(fresh);
      if (!reduceMotion) fresh.querySelector('.bt-col-disc').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 300, easing: EASE_OUT });
    }
    if (state.col === 'saved') render();
  }

  const renderCollections = () => {
    COLLECTIONS = collections();
    const row = $('#bt-cats');
    row.innerHTML = COLLECTIONS.map(tileHtml).join('');
    row.addEventListener('click', (e) => {
      const tile = e.target.closest('.bt-col');
      if (!tile || tile.disabled || tile.dataset.col === state.col) return;
      state.col = tile.dataset.col;
      $$('.bt-col', row).forEach((t) => { const on = t === tile; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', String(on)); });
      render();
    });

    const clip = $('.bt-cats-clip');
    const prev = $('#bt-cats-prev');
    const next = $('#bt-cats-next');
    const updateArrows = () => {
      prev.disabled = row.scrollLeft < 4;
      next.disabled = row.scrollLeft + row.clientWidth > row.scrollWidth - 4;
      clip.classList.toggle('fade-l', !prev.disabled);
      clip.classList.toggle('fade-r', !next.disabled);
    };
    const page = (dir) => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: reduceMotion ? 'auto' : 'smooth' });
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    row.addEventListener('scroll', updateArrows, { passive: true });
    window.addEventListener('resize', updateArrows);
    updateArrows();

    const hide = $('#bt-cats-hide');
    const wrap = $('#bt-cats-wrap');
    const setHidden = (hidden) => {
      wrap.classList.toggle('is-collapsed', hidden);
      hide.setAttribute('aria-expanded', String(!hidden));
      hide.firstChild.textContent = hidden ? 'Show ' : 'Hide ';
      hide.classList.toggle('is-collapsed', hidden);
      prev.hidden = hidden;
      next.hidden = hidden;
      store.set('bt-cats-hidden', hidden);
    };
    hide.addEventListener('click', () => setHidden(!wrap.classList.contains('is-collapsed')));
    if (store.get('bt-cats-hidden', false)) setHidden(true);
  };

  const countOptions = (key, values) => values.map((v) => ({ value: v, label: v, count: BEATS.filter((b) => b[key] === v && matches(b, key)).length }));

  const setupDropdowns = () => {
    const box = $('#bt-dds');
    const uniq = (k) => [...new Set(BEATS.map((b) => b[k]).filter(Boolean))].sort();
    const add = (key, label, options, extra = {}) => {
      const dd = makeDropdown({ key, label, options, value: state[key], onChange: (v) => { state[key] = v; render(); }, ...extra });
      dropdowns[key] = dd;
      box.appendChild(dd.el);
    };
    add('genre', 'Genre', [{ value: '', label: 'Any genre', short: 'Any' }, ...countOptions('genre', uniq('genre'))]);
    add('mood', 'Mood', [{ value: '', label: 'Any mood', short: 'Any' }, ...countOptions('mood', uniq('mood'))]);
    add('bpm', 'BPM', BPM_RANGES.map((r, i) => (i ? { ...r, count: BEATS.filter((b) => inBpm(b, r.value)).length } : r)));
    add('key', 'Key', [{ value: '', label: 'Any key', short: 'Any' }, ...countOptions('key', uniq('key'))]);
    add('sort', 'Sort', [
      { value: 'new', label: 'Newest first', short: 'Newest' },
      { value: 'price-asc', label: 'Price: low to high', short: 'Price ↑' },
      { value: 'price-desc', label: 'Price: high to low', short: 'Price ↓' },
      { value: 'bpm-asc', label: 'BPM: slow to fast', short: 'BPM ↑' },
    ], { alwaysSet: true });
  };

  const setupCatalogue = () => {
    renderCollections();
    setupDropdowns();

    const counts = new Map();
    BEATS.forEach((b) => (b.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([t]) => t);
    $('#bt-tags').innerHTML = tags.map((t) => `<button type="button" class="bt-tag" aria-pressed="false" data-tag="${esc(t)}">#${esc(t)}</button>`).join('');
    $('#bt-tags').addEventListener('click', (e) => {
      const btn = e.target.closest('.bt-tag');
      if (!btn) return;
      const t = btn.dataset.tag;
      if (state.tags.has(t)) state.tags.delete(t); else state.tags.add(t);
      btn.classList.toggle('is-active', state.tags.has(t));
      btn.setAttribute('aria-pressed', String(state.tags.has(t)));
      render();
    });

    let qTimer = 0;
    $('#bt-q').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 160);
    });

    const reset = () => {
      Object.assign(state, { col: 'all', q: '', genre: '', mood: '', bpm: '', key: '' });
      state.tags.clear();
      $('#bt-q').value = '';
      ['genre', 'mood', 'bpm', 'key'].forEach((k) => dropdowns[k].reset());
      $$('.bt-col').forEach((t) => { const on = t.dataset.col === 'all'; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', String(on)); });
      $$('.bt-tag').forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
      render();
    };
    $('#bt-reset').addEventListener('click', reset);
    $$('[data-reset]').forEach((b) => b.addEventListener('click', reset));

    $$('.bt-view-btn').forEach((btn) => btn.addEventListener('click', () => {
      if (state.view === btn.dataset.view) return;
      state.view = btn.dataset.view;
      store.set('bt-view', state.view);
      $$('.bt-view-btn').forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
      if (reduceMotion) { grid.dataset.view = state.view; return; }
      grid.classList.add('is-swapping');
      setTimeout(() => { grid.dataset.view = state.view; grid.classList.remove('is-swapping'); }, 150);
    }));
    $$('.bt-view-btn').forEach((b) => { b.classList.toggle('is-active', b.dataset.view === state.view); b.setAttribute('aria-pressed', String(b.dataset.view === state.view)); });

    bindCardClicks(grid);
    renderTierGrid();
    render();
  };

  const renderTierGrid = () => {
    const el = $('#bt-tier-grid');
    if (!el) return;
    el.innerHTML = LIC.order.map((id) => {
      const t = LIC.tiers[id];
      return `
        <div class="bt-tier-card${t.unlimited ? ' is-unlimited' : ''}">
          <span class="bt-tier-badge">${t.unlimited ? 'Unlimited' : 'Lease'}</span>
          <h3>${esc(t.name)}</h3>
          <ul>
            <li>${esc(t.files.map((f) => LIC.fileLabels[f]).join(' + '))}</li>
            <li>Streams: ${esc(t.terms.streams)}</li>
            <li>Sales: ${esc(t.terms.sales)}</li>
            <li>Music videos: ${esc(t.terms.videos)}</li>
            <li>Radio: ${esc(t.terms.radio)}</li>
          </ul>
        </div>`;
    }).join('');
  };

  /* -------------------------------- Beat page ------------------------------ */
  const USAGE_ICONS = {
    recording: '<path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    sales: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    streams: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    videos: '<rect x="3" y="6" width="13" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 10l5-3v10l-5-3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    performances: '<path d="M4 20l6-6M14.5 4.5a4.95 4.95 0 1 1 5 5l-6 1-1-1z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>',
    radio: '<rect x="3" y="9" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 9l10-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="15.5" cy="14.5" r="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  };
  const usageRows = (t) => [
    ['recording', 'Use it to record one new song'],
    ['sales', `Sales & downloads: ${t.terms.sales}`],
    ['streams', `Audio streams: ${t.terms.streams}`],
    ['videos', `Music videos: ${t.terms.videos}`],
    ['performances', `Live: ${t.terms.performances}`],
    ['radio', `Radio: ${t.terms.radio}`],
  ];

  const setupBeatPage = () => {
    const beat = byId.get(beatRoot.dataset.beatId);
    if (!beat) return;
    let tier = tiersOf(beat).includes('wav') ? 'wav' : tiersOf(beat)[0];
    const inCart = cart.find((c) => c.id === beat.id);
    if (inCart && tiersOf(beat).includes(inCart.tier)) tier = inCart.tier;

    const paintTier = () => {
      $$('.bp-tier', beatRoot).forEach((el) => {
        const on = el.dataset.tier === tier;
        el.classList.toggle('is-selected', on);
        $('input', el).checked = on;
      });
      const t = LIC.tiers[tier];
      $('#bp-total').textContent = euro(beat.prices[tier]);
      $('#bp-usage-title').textContent = `${t.name}${t.unlimited ? ' · Unlimited' : ''}`;
      $('#bp-usage').innerHTML = usageRows(t).map(([icon, text]) => `<li><svg viewBox="0 0 24 24" aria-hidden="true">${USAGE_ICONS[icon]}</svg><span>${esc(text)}</span></li>`).join('');
      const c = cart.find((x) => x.id === beat.id);
      $('#bp-add').textContent = c && c.tier === tier ? 'In cart' : (c ? 'Update cart' : 'Add to cart');
    };
    $('#bp-tiers').addEventListener('change', (e) => { if (e.target.name === 'bp-tier') { tier = e.target.value; paintTier(); } });
    $('#bp-add').addEventListener('click', (e) => {
      const c = cart.find((x) => x.id === beat.id);
      if (c && c.tier === tier) { openCart(); return; }
      addToCart(beat.id, tier);
      track('Beat add to cart', { beat: beat.id, tier, from: 'beat-page' });
      paintTier();
      flyToCart(beat, $('.bp-cover', beatRoot).getBoundingClientRect());
      e.currentTarget.blur();
    });
    $('#bp-buy').addEventListener('click', () => {
      addToCart(beat.id, tier);
      paintTier();
      checkout();
    });
    $$('[data-play-beat]', beatRoot).forEach((b) => b.addEventListener('click', () => togglePlay(beat.id)));
    $$('.bp-save', beatRoot).forEach((btn) => {
      const on = saved.has(beat.id);
      btn.classList.toggle('is-saved', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', `${on ? 'Remove' : 'Save'} ${beat.title}${on ? ' from saved' : ''}`);
      $('.bt-save-text', btn).textContent = on ? 'Saved' : 'Save';
    });
    const share = $('#bp-share');
    if (share) share.addEventListener('click', async () => {
      const url = location.href.split('#')[0];
      try {
        if (navigator.share) await navigator.share({ title: `${beat.title} by ${beat.producer}`, url });
        else { await navigator.clipboard.writeText(url); share.querySelector('span').textContent = 'Link copied'; setTimeout(() => { share.querySelector('span').textContent = 'Share'; }, 1800); }
      } catch (e) {}
    });
    paintTier();

    const more = BEATS.filter((b) => b.producer === beat.producer && b.id !== beat.id).slice(0, 8);
    const related = BEATS.filter((b) => b.id !== beat.id && !more.includes(b))
      .map((b) => ({ b, score: (b.genre === beat.genre ? 3 : 0) + (b.mood === beat.mood ? 2 : 0) + (b.tags || []).filter((t) => (beat.tags || []).includes(t)).length - Math.abs(b.bpm - beat.bpm) / 40 }))
      .sort((x, y) => y.score - x.score).slice(0, 8).map((x) => x.b);
    [['#bp-more', more], ['#bp-related', related]].forEach(([sel, list]) => {
      const box = $(sel);
      if (!box) return;
      const section = box.closest('section');
      if (!list.length) { section.hidden = true; return; }
      box.innerHTML = list.map(cardHtml).join('');
      bindCardClicks(box);
      enter(box);
    });
    syncCards();
  };

  /* --------------------------------- Player -------------------------------- */
  const player = $('#bt-player');
  const audio = new Audio();
  audio.preload = 'none';
  let currentId = null;
  let actx = null;
  let analyser = null;
  let freq = null;
  let wave = null;
  let raf = 0;
  const bands = new Array(44).fill(0);
  const vizCanvas = $('#bt-player-viz');
  const vg = vizCanvas.getContext('2d');

  const queue = () => (catalogueRoot ? (visible.length ? visible : BEATS) : BEATS);

  const showPlayer = (beat) => {
    player.className = `bt-player ${tintClass(beat)}${audio.paused ? '' : ' is-playing'}${player.classList.contains('is-visible') ? ' is-visible' : ''}`;
    $('#bt-player-cover').innerHTML = art(beat);
    $('#bt-player-title').textContent = beat.title;
    $('#bt-player-title').href = beatUrl(beat);
    $('#bt-player-producer').innerHTML = producerLine(beat);
    $('#bt-player-buy').innerHTML = `<span>Buy</span><strong>${euro(minPrice(beat))}</strong>`;
    $('#bt-player-buy').setAttribute('aria-label', `Buy ${beat.title}, from ${euro(minPrice(beat))}`);
    if (player.hidden) {
      player.hidden = false;
      document.body.classList.add('bt-has-player');
      requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--bt-player-h', `${player.offsetHeight}px`);
        requestAnimationFrame(() => player.classList.add('is-visible'));
      });
    }
  };

  const syncCards = () => {
    $$('.bt-card').forEach((c) => {
      const cur = c.dataset.id === currentId;
      const playing = cur && !audio.paused;
      c.classList.toggle('is-current', cur);
      c.classList.toggle('is-playing', playing);
      const btn = $('.bt-play', c);
      if (!btn) return;
      btn.setAttribute('aria-pressed', String(playing));
      btn.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${byId.get(c.dataset.id).title}`);
    });
    if (beatRoot) {
      const playing = beatRoot.dataset.beatId === currentId && !audio.paused;
      beatRoot.classList.toggle('is-playing', playing);
      $$('[data-play-beat]', beatRoot).forEach((b) => b.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview'));
    }
    player.classList.toggle('is-playing', !audio.paused);
    $('#bt-play').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  };

  const ensureAnalyser = async () => {
    if (reduceMotion || analyser || !(window.AudioContext || window.webkitAudioContext)) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const src = actx.createMediaElementSource(audio);
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      analyser.connect(actx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
      wave = new Uint8Array(analyser.fftSize);
    } catch (e) { analyser = null; }
  };

  const play = async (id) => {
    const beat = byId.get(id);
    if (!beat) return;
    if (currentId !== id) {
      currentId = id;
      audio.src = beat.preview;
      track('Beat preview play', { beat: beat.id });
    }
    showPlayer(beat);
    await ensureAnalyser();
    if (actx && actx.state === 'suspended') { try { await actx.resume(); } catch (e) {} }
    try { await audio.play(); } catch (e) { syncCards(); }
  };
  const togglePlay = (id) => { if (id === currentId && !audio.paused) audio.pause(); else play(id); };
  const step = (dir) => {
    const list = queue();
    const i = list.findIndex((b) => b.id === currentId);
    const next = list[(i + dir + list.length) % list.length];
    if (next) play(next.id);
  };

  const rgbOf = (el) => (getComputedStyle(el).getPropertyValue('--fx') || '232,134,44').trim();
  const updateProgress = () => {
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    $('#bt-player-fill').style.transform = `scaleX(${p.toFixed(4)})`;
    $('#bt-player-bar').style.setProperty('--p', p.toFixed(4));
    $('#bt-player-bar').setAttribute('aria-valuenow', String(Math.round(p * 100)));
    $('#bt-time').textContent = fmtTime(audio.currentTime);
    $('#bt-dur').textContent = fmtTime(audio.duration);
  };
  const drawViz = () => {
    raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = vizCanvas.clientWidth;
    const h = vizCanvas.clientHeight;
    if (w && h) {
      if (vizCanvas.width !== Math.round(w * dpr)) { vizCanvas.width = Math.round(w * dpr); vizCanvas.height = Math.round(h * dpr); }
      vg.setTransform(dpr, 0, 0, dpr, 0, 0);
      vg.clearRect(0, 0, w, h);
      const live = !audio.paused && analyser;
      if (live) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); }
      let energy = 0;
      const usable = freq ? freq.length * 0.7 : 0;
      for (let i = 0; i < bands.length; i++) {
        let target = 0;
        if (live) {
          const a = Math.floor(Math.pow(i / bands.length, 1.7) * usable);
          const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / bands.length, 1.7) * usable));
          let sum = 0;
          for (let j = a; j < b; j++) sum += freq[j];
          target = Math.min(1, Math.pow(sum / (b - a) / 255, 2) * (0.9 + (i / bands.length) * 0.6));
        }
        bands[i] += (target - bands[i]) * (target > bands[i] ? 0.5 : 0.12);
        energy += bands[i];
      }
      const rgb = rgbOf(player);
      if (energy > 0.01) {
        const base = h * 0.5;
        const maxH = h * 0.48;
        const stepX = w / (bands.length - 1);
        const grad = vg.createLinearGradient(0, base - maxH, 0, base + maxH);
        grad.addColorStop(0, `rgba(${rgb}, 0)`);
        grad.addColorStop(0.35, `rgba(${rgb}, 0.28)`);
        grad.addColorStop(0.5, `rgba(${rgb}, 0.38)`);
        grad.addColorStop(0.65, `rgba(${rgb}, 0.28)`);
        grad.addColorStop(1, `rgba(${rgb}, 0)`);
        vg.beginPath();
        vg.moveTo(0, base);
        bands.forEach((v, i) => vg.lineTo(i * stepX, base - v * maxH));
        for (let i = bands.length - 1; i >= 0; i--) vg.lineTo(i * stepX, base + bands[i] * maxH);
        vg.closePath();
        vg.fillStyle = grad;
        vg.shadowColor = `rgba(${rgb}, 0.6)`;
        vg.shadowBlur = 12;
        vg.fill();
        vg.shadowBlur = 0;
      }
      if (live) {
        vg.beginPath();
        for (let i = 0; i < wave.length; i += 8) {
          const x = (i / (wave.length - 1)) * w;
          const y = h * 0.5 + ((wave[i] - 128) / 128) * h * 0.3;
          if (i === 0) vg.moveTo(x, y); else vg.lineTo(x, y);
        }
        vg.lineWidth = 1;
        vg.strokeStyle = `rgba(${rgb}, 0.35)`;
        vg.stroke();
      }
      if (!live && energy < 0.01) { vg.clearRect(0, 0, w, h); updateProgress(); return; }
    }
    updateProgress();
    raf = requestAnimationFrame(drawViz);
  };

  audio.addEventListener('play', () => { syncCards(); if (!raf) raf = requestAnimationFrame(drawViz); });
  audio.addEventListener('pause', () => { syncCards(); if (!raf) raf = requestAnimationFrame(drawViz); });
  audio.addEventListener('timeupdate', () => { if (!raf) updateProgress(); });
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('ended', () => step(1));

  const setupPlayer = () => {
    $('#bt-play').addEventListener('click', () => { if (currentId) togglePlay(currentId); });
    $('#bt-prev').addEventListener('click', () => step(-1));
    $('#bt-next').addEventListener('click', () => step(1));
    $('#bt-player-buy').addEventListener('click', (e) => { if (currentId) openLicense(byId.get(currentId), e.currentTarget); });
    const bar = $('#bt-player-bar');
    const seek = (e) => {
      if (!audio.duration) return;
      const r = bar.getBoundingClientRect();
      audio.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * audio.duration;
      updateProgress();
    };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture(e.pointerId); seek(e); });
    bar.addEventListener('pointermove', (e) => { if (e.buttons === 1) seek(e); });
    bar.addEventListener('keydown', (e) => {
      if (!audio.duration) return;
      if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || !currentId) return;
      if (e.target.closest('input, select, textarea, button, a, [role="slider"], [role="listbox"], dialog')) return;
      e.preventDefault();
      togglePlay(currentId);
    });
  };

  /* ------------------------------ License modal ---------------------------- */
  const modal = $('#bt-license');
  let modalBeat = null;
  let modalTier = null;
  let modalTrigger = null;

  const termsTable = (beat) => {
    const tiers = tiersOf(beat);
    const rows = [['Files', (t) => t.files.map((f) => LIC.fileLabels[f]).join(' + ')], ['Streams', (t) => t.terms.streams], ['Sales', (t) => t.terms.sales], ['Music videos', (t) => t.terms.videos], ['Live', (t) => t.terms.performances], ['Radio', (t) => t.terms.radio]];
    return `<table><thead><tr><th></th>${tiers.map((id) => `<th>${esc(LIC.tiers[id].short)}</th>`).join('')}</tr></thead><tbody>${
      rows.map(([label, fn]) => `<tr><th>${label}</th>${tiers.map((id) => `<td>${esc(fn(LIC.tiers[id]))}</td>`).join('')}</tr>`).join('')
    }</tbody></table><p>Every license is non-exclusive and requires the credit "prod. by ${esc(beat.producer)}". Full terms are in the license PDF you receive after purchase.</p>`;
  };
  const selectTier = (id) => {
    modalTier = id;
    $$('.bt-tier', modal).forEach((el) => { const on = el.dataset.tier === id; el.classList.toggle('is-selected', on); $('input', el).checked = on; });
    $('#bt-license-total').textContent = euro(modalBeat.prices[id]);
    const inCart = cart.find((c) => c.id === modalBeat.id);
    $('#bt-license-add').textContent = inCart ? (inCart.tier === id ? 'In cart · View cart' : 'Update cart') : 'Add to cart';
  };
  const openLicense = (beat, trigger) => {
    modalBeat = beat;
    modalTrigger = trigger || null;
    modal.className = `bt-modal ${tintClass(beat)}`;
    $('#bt-license-cover').innerHTML = art(beat);
    $('#bt-license-title').innerHTML = `<a href="${beatUrl(beat)}">${esc(beat.title)}</a>`;
    $('#bt-license-sub').innerHTML = `${producerLine(beat)} · ${beat.bpm} BPM · ${esc(beat.key)}`;
    $('#bt-license-tiers').innerHTML = tiersOf(beat).map((id) => {
      const t = LIC.tiers[id];
      return `
        <label class="bt-tier" data-tier="${id}">
          <input type="radio" name="bt-tier" value="${id}">
          <span class="bt-tier-radio" aria-hidden="true"></span>
          <span>
            <span class="bt-tier-name">${esc(t.name)}${t.unlimited ? '<span class="bt-tier-pill">Unlimited</span>' : ''}</span>
            <span class="bt-tier-files">${esc(t.files.map((f) => LIC.fileLabels[f]).join(' + '))}</span>
          </span>
          <span class="bt-tier-price">${euro(beat.prices[id])}</span>
        </label>`;
    }).join('');
    $('#bt-license-terms').innerHTML = termsTable(beat);
    const inCart = cart.find((c) => c.id === beat.id);
    const tiers = tiersOf(beat);
    selectTier(inCart && tiers.includes(inCart.tier) ? inCart.tier : (tiers.includes('wav') ? 'wav' : tiers[0]));
    modal.classList.remove('is-closing');
    modal.showModal();
  };
  const closeLicense = (after) => {
    if (!modal.open) { if (after) after(); return; }
    if (reduceMotion) { modal.close(); if (after) after(); return; }
    modal.classList.add('is-closing');
    setTimeout(() => { modal.close(); modal.classList.remove('is-closing'); if (after) after(); }, 160);
  };
  const setupModal = () => {
    $('#bt-license-tiers').addEventListener('change', (e) => { if (e.target.name === 'bt-tier') selectTier(e.target.value); });
    $('.bt-modal-close', modal).addEventListener('click', (e) => { e.preventDefault(); closeLicense(); });
    modal.addEventListener('cancel', (e) => { e.preventDefault(); closeLicense(); });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeLicense(); });
    modal.addEventListener('close', () => { if (modalTrigger && document.contains(modalTrigger)) modalTrigger.focus({ preventScroll: true }); });
    $('#bt-license-add').addEventListener('click', () => {
      const existing = cart.find((c) => c.id === modalBeat.id);
      if (existing && existing.tier === modalTier) { closeLicense(() => openCart()); return; }
      const fromRect = $('#bt-license-cover').getBoundingClientRect();
      const beat = modalBeat;
      addToCart(beat.id, modalTier);
      track('Beat add to cart', { beat: beat.id, tier: modalTier });
      closeLicense(() => flyToCart(beat, fromRect));
    });
  };

  /* ---------------------------------- Cart --------------------------------- */
  let cart = store.get('bt-cart', []);
  const fab = $('#bt-cart-open');
  const drawer = $('#bt-cart');
  let drawerReturn = null;

  const cleanCart = () => { cart = cart.filter((c) => byId.has(c.id) && byId.get(c.id).prices[c.tier] > 0); };
  const saveCart = () => { store.set('bt-cart', cart); renderCart(); };
  const addToCart = (id, tier) => {
    const i = cart.findIndex((c) => c.id === id);
    if (i >= 0) cart[i].tier = tier; else cart.push({ id, tier });
    saveCart();
  };
  const cartTotal = () => cart.reduce((s, c) => s + byId.get(c.id).prices[c.tier], 0);
  function renderCart() {
    const n = cart.length;
    $('#bt-cart-count').textContent = String(n);
    fab.hidden = n === 0;
    fab.setAttribute('aria-label', `Open cart, ${n} item${n === 1 ? '' : 's'}`);
    $('#bt-cart-empty').hidden = n > 0;
    $('#bt-checkout').disabled = n === 0;
    $('#bt-cart-total').textContent = euro(cartTotal());
    $('#bt-cart-list').innerHTML = cart.map((c) => {
      const b = byId.get(c.id);
      return `
        <li class="bt-cart-item ${tintClass(b)}" data-id="${esc(b.id)}">
          ${art(b)}
          <span><a class="bt-cart-name" href="${beatUrl(b)}">${esc(b.title)}</a><span class="bt-cart-tier">${esc(LIC.tiers[c.tier].name)} · ${esc(b.producer)}</span></span>
          <span class="bt-cart-side"><span class="bt-cart-price">${euro(b.prices[c.tier])}</span><button type="button" class="bt-cart-remove" aria-label="Remove ${esc(b.title)} from cart">Remove</button></span>
        </li>`;
    }).join('');
    $$('.bt-card').forEach((c) => { const b = $('.bt-buy', c); if (b) b.classList.toggle('in-cart', cart.some((x) => x.id === c.dataset.id)); });
  }
  const openCart = () => {
    drawerReturn = document.activeElement;
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    drawer.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('.bt-modal-close', drawer).focus(), reduceMotion ? 0 : 120);
  };
  const closeCart = () => {
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setTimeout(() => { drawer.inert = true; }, reduceMotion ? 0 : 400);
    if (drawerReturn && document.contains(drawerReturn)) drawerReturn.focus({ preventScroll: true });
  };
  // The cover flies into the cart button, then the badge pulses: shows
  // where the beat went (spatial consistency).
  const flyToCart = (beat, fromRect) => {
    const bump = () => {
      if (reduceMotion) return;
      fab.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 260, easing: EASE_OUT });
      $('#bt-cart-count').animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }], { duration: 220, easing: EASE_OUT });
    };
    if (reduceMotion || !fromRect || !fromRect.width) { bump(); return; }
    const toRect = fab.getBoundingClientRect();
    const size = Math.min(fromRect.width, 120);
    const fly = document.createElement('div');
    fly.className = `bt-fly ${tintClass(beat)}`;
    fly.innerHTML = art(beat);
    const left = fromRect.left + (fromRect.width - size) / 2;
    const top = fromRect.top + (fromRect.height - size) / 2;
    Object.assign(fly.style, { left: `${left}px`, top: `${top}px`, width: `${size}px` });
    document.body.appendChild(fly);
    const dx = toRect.left + toRect.width / 2 - (left + size / 2);
    const dy = toRect.top + toRect.height / 2 - (top + size / 2);
    fly.animate([
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, opacity: 0.4 },
    ], { duration: 560, easing: EASE_IN_OUT }).finished.then(() => { fly.remove(); bump(); }, () => fly.remove());
  };
  const setupCart = () => {
    cleanCart();
    renderCart();
    fab.addEventListener('click', openCart);
    $$('[data-close-cart]', drawer).forEach((el) => el.addEventListener('click', closeCart));
    drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeCart(); });
    $('#bt-cart-list').addEventListener('click', (e) => {
      const btn = e.target.closest('.bt-cart-remove');
      if (!btn) return;
      const li = btn.closest('.bt-cart-item');
      const id = li.dataset.id;
      const done = () => { cart = cart.filter((c) => c.id !== id); saveCart(); if (beatRoot) $('#bp-add') && $('#bp-tiers').dispatchEvent(new Event('change')); if (!cart.length) $('.bt-modal-close', drawer).focus(); };
      if (reduceMotion) { done(); return; }
      li.classList.add('is-leaving');
      setTimeout(done, 180);
    });
    $('#bt-checkout').addEventListener('click', checkout);
    if (new URLSearchParams(location.search).get('cart') === '1' && cart.length) openCart();
  };
  async function checkout() {
    const btn = $('#bt-checkout');
    const note = $('#bt-cart-note');
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
    note.classList.remove('is-error');
    track('Beat checkout', { items: cart.length, total: cartTotal() });
    try {
      const res = await fetch('/api/beats/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cart }),
      });
      if (res.status === 401) {
        location.href = `/signup.html?next=${encodeURIComponent('/beats.html?cart=1')}`;
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout is not available right now. Please try again.');
      location.href = data.url;
    } catch (err) {
      if (!drawer.classList.contains('is-open')) openCart();
      note.textContent = err.message;
      note.classList.add('is-error');
      btn.disabled = false;
      btn.textContent = 'Checkout';
    }
  }

  /* ---------------------------------- Boot --------------------------------- */
  Promise.all([
    fetch('/data/beats.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('/data/beat-licenses.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]).then(([catalogue, licenses]) => {
    LIC = licenses;
    PRODUCERS = catalogue.producers || {};
    BEATS = (catalogue.beats || []).filter((b) => b.status !== 'hidden' && tiersOf(b).length);
    byId = new Map(BEATS.map((b) => [b.id, b]));
    setupPlayer();
    setupModal();
    setupCart();
    if (catalogueRoot) setupCatalogue();
    if (beatRoot) setupBeatPage();
  }).catch((err) => {
    console.error('beats: catalogue failed to load', err);
    const empty = $('#bt-empty');
    if (empty) { empty.hidden = false; $('p', empty).textContent = 'The catalogue could not be loaded. Please refresh the page.'; }
  });
})();
