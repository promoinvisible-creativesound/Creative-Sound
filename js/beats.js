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
  let beatRoot = document.querySelector('[data-beat-id]');
  const savedRoot = document.querySelector('[data-saved-page]');
  // track.html: the page for producer uploads, built from the live catalogue.
  const trackPage = document.querySelector('[data-track-page]');
  if (!catalogueRoot && !beatRoot && !savedRoot && !trackPage) return;

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
  // Track sales can be paused (catalogue.salesOpen === false): prices stay
  // visible, buttons say "Coming soon". The admin can still buy to test.
  let canBuy = true;
  const SOON = 'Coming soon';

  /* ------------------------------ Shared markup ---------------------------- */
  const TINTS = ['amber', 'blue', 'red', 'violet', 'green'];
  // Tracks with a cover colour get their own class (bt-acc-<n>) whose
  // --fx variables override the fixed tint; see paintAccents().
  const accentIds = new Map();
  const tintClass = (b) => `bt-tint-${TINTS.includes(b.tint) ? b.tint : 'amber'}${accentIds.has(b.id) ? ` bt-acc-${accentIds.get(b.id)}` : ''}`;
  const accentVars = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const mix = (t) => rgb.map((c) => Math.round(c + (255 - c) * t)).join(',');
    return `--fx:${rgb.join(',')};--fx-hi:${mix(0.35)};--fx-soft:${mix(0.7)};`;
  };
  const paintAccents = (list) => {
    let css = '';
    list.forEach((b) => {
      if (!b.accent || !/^#[0-9a-f]{6}$/i.test(b.accent)) return;
      const n = accentIds.size + 1;
      accentIds.set(b.id, n);
      css += `.bt-acc-${n}{${accentVars(b.accent)}}`;
    });
    if (!css) return;
    const style = document.createElement('style');
    style.id = 'bt-accents';
    style.textContent = css;
    document.head.appendChild(style);
  };
  // Catalogue beats have static pages; approved producer uploads use track.html.
  const beatUrl = (b) => (b.source === 'producer' ? `track.html?id=${encodeURIComponent(b.id)}` : `beats/${encodeURIComponent(b.id)}.html`);
  const art = (b) => `
    <div class="bt-art">
      ${b.cover
        ? `<img src="${esc(b.cover)}" alt="" loading="lazy">`
        : '<div class="bt-art-gen" aria-hidden="true"></div>'}
    </div>`;
  const VERIFIED = '<svg class="bt-verified" viewBox="0 0 24 24" role="img" aria-label="Verified producer"><title>Verified producer</title><path class="bt-verified-seal" d="M12.0 1.0L12.9 1.4L13.7 2.3L14.4 2.9L15.4 2.8L16.5 2.4L17.5 2.5L18.1 3.3L18.3 4.5L18.6 5.4L19.5 5.7L20.7 5.9L21.5 6.5L21.6 7.5L21.2 8.6L21.1 9.6L21.7 10.3L22.6 11.1L23.0 12.0L22.6 12.9L21.7 13.7L21.1 14.4L21.2 15.4L21.6 16.5L21.5 17.5L20.7 18.1L19.5 18.3L18.6 18.6L18.3 19.5L18.1 20.7L17.5 21.5L16.5 21.6L15.4 21.2L14.4 21.1L13.7 21.7L12.9 22.6L12.0 23.0L11.1 22.6L10.3 21.7L9.6 21.1L8.6 21.2L7.5 21.6L6.5 21.5L5.9 20.7L5.7 19.5L5.4 18.6L4.5 18.3L3.3 18.1L2.5 17.5L2.4 16.5L2.8 15.4L2.9 14.4L2.3 13.7L1.4 12.9L1.0 12.0L1.4 11.1L2.3 10.3L2.9 9.6L2.8 8.6L2.4 7.5L2.5 6.5L3.3 5.9L4.5 5.7L5.4 5.4L5.7 4.5L5.9 3.3L6.5 2.5L7.5 2.4L8.6 2.8L9.6 2.9L10.3 2.3L11.1 1.4Z"/><path class="bt-verified-tick" d="M7.6 12.4l3 3 5.8-6.2"/></svg>';
  const isVerified = (name) => !!(PRODUCERS[name] && PRODUCERS[name].verified);
  // A producer upload carries its own badge (set by the owner on the review
  // page), so nobody gets it by picking a verified producer's name.
  const beatVerified = (b) => (typeof b.verified === 'boolean' ? b.verified : isVerified(b.producer));
  const producerLine = (b) => `<span class="bt-producer">${esc(b.producer)}${beatVerified(b) ? VERIFIED : ''}</span>`;
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
    if (accountSaves) {
      fetch('/api/beats/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ beatId: id, saved: on }) }).catch(() => {});
    }
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
    if (savedRoot) renderSavedPage();
  };
  // Signed in: saves live on the account. Browser-only saves made before
  // signing in are merged in once, then the account list wins.
  let accountSaves = false;
  const paintHearts = () => {
    $$('[data-save]').forEach((btn) => {
      const id = btn.dataset.save;
      const b = byId.get(id);
      const on = saved.has(id);
      btn.classList.toggle('is-saved', on);
      btn.setAttribute('aria-pressed', String(on));
      if (b) btn.setAttribute('aria-label', `${on ? 'Remove' : 'Save'} ${b.title}${on ? ' from saved' : ''}`);
      const label = btn.querySelector('.bt-save-text');
      if (label) label.textContent = on ? 'Saved' : 'Save';
    });
  };
  async function syncSaved() {
    try {
      const res = await fetch('/api/beats/saved');
      if (res.status === 401) {
        if (savedRoot) location.href = '/login.html';
        return;
      }
      if (!res.ok) return;
      let { ids } = await res.json();
      const localOnly = [...saved].filter((id) => !ids.includes(id) && byId.has(id));
      if (localOnly.length) {
        const merged = await fetch('/api/beats/saved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ merge: localOnly }) });
        if (merged.ok) ({ ids } = await merged.json());
      }
      accountSaves = true;
      saved.clear();
      ids.forEach((id) => saved.add(id));
      store.set('bt-saved', ids);
      paintHearts();
      if (catalogueRoot) onSavedChange();
      if (savedRoot) renderSavedPage();
    } catch (e) { /* offline or no API locally: browser saves keep working */ }
  }
  const savedList = () => [...saved].map((id) => byId.get(id)).filter(Boolean);

  // profile-saved.html: the wishlist inside the account.
  function renderSavedPage() {
    const grid = $('#bt-saved-grid');
    if (!grid) return;
    const list = savedList();
    $('#bt-saved-empty').hidden = list.length > 0;
    $('#bt-saved-count').textContent = `${list.length} saved track${list.length === 1 ? '' : 's'}`;
    grid.hidden = !list.length;
    // "Play all": starts the first saved track; the player then follows the saved list.
    const playAll = $('#sv-play');
    if (playAll) {
      playAll.hidden = !list.length;
      if (!playAll.dataset.bound) {
        playAll.addEventListener('click', () => { const first = grid.querySelector('.bt-play'); if (first) first.click(); });
        playAll.dataset.bound = '1';
      }
    }
    grid.innerHTML = list.map(cardHtml).join('');
    if (!grid.dataset.bound) { bindCardClicks(grid); bindTilt(grid); grid.dataset.bound = '1'; }
    syncCards();
    renderCart();
  }

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
        <span class="bt-glare" aria-hidden="true"></span>
        <span class="bt-eq" aria-hidden="true"><i></i><i></i><i></i></span>
        ${b.freeDownload ? '<span class="bt-free-badge">Free download</span>' : ''}
        ${saveButton(b)}
      </div>
      <div class="bt-body">
        <div class="bt-titles">
          <a class="bt-name" href="${beatUrl(b)}">${esc(b.title)}</a>
          ${producerLine(b)}
        </div>
        <div class="bt-specs" aria-label="Details">
          <span class="bt-spec"><b>${b.bpm}</b><small>BPM</small></span><span class="bt-spec">${esc(b.key)}</span><span class="bt-spec bt-spec-genre">${esc(b.genre)}</span><span class="bt-meta-line">${b.bpm} BPM · ${esc(b.key)} · ${esc(b.genre)}</span>
        </div>
        <button type="button" class="bt-buy" data-buy aria-label="Choose a license for ${esc(b.title)}, from ${euro(minPrice(b))}">
          <span class="bt-buy-text"><span class="bt-buy-label">From</span><span class="bt-buy-price">${euro(minPrice(b))}</span></span>
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
      // The cover opens the track page, like the title.
      else if (e.target.closest('.bt-cover-wrap') && !e.target.closest('button, a')) {
        if (e.metaKey || e.ctrlKey) window.open(beatUrl(beat), '_blank');
        else location.href = beatUrl(beat);
      }
    });
  };

  /* --------------------------- Collections (tiles) -------------------------- */
  const NEW_DAYS = 30;
  // One line weight (1.8) and round joins for every collection icon, drawn
  // on the 24px grid so they stay crisp at 26px over the cover collage.
  const ICONS = {
    all: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',
    saved: '<path d="M12 18.7s-7-4.3-7-9.4A3.9 3.9 0 0 1 12 6.8a3.9 3.9 0 0 1 7 2.5c0 5.1-7 9.4-7 9.4z"/>',
    new: '<path d="M12 3.8l2.1 6.1 6.1 2.1-6.1 2.1L12 20.2l-2.1-6.1L3.8 12l6.1-2.1z"/>',
    under30: '<path d="M4 12.2V5.5A1.5 1.5 0 0 1 5.5 4h6.7l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-6.1 6.1a1.5 1.5 0 0 1-2.1 0z"/><circle cx="8.5" cy="8.5" r="1.4"/>',
    stems: '<path d="M5.5 15.5v-7"/><path d="M9.8 19V5"/><path d="M14.2 16.5v-9"/><path d="M18.5 14v-4"/>',
    project: '<path d="M3.8 7.1A1.8 1.8 0 0 1 5.6 5.3h3.9l2 2h6.9a1.8 1.8 0 0 1 1.8 1.8v7.8a1.8 1.8 0 0 1-1.8 1.8H5.6a1.8 1.8 0 0 1-1.8-1.8z"/><path d="M8.5 13.1h7"/>',
    genre: '<path d="M9.8 17.2V6.4l9-2v10.6"/><circle cx="7.5" cy="17.2" r="2.3"/><circle cx="16.5" cy="15" r="2.3"/>',
  };
  const collections = () => {
    const base = [
      { id: 'all', label: 'All tracks', icon: 'all', test: () => true },
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
  const makeDropdown = ({ key, label, options, value, onChange, alwaysSet, custom }) => {
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
        ${custom ? `
        <form class="bt-dd-custom" role="group" aria-label="${esc(custom.title)}" novalidate>
          <span class="bt-dd-custom-title">${esc(custom.title)}</span>
          <div class="bt-dd-custom-row">
            <input type="number" inputmode="numeric" name="lo" min="${custom.min}" max="${custom.max}" placeholder="Min" aria-label="Minimum ${esc(label)}">
            <span class="bt-dd-custom-sep" aria-hidden="true">–</span>
            <input type="number" inputmode="numeric" name="hi" min="${custom.min}" max="${custom.max}" placeholder="Max" aria-label="Maximum ${esc(label)}">
            <button type="submit" class="bt-dd-custom-go">Apply</button>
          </div>
        </form>` : ''}
      </div>`;
    const btn = $('.bt-dd-btn', wrap);
    const panel = $('.bt-dd-panel', wrap);
    const glide = $('.bt-dd-glide', wrap);
    const opts = $$('.bt-dd-opt', wrap);
    let current = value;
    let active = -1;

    const paintValue = () => {
      const o = options.find((x) => x.value === current);
      $('.bt-dd-value', wrap).textContent = o ? (o.short || o.label) : custom.format(current);
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
      if (form) {
        const isCustom = !options.some((x) => x.value === current);
        const [lo, hi] = isCustom ? current.split('-') : ['', ''];
        form.lo.value = lo && lo !== String(custom.min) ? lo : '';
        form.hi.value = hi && hi !== String(custom.max) ? hi : '';
      }
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

    // Typed range: either end may be left empty; numbers are clamped and
    // swapped if given the wrong way round.
    const form = $('.bt-dd-custom', wrap);
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const num = (v) => (v.trim() === '' ? null : Math.round(Math.min(custom.max, Math.max(custom.min, Number(v)))));
        let lo = num(form.lo.value);
        let hi = num(form.hi.value);
        if (lo == null && hi == null) { form.lo.focus(); return; }
        if (lo != null && hi != null && lo > hi) [lo, hi] = [hi, lo];
        const v = `${lo ?? custom.min}-${hi ?? custom.max}`;
        if (v !== current) { current = v; paintValue(); onChange(v); }
        close();
      });
    }

    btn.addEventListener('click', () => (wrap.classList.contains('is-open') ? close() : open()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
    panel.addEventListener('pointermove', (e) => {
      const el = e.target.closest('.bt-dd-opt');
      if (el) { const i = opts.indexOf(el); if (i !== active) setActive(i); }
    });
    panel.addEventListener('click', (e) => { const el = e.target.closest('.bt-dd-opt'); if (el) choose(opts.indexOf(el)); });
    panel.addEventListener('keydown', (e) => {
      if (form && form.contains(e.target)) { if (e.key === 'Escape') { e.preventDefault(); close(); } return; }
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
    col: 'all', q: '', genre: '', mood: '', bpm: '', key: '', added: '', sort: 'new',
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
  // Upload date windows, in days.
  const ADDED_RANGES = [
    { value: '', label: 'Any time', short: 'Any' },
    { value: '3', label: 'Last 3 days', short: '3 days' },
    { value: '7', label: 'Last week', short: '1 week' },
    { value: '14', label: 'Last 2 weeks', short: '2 weeks' },
    { value: '30', label: 'Last month', short: '1 month' },
    { value: '90', label: 'Last 3 months', short: '3 months' },
    { value: '365', label: 'Last year', short: '1 year' },
  ];
  const addedWithin = (b, days) => (Date.now() - new Date(b.released).getTime()) / 864e5 <= Number(days);
  const inBpm = (b, range) => { const [lo, hi] = range.split('-').map(Number); return b.bpm >= lo && b.bpm <= hi; };

  const matches = (b, skip) => {
    const col = COLLECTIONS.find((c) => c.id === state.col);
    if (col && !col.test(b)) return false;
    if (skip !== 'genre' && state.genre && b.genre !== state.genre) return false;
    if (skip !== 'mood' && state.mood && b.mood !== state.mood) return false;
    if (skip !== 'key' && state.key && b.key !== state.key) return false;
    if (skip !== 'bpm' && state.bpm && !inBpm(b, state.bpm)) return false;
    if (skip !== 'added' && state.added && !addedWithin(b, state.added)) return false;
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
  const isFiltered = () => state.col !== 'all' || state.q || state.genre || state.mood || state.bpm || state.key || state.added || state.tags.size;

  const paint = () => {
    grid.innerHTML = visible.map(cardHtml).join('');
    grid.dataset.view = state.view;
    $('#bt-empty').hidden = visible.length > 0;
    $('#bt-empty p').textContent = state.col === 'saved' && !saved.size
      ? 'No saved tracks yet. Tap the heart on any track to keep it here.'
      : 'No tracks match these filters.';
    $('#bt-count').textContent = `${visible.length} track${visible.length === 1 ? '' : 's'}`;
    $('#bt-reset').hidden = !isFiltered();
    syncCards();
    renderCart();
  };
  // Filters and sorting: cards that stay glide to their new slot (FLIP),
  // new ones fade in from 96%, so the change is easy to follow.
  const render = () => {
    visible = BEATS.filter((b) => matches(b)).sort(sorters[state.sort]);
    grid.removeAttribute('aria-busy');
    if (firstRender) { firstRender = false; paint(); enter(grid); return; }
    if (reduceMotion) { paint(); return; }
    const before = new Map($$('.bt-card', grid).map((c) => [c.dataset.id, c.getBoundingClientRect()]));
    paint();
    $$('.bt-card', grid).forEach((c, i) => {
      const from = before.get(c.dataset.id);
      if (from) {
        const to = c.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 380, easing: EASE_IN_OUT });
        }
      } else {
        c.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: Math.min(i, 8) * 30, easing: EASE_OUT, fill: 'backwards' });
      }
    });
  };

  const tileHtml = (c) => {
    const items = BEATS.filter(c.test);
    const empty = !items.length && c.id !== 'saved';
    return `
      <button type="button" class="bt-col${c.id === state.col ? ' is-active' : ''}" role="tab" aria-selected="${c.id === state.col}" data-col="${esc(c.id)}" ${empty ? 'disabled' : ''}>
        <span class="bt-col-disc">
          <span class="bt-col-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[c.icon]}</svg></span>
          <svg class="bt-col-ring" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true"><rect x="1" y="1" width="98" height="68" rx="18" ry="18" pathLength="100"/></svg>
        </span>
        <span class="bt-col-label">${esc(c.label)}</span>
        <span class="bt-col-count">${items.length} track${items.length === 1 ? '' : 's'}</span>
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
    add('bpm', 'BPM', BPM_RANGES.map((r, i) => (i ? { ...r, count: BEATS.filter((b) => inBpm(b, r.value)).length } : r)), {
      custom: {
        title: 'Type a range', min: 40, max: 250,
        format: (v) => {
          const [lo, hi] = v.split('-').map(Number);
          if (lo === hi) return String(lo);
          if (lo <= 40) return `≤ ${hi}`;
          if (hi >= 250) return `${lo}+`;
          return `${lo}–${hi}`;
        },
      },
    });
    add('key', 'Key', [{ value: '', label: 'Any key', short: 'Any' }, ...countOptions('key', uniq('key'))]);
    add('added', 'Added', ADDED_RANGES.map((r, i) => (i ? { ...r, count: BEATS.filter((b) => addedWithin(b, r.value)).length } : r)));
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
      Object.assign(state, { col: 'all', q: '', genre: '', mood: '', bpm: '', key: '', added: '' });
      state.tags.clear();
      $('#bt-q').value = '';
      ['genre', 'mood', 'bpm', 'key', 'added'].forEach((k) => dropdowns[k].reset());
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
    bindTilt(grid);
    setupFeatured();
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
          <span class="bt-tier-badge">${t.unlimited ? '∞ Unlimited' : 'Lease'}</span>
          <h3>${esc(t.unlimited ? t.name.replace(/\s*unlimited$/i, '') : t.name)}</h3>
          <p class="bt-tier-files">${esc(t.files.map((f) => LIC.fileLabels[f]).join(' · '))}</p>
          <dl class="bt-tier-terms">
            <div><dt>Streams</dt><dd>${esc(t.terms.streams)}</dd></div>
            <div><dt>Sales</dt><dd>${esc(t.terms.sales)}</dd></div>
            <div><dt>Music videos</dt><dd>${esc(t.terms.videos)}</dd></div>
            <div><dt>Radio</dt><dd>${esc(t.terms.radio)}</dd></div>
          </dl>
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
    // Your own track: "Message" becomes a link to your inbox (artists'
    // messages about it land there; you can't message yourself).
    const msgBtn = $('.bp-msg-btn', beatRoot);
    if (msgBtn && window.csMe && beat.producerHandle) {
      Promise.resolve(window.csMe).then((me) => {
        if (!me || !me.handle || me.handle.toLowerCase() !== beat.producerHandle.toLowerCase()) return;
        msgBtn.href = 'messages.html';
        msgBtn.title = 'Messages from artists about your tracks';
        $('span', msgBtn).textContent = 'Inbox';
      });
    }
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
      $('#bp-usage-title').innerHTML = `${esc(t.unlimited ? t.name.replace(/\s*unlimited$/i, '') : t.name)}${t.unlimited ? ' <span class="bt-tier-pill">Unlimited</span>' : ''}`;
      $('#bp-usage').innerHTML = usageRows(t).map(([icon, text]) => `<li><svg viewBox="0 0 24 24" aria-hidden="true">${USAGE_ICONS[icon]}</svg><span>${esc(text)}</span></li>`).join('');
      const c = cart.find((x) => x.id === beat.id);
      $('#bp-add').textContent = !canBuy ? SOON : c && c.tier === tier ? 'In cart' : (c ? 'Update cart' : 'Add to cart');
      $('#bp-add').disabled = !canBuy;
      $('#bp-buy').hidden = !canBuy;
    };
    $('#bp-tiers').addEventListener('change', (e) => { if (e.target.name === 'bp-tier') { tier = e.target.value; paintTier(); } });
    $('#bp-add').addEventListener('click', (e) => {
      if (!canBuy) return;
      const c = cart.find((x) => x.id === beat.id);
      if (c && c.tier === tier) { openCart(); return; }
      addToCart(beat.id, tier);
      track('Beat add to cart', { beat: beat.id, tier, from: 'beat-page' });
      paintTier();
      flyToCart(beat, $('.bp-cover', beatRoot).getBoundingClientRect());
      e.currentTarget.blur();
    });
    $('#bp-buy').addEventListener('click', () => {
      if (!canBuy) return;
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
    const related = similarTo(beat, 8, new Set(more.map((b) => b.id)));
    const free = $('#bp-free', beatRoot);
    if (free) free.addEventListener('click', () => freeDownload(beat, free));
    [['#bp-more', more], ['#bp-related', related]].forEach(([sel, list]) => {
      const box = $(sel);
      if (!box) return;
      const section = box.closest('section');
      if (!list.length) { section.hidden = true; return; }
      box.innerHTML = list.map(cardHtml).join('');
      bindCardClicks(box);
      bindTilt(box);
      enter(box);
    });
    syncCards();
  };

  /* -------------------------------- Featured ------------------------------- */
  // Spotlight on one beat with the other featured beats beside it to swap
  // in. Beats flagged "featured" in data/beats.json; newest beats otherwise.
  let featIndex = 0;
  const featuredList = () => {
    const f = BEATS.filter((b) => b.featured);
    return (f.length ? f : [...BEATS].sort(sorters.new)).slice(0, 3);
  };
  const spotHtml = (b, rank) => `
    <div class="bt-feat-spot ${tintClass(b)}" data-id="${esc(b.id)}"${b.cover ? ` style="--cover:url('${esc(new URL(b.cover, location.href).href)}')"` : ''}>
      <span class="bt-feat-ambient" aria-hidden="true"></span>
      <div class="bt-feat-art">
      <span class="bt-feat-vinyl" aria-hidden="true"><span class="bt-feat-disc"><span class="bt-feat-label"></span></span></span>
      <div class="bt-feat-cover">
        ${art(b)}
        <button type="button" class="bt-feat-play" data-feat-play aria-label="Play ${esc(b.title)}">
          <svg class="bt-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>
          <svg class="bt-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
        </button>
      </div>
      </div>
      <div class="bt-feat-info">
        <p class="bt-feat-kicker"><span class="bt-feat-rank-big">#${rank}</span><span class="bt-feat-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span></p>
        <h3 class="bt-feat-title"><a href="${beatUrl(b)}">${esc(b.title)}</a></h3>
        <p class="bt-feat-producer">${producerLine(b)}</p>
        <div class="bt-specs bt-feat-specs"><span class="bt-spec"><b>${b.bpm}</b><small>BPM</small></span><span class="bt-spec">${esc(b.key)}</span><span class="bt-spec bt-spec-genre">${esc(b.genre)}</span><span class="bt-spec">${esc(b.mood)}</span></div>
        <span class="bt-feat-open">Open track <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      </div>
    </div>`;
  const ARROW = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  // dir: 1 = next (comes in from the right), -1 = previous, 0 = no slide.
  const renderFeatured = (dir = 0) => {
    const box = $('#bt-featured');
    if (!box) return;
    const list = featuredList();
    if (!list.length) { box.hidden = true; return; }
    const b = list[featIndex];
    // The frame (header with this week's dates, light running round the
    // border, HUD corners, arrows, picks) is built once; only the spotlight swaps.
    if (!$('.bt-top-body', box)) {
      box.innerHTML = `
        <div class="bt-top-frame">
          <span class="bt-top-beam" aria-hidden="true"></span>
          <span class="bt-top-corner tl" aria-hidden="true"></span><span class="bt-top-corner tr" aria-hidden="true"></span>
          <span class="bt-top-corner bl" aria-hidden="true"></span><span class="bt-top-corner br" aria-hidden="true"></span>
          <header class="bt-top-head">
            <div class="bt-top-titles">
              <span class="bt-top-live"><span class="bt-feat-dot" aria-hidden="true"></span>This week</span>
              <h2 class="bt-top-title">Top tracks</h2>
            </div>
          </header>
          <div class="bt-top-body">
            <div class="bt-feat-stage">
              <div class="bt-feat-slot" aria-live="polite"></div>
              <button type="button" class="bt-feat-nav prev" data-feat-step="-1" aria-label="Previous track">${ARROW('M15 5l-7 7 7 7')}</button>
              <button type="button" class="bt-feat-nav next" data-feat-step="1" aria-label="Next track">${ARROW('M9 5l7 7-7 7')}</button>
              <div class="bt-feat-dots" aria-hidden="true">${list.map(() => '<span></span>').join('')}</div>
            </div>
            <div class="bt-feat-list" role="group" aria-label="Top tracks this week">
              <div class="bt-feat-list-head"><span>Chart</span><a href="#bt-grid">See all ›</a></div>${list.map((x, i) => `
              <button type="button" class="bt-feat-pick ${tintClass(x)}" data-feat-index="${i}" aria-label="Show ${esc(x.title)}">
                <span class="bt-feat-rank">${i + 1}</span>
                <span class="bt-feat-thumb">${art(x)}</span>
                <span class="bt-feat-pick-text"><b>${esc(x.title)}</b><small>${esc(x.producer)} · ${x.bpm} BPM</small></span>
              </button>`).join('')}
            </div>
          </div>
        </div>`;
    }
    $$('.bt-feat-pick', box).forEach((p, i) => { p.classList.toggle('is-active', i === featIndex); p.setAttribute('aria-pressed', String(i === featIndex)); });
    $$('.bt-feat-dots span', box).forEach((d, i) => d.classList.toggle('is-active', i === featIndex));
    const slot = $('.bt-feat-slot', box);
    const old = $('.bt-feat-spot', slot);
    const swap = () => {
      slot.innerHTML = spotHtml(b, featIndex + 1);
      syncCards();
      if (dir && !reduceMotion) {
        $('.bt-feat-spot', slot).animate([{ opacity: 0, transform: `translateX(${dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE_OUT });
      }
    };
    if (dir && old && !reduceMotion) {
      old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * -20}px)` }], { duration: 140, easing: EASE_OUT, fill: 'forwards' }).finished.then(swap, swap);
    } else swap();
  };
  const setupFeatured = () => {
    const box = $('#bt-featured');
    if (!box) return;
    const go = (i, dir) => {
      const n = featuredList().length;
      const next = (i + n) % n;
      if (next === featIndex) return;
      featIndex = next;
      renderFeatured(dir);
    };
    // Swipe left/right on the spotlight (touch). A swipe swallows the click
    // that follows so it doesn't open the beat.
    let x0 = null; let y0 = 0; let swiped = false;
    box.addEventListener('touchstart', (e) => {
      if (!e.target.closest('.bt-feat-stage')) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; swiped = false;
    }, { passive: true });
    box.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        swiped = true;
        setTimeout(() => { swiped = false; }, 400);
        go(featIndex + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      }
    }, { passive: true });
    box.addEventListener('click', (e) => {
      if (swiped) { swiped = false; e.preventDefault(); return; }
      const step = e.target.closest('[data-feat-step]');
      if (step) { const d = Number(step.dataset.featStep); go(featIndex + d, d); return; }
      const pick = e.target.closest('[data-feat-index]');
      if (pick) { const i = Number(pick.dataset.featIndex); go(i, i > featIndex ? 1 : -1); return; }
      const spot = e.target.closest('.bt-feat-spot');
      if (!spot) return;
      const beat = byId.get(spot.dataset.id);
      if (e.target.closest('[data-feat-play]')) { togglePlay(beat.id); return; }
      // The whole spotlight opens the beat page (no cart from here).
      if (!e.target.closest('a')) location.href = beatUrl(beat);
    });
    renderFeatured(0);
  };

  /* ---------------------------------- Tilt --------------------------------- */
  // Small pointer tilt (max 4deg) and a glare dot on card covers. Fine
  // pointers only; one delegated listener per container.
  const bindTilt = (container) => {
    if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let current = null;
    let frame = 0;
    let last = null;
    const reset = (card) => { if (!card) return; card.classList.remove('is-tilting'); card.style.removeProperty('--rx'); card.style.removeProperty('--ry'); };
    const apply = () => {
      frame = 0;
      if (!current || !last) return;
      const r = current.getBoundingClientRect();
      const x = (last.clientX - r.left) / r.width;
      const y = (last.clientY - r.top) / r.height;
      current.style.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
      current.style.setProperty('--rx', `${((0.5 - y) * 8.4).toFixed(2)}deg`);
      const cover = $('.bt-cover-wrap', current);
      if (cover) {
        const c = cover.getBoundingClientRect();
        cover.style.setProperty('--gx', `${(last.clientX - c.left).toFixed(0)}px`);
        cover.style.setProperty('--gy', `${(last.clientY - c.top).toFixed(0)}px`);
      }
    };
    container.addEventListener('pointermove', (e) => {
      const card = e.target.closest('.bt-card:not(.bt-card-skel)');
      if (card !== current) { reset(current); current = card; if (card) card.classList.add('is-tilting'); }
      last = e;
      if (current && !frame) frame = requestAnimationFrame(apply);
    });
    container.addEventListener('pointerleave', () => { reset(current); current = null; });
  };

  /* --------------------------------- Player -------------------------------- */
  const player = $('#bt-player');
  const audio = new Audio();
  audio.preload = 'none';
  // Producer previews come from Dropbox (another origin). Asking for CORS lets
  // the visualizer read them; if that is refused the preview reloads without
  // it and plays with the visualizer off (noViz), never silent.
  audio.crossOrigin = 'anonymous';
  let noViz = false;
  let currentId = null;
  let actx = null;
  let analyser = null;
  let freq = null;
  let wave = null;
  let raf = 0;
  const bands = new Array(44).fill(0);
  const kick = { v: 0, prev: 0, avg: 0, last: 0 };
  const vizCanvas = $('#bt-player-viz');
  const vg = vizCanvas.getContext('2d');

  const queue = () => (catalogueRoot ? (visible.length ? visible : BEATS) : savedRoot ? savedList() : BEATS);

  let shownId = null;
  const showPlayer = (beat) => {
    const changing = shownId && shownId !== beat.id && player.classList.contains('is-visible') && !reduceMotion;
    shownId = beat.id;
    if (changing) {
      // Old track slides up and out, new one rises in.
      const left = $('.bt-player-left', player);
      left.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 130, easing: EASE_OUT })
        .finished.then(() => {
          fillPlayer(beat);
          left.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: EASE_OUT });
        }, () => fillPlayer(beat));
    } else fillPlayer(beat);
    if (player.hidden) {
      player.hidden = false;
      document.body.classList.add('bt-has-player');
      requestAnimationFrame(() => {
        document.documentElement.style.setProperty('--bt-player-h', `${player.offsetHeight}px`);
        requestAnimationFrame(() => player.classList.add('is-visible'));
      });
    }
  };
  const fillPlayer = (beat) => {
    player.className = `bt-player ${tintClass(beat)}${audio.paused ? '' : ' is-playing'}${player.classList.contains('is-visible') ? ' is-visible' : ''}`;
    $('#bt-player-cover').innerHTML = art(beat);
    $('#bt-player-title').textContent = beat.title;
    $('#bt-player-title').href = beatUrl(beat);
    $('#bt-player-producer').innerHTML = producerLine(beat);
    $('#bt-player-buy').innerHTML = `<span>Buy</span><strong>${euro(minPrice(beat))}</strong>`;
    $('#bt-player-buy').setAttribute('aria-label', `Buy ${beat.title}, from ${euro(minPrice(beat))}`);
    if (window.__csTools) window.__csTools.onTrack(beat);
    showWave(beat);
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
    $$('.bt-feat-spot').forEach((spot) => {
      const playing = spot.dataset.id === currentId && !audio.paused;
      spot.classList.toggle('is-playing', playing);
      const btn = $('[data-feat-play]', spot);
      if (btn) btn.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${byId.get(spot.dataset.id).title}`);
    });
    if (beatRoot) {
      const playing = beatRoot.dataset.beatId === currentId && !audio.paused;
      beatRoot.classList.toggle('is-playing', playing);
      $$('[data-play-beat]', beatRoot).forEach((b) => b.setAttribute('aria-label', playing ? 'Pause preview' : 'Play preview'));
    }
    player.classList.toggle('is-playing', !audio.paused);
    $('#bt-play').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  };

  // Audio graph: element -> [key shifter] -> [analyser] -> speakers. Built
  // on first play (needs the CORS preview; without it the element plays
  // directly and the visualizer and key change are off).
  let srcNode = null;
  let shifter = null;
  const graphOut = () => analyser || (actx && actx.destination);
  const ensureGraph = () => {
    if (srcNode) return true;
    if (noViz || !(window.AudioContext || window.webkitAudioContext)) return false;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      srcNode = actx.createMediaElementSource(audio);
      if (!reduceMotion) {
        analyser = actx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;
        analyser.connect(actx.destination);
        freq = new Uint8Array(analyser.frequencyBinCount);
        wave = new Uint8Array(analyser.fftSize);
      }
      srcNode.connect(graphOut());
      return true;
    } catch (e) { analyser = null; srcNode = null; return false; }
  };
  const ensureAnalyser = async () => { if (!reduceMotion) ensureGraph(); };

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
  audio.addEventListener('error', () => {
    const beat = byId.get(currentId);
    if (!beat || beat.source !== 'producer' || !audio.crossOrigin || srcNode) return;
    noViz = true;
    audio.removeAttribute('crossorigin');
    audio.src = beat.preview;
    audio.play().catch(() => syncCards());
  });
  const togglePlay = (id) => { if (id === currentId && !audio.paused) audio.pause(); else play(id); };
  const step = (dir) => {
    const list = queue();
    const i = list.findIndex((b) => b.id === currentId);
    const next = list[(i + dir + list.length) % list.length];
    if (next) play(next.id);
  };

  const rgbOf = (el) => (getComputedStyle(el).getPropertyValue('--fx') || '232,134,44').trim();
  /* ----------------------------- Similar tracks ----------------------------- */
  // Same genre and mood weigh most, then key, shared tags and a close tempo.
  const keyRoot = (k) => String(k || '').trim().split(/\s+/)[0];
  const simScore = (a, b) => (a.genre && a.genre === b.genre ? 3 : 0) + (a.mood && a.mood === b.mood ? 2 : 0)
    + (a.key && a.key === b.key ? 2 : keyRoot(a.key) && keyRoot(a.key) === keyRoot(b.key) ? 1 : 0)
    + (a.tags || []).filter((t) => (b.tags || []).includes(t)).length
    + Math.max(0, 2 - Math.abs((a.bpm || 0) - (b.bpm || 0)) / 8);
  const similarTo = (beat, n = 8, skip = new Set()) => BEATS.filter((b) => b.id !== beat.id && !skip.has(b.id))
    .map((b) => ({ b, s: simScore(beat, b) })).sort((x, y) => y.s - x.s).slice(0, n).map((x) => x.b);
  const heard = new Set();
  const playSimilar = () => {
    const cur = byId.get(currentId);
    if (!cur) { step(1); return; }
    heard.add(cur.id);
    let next = similarTo(cur, 1, heard)[0];
    if (!next) { heard.clear(); heard.add(cur.id); next = similarTo(cur, 1, heard)[0]; }
    if (next) play(next.id); else { audio.currentTime = 0; syncCards(); }
  };

  /* ----------------------------- Free download ----------------------------- */
  // Producers can allow a free download of the tagged MP3 (upload page). It
  // needs an account: the file comes from /api/beats/free, saved as a file.
  // Before a free download: the demo terms, accepted with a checkbox. The
  // file is for private testing only; any other use needs a license.
  const FREE_TERMS_VERSION = 'demo-1';
  let termsDialog = null;
  const askFreeTerms = (beat) => new Promise((resolve) => {
    if (!termsDialog) {
      termsDialog = document.createElement('dialog');
      termsDialog.className = 'bt-terms';
      document.body.appendChild(termsDialog);
    }
    const d = termsDialog;
    d.innerHTML = `
      <form method="dialog" class="bt-terms-inner">
        <div class="bt-terms-head">
          <span class="bt-terms-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg></span>
          <div><b>Free download terms</b><small>${esc(beat.title)} by ${esc(beat.producer)} · tagged MP3</small></div>
        </div>
        <div class="bt-terms-body">
          <p>This free version is for <b>private testing only</b>: to try ideas, write and record demos for yourself.</p>
          <ul>
            <li>You may <b>not</b> release, publish or distribute it, or any song made with it, in any form: streaming services, stores, YouTube, social media, radio, live shows, mixtapes, ads or any other use, paid or free.</li>
            <li>You may <b>not</b> sell, share, upload or give the file to anyone, remove or cover the voice tag, edit it into another beat, or use it to train AI models.</li>
            <li>${esc(beat.producer)} keeps all rights and the copyright. No license of any kind is granted by this download.</li>
            <li>To use the beat in any way beyond private testing you must first buy a license on Creative Sound.</li>
            <li>Any other use is copyright infringement: the track can be removed and the producer may take legal action. Your download is recorded with your account.</li>
          </ul>
        </div>
        <label class="bt-terms-check"><input type="checkbox" name="ok"><span class="bt-terms-box" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.2 8.4l3 3 6.6-7"/></svg></span><span>I have read and accept these terms. I will use this file for private testing only.</span></label>
        <div class="bt-terms-actions">
          <button type="button" class="btn btn-ghost" data-terms="cancel">Cancel</button>
          <button type="button" class="btn btn-primary" data-terms="ok" disabled>Accept and download</button>
        </div>
      </form>`;
    const ok = $('[data-terms="ok"]', d);
    const box = $('input[name="ok"]', d);
    box.addEventListener('change', () => { ok.disabled = !box.checked; });
    let done = false;
    const finish = (v) => { if (done) return; done = true; if (d.open) d.close(); resolve(v); };
    ok.addEventListener('click', () => finish(box.checked));
    $('[data-terms="cancel"]', d).addEventListener('click', () => finish(false));
    d.addEventListener('close', () => finish(false), { once: true });
    d.addEventListener('click', (e) => { if (e.target === d) finish(false); });
    d.showModal();
  });

  const freeDownload = async (beat, btn) => {
    const label = btn && (btn.querySelector('span') || btn);
    const say = (t) => { if (label) label.textContent = t; };
    const me = await Promise.resolve(window.csMe).catch(() => null);
    if (!me || !me.email) { location.href = `login.html`; return; }
    if (!(await askFreeTerms(beat))) return;
    if (btn) btn.disabled = true;
    say('Preparing…');
    try {
      const r = await fetch(`/api/beats/free?id=${encodeURIComponent(beat.id)}&accept=${FREE_TERMS_VERSION}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not download.');
      const blob = await fetch(d.url).then((x) => { if (!x.ok) throw new Error('Could not download.'); return x.blob(); });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = d.name || `${beat.title}.mp3`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      say('Downloaded');
      track('Free download', { beat: beat.id });
    } catch (err) {
      say(err.message || 'Could not download.');
    } finally {
      if (btn) setTimeout(() => { btn.disabled = false; say(btn.classList.contains('bp-free') ? 'Free download' : 'Free download (tagged MP3)'); }, 2500);
    }
  };

  /* -------------------------------- Waveform -------------------------------- */
  // The seek bar becomes the track's waveform: mirrored rounded bars, the
  // played part in the track colour, a lighter wash up to the pointer with
  // the time above it, and the bars round the playhead lifting on each kick.
  // Peaks come with the catalogue; the first browser to play a track without
  // them computes them from the preview and stores them for everyone.
  const peaksCache = new Map();
  const loadPeaks = async (beat) => {
    if (peaksCache.has(beat.id)) return peaksCache.get(beat.id);
    if (Array.isArray(beat.peaks) && beat.peaks.length) { peaksCache.set(beat.id, beat.peaks); return beat.peaks; }
    const job = (async () => {
      const buf = await fetch(beat.preview).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()));
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const decoded = await new Promise((res, rej) => { const p = new OAC(1, 44100, 44100).decodeAudioData(buf, res, rej); if (p && p.then) p.then(res, rej); });
      const data = decoded.getChannelData(0);
      const N = 200;
      const size = Math.floor(data.length / N);
      const raw = [];
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let j = i * size; j < (i + 1) * size; j += 16) sum += data[j] * data[j];
        raw.push(Math.sqrt(sum / (size / 16)));
      }
      const max = Math.max(...raw) || 1;
      const peaks = raw.map((v) => Math.round(Math.pow(v / max, 0.75) * 100));
      if (beat.source === 'producer') {
        fetch('/api/beats/peaks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: beat.id, peaks }) }).catch(() => {});
      }
      beat.peaks = peaks;
      return peaks;
    })().catch(() => null);
    peaksCache.set(beat.id, job);
    const out = await job;
    peaksCache.set(beat.id, out);
    return out;
  };
  const wv = { canvas: null, ctx: null, tip: null, peaks: null, id: null, born: 0, hover: -1, edge: null, edgeDrag: null };
  const setupWave = () => {
    const wrap = $('.bt-player-barwrap', player);
    if (!wrap || wv.canvas) return;
    wv.canvas = document.createElement('canvas');
    wv.canvas.className = 'bt-wave';
    wv.canvas.setAttribute('aria-hidden', 'true');
    wv.tip = document.createElement('span');
    wv.tip.className = 'bt-wave-tip';
    wv.tip.hidden = true;
    wrap.append(wv.canvas, wv.tip);
    wv.ctx = wv.canvas.getContext('2d');
    const bar = $('#bt-player-bar');
    bar.addEventListener('pointermove', (e) => {
      if (!wv.peaks || wv.edgeDrag) return;
      const r = bar.getBoundingClientRect();
      wv.hover = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      wv.tip.hidden = !audio.duration;
      wv.tip.textContent = fmtTime(wv.hover * (audio.duration || 0));
      wv.tip.style.left = `${wv.hover * 100}%`;
      drawWave();
    });
    bar.addEventListener('pointerleave', () => { wv.hover = -1; wv.tip.hidden = true; drawWave(); });
    window.addEventListener('resize', () => drawWave());
  };
  const showWave = async (beat) => {
    if (!wv.canvas) return;
    // Same track again (replay, player refresh): keep the waveform on.
    if (wv.id === beat.id) { if (wv.peaks) { player.classList.add('has-wave'); drawWave(); } return; }
    wv.id = beat.id;
    wv.peaks = null;
    player.classList.remove('has-wave');
    drawWave();
    const peaks = await loadPeaks(beat);
    if (!peaks || wv.id !== beat.id) return;
    wv.peaks = peaks;
    wv.born = performance.now();
    player.classList.add('has-wave');
    const grow = () => { drawWave(); if (performance.now() - wv.born < 900) requestAnimationFrame(grow); };
    requestAnimationFrame(grow);
  };
  // Loop: off, the whole track, or a section [a, b] in seconds.
  const loop = { mode: 'off', a: 0, b: 0, bars: 0 };
  const fmtTenths = (t) => { const m = Math.floor(t / 60); const sec = t - m * 60; return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(1)}`; };
  const drawWave = () => {
    const c = wv.canvas;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = wv.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!wv.peaks) return;
    const gap = 4;
    const bw = 2.4;
    const n = Math.max(20, Math.floor(w / gap));
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    const rgb = rgbOf(player);
    const age = reduceMotion ? 1 : Math.min(1, (performance.now() - wv.born) / 700);
    const hot = !audio.paused ? kick.v : 0;
    const played = g.createLinearGradient(0, 0, w, 0);
    played.addColorStop(0, `rgba(${rgb}, 0.75)`);
    played.addColorStop(1, `rgb(${rgb})`);
    const sec = loop.mode === 'section' && audio.duration && loop.b > loop.a;
    const la = sec ? loop.a / audio.duration : -1;
    const lb = sec ? loop.b / audio.duration : -1;
    if (sec) {
      const xa = la * w; const xb = lb * w;
      g.fillStyle = `rgba(${rgb}, 0.14)`;
      if (g.roundRect) { g.beginPath(); g.roundRect(xa, 0, Math.max(2, xb - xa), h, 6); g.fill(); } else g.fillRect(xa, 0, xb - xa, h);
      g.fillStyle = `rgb(${rgb})`;
      g.fillRect(xa - 1, 0, 2, h);
      g.fillRect(xb - 1, 0, 2, h);
      [['a', xa], ['b', xb]].forEach(([edge, x]) => {
        const on = wv.edge === edge || wv.edgeDrag === edge;
        const gw = on ? 10 : 8;
        const gh = on ? Math.min(h, 26) : Math.min(h - 6, 18);
        g.save();
        g.shadowColor = `rgba(${rgb}, 0.9)`;
        g.shadowBlur = on ? 12 : 6;
        g.fillStyle = '#fff';
        if (g.roundRect) { g.beginPath(); g.roundRect(x - gw / 2, (h - gh) / 2, gw, gh, gw / 2); g.fill(); } else g.fillRect(x - gw / 2, (h - gh) / 2, gw, gh);
        g.restore();
        g.fillStyle = `rgb(${rgb})`;
        g.fillRect(x - 1, (h - gh) / 2 + 4, 2, gh - 8);
      });
    }
    for (let i = 0; i < n; i++) {
      const x = i * gap + (gap - bw) / 2;
      const t = i / (n - 1);
      const src = wv.peaks[Math.min(wv.peaks.length - 1, Math.floor(t * wv.peaks.length))] / 100;
      // grow in from the centre line, bars a little staggered
      const k = reduceMotion ? 1 : Math.max(0, Math.min(1, age * 1.6 - t * 0.6));
      const near = Math.abs(t - p) < 0.03 ? 1 + hot * 0.35 : 1;
      const bh = Math.max(2, src * (h - 4) * (1 - Math.pow(1 - k, 3)) * near);
      const y = (h - bh) / 2;
      if (t <= p) g.fillStyle = played;
      else if (wv.hover >= 0 && t <= wv.hover) g.fillStyle = `rgba(${rgb}, 0.38)`;
      else g.fillStyle = sec && t >= la && t <= lb ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.2)';
      if (g.roundRect) { g.beginPath(); g.roundRect(x, y, bw, bh, bw / 2); g.fill(); } else g.fillRect(x, y, bw, bh);
    }
  };

  const updateProgress = () => {
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    $('#bt-player-fill').style.transform = `scaleX(${p.toFixed(4)})`;
    $('#bt-player-bar').style.setProperty('--p', p.toFixed(4));
    $('#bt-player-bar').setAttribute('aria-valuenow', String(Math.round(p * 100)));
    $('#bt-time').textContent = fmtTime(audio.currentTime);
    $('#bt-dur').textContent = fmtTime(audio.duration);
    // Track page: the ring round the cover play button fills with the preview.
    if (beatRoot) { const ring = $('.bp-cover-play', beatRoot); if (ring) ring.style.setProperty('--p', beatRoot.dataset.beatId === currentId ? p.toFixed(4) : 0); }
    if (wv.peaks) drawWave();
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
      let low = 0;
      if (live) {
        const binHz = actx.sampleRate / (freq.length * 2);
        const a = Math.max(1, Math.floor(40 / binHz));
        const b2 = Math.max(a + 1, Math.ceil(160 / binHz));
        for (let j = a; j < b2; j++) low += freq[j];
        low /= (b2 - a) * 255;
      }
      const now = performance.now();
      const rise = low - kick.prev;
      kick.prev = low;
      kick.avg += (low - kick.avg) * 0.08;
      if (live && low > 0.35 && rise > 0.035 && low > kick.avg * 1.06 && now - kick.last > 160) { kick.last = now; kick.v = 1; }
      else kick.v *= 0.92; // ~140ms half-life: visible, still tight to the beat
      const kickVal = kick.v.toFixed(3);
      $$('.bt-card.is-playing .bt-cover-wrap, .bt-feat-spot.is-playing .bt-feat-cover, .beat-page.is-playing .bp-cover').forEach((el) => el.style.setProperty('--kick', kickVal));
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
  // At the end of a preview, keep the vibe: the most similar track not
  // played yet in this visit (genre, mood, key, tags, tempo).
  audio.addEventListener('ended', () => {
    if (loop.mode === 'section') { audio.currentTime = loop.a; audio.play().catch(() => {}); return; }
    playSimilar();
  });
  // Section loop: jump back to A the moment B is reached (checked every frame,
  // timeupdate alone is too coarse for a tight loop).
  let loopRaf = 0;
  const loopTick = () => {
    loopRaf = 0;
    if (loop.mode !== 'section' || audio.paused) return;
    if (audio.currentTime >= loop.b - 0.02 || audio.currentTime < loop.a - 0.25) audio.currentTime = loop.a;
    loopRaf = requestAnimationFrame(loopTick);
  };
  const startLoopTick = () => { if (!loopRaf && loop.mode === 'section' && !audio.paused) loopRaf = requestAnimationFrame(loopTick); };
  audio.addEventListener('play', startLoopTick);

  /* ------------------------------ Player tools ------------------------------ */
  // Edit (tempo and key of the preview, for trying a beat at your speed and
  // in your range), Loop, Lyrics (a notepad per track, kept on this device),
  // Volume and More. Tempo uses the element's playbackRate with pitch kept;
  // key runs through a small pitch shifter in an AudioWorklet, so both can
  // change independently. Both reset when another track starts.
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  const transposeKey = (key, semi) => {
    const m = /^([A-G](?:#|b)?)\s*(.*)$/.exec(String(key || '').trim());
    if (!m) return key;
    const root = FLAT[m[1]] || m[1];
    const i = NOTE_NAMES.indexOf(root);
    if (i < 0) return key;
    return `${NOTE_NAMES[(i + semi + 120) % 12]}${m[2] ? ` ${m[2]}` : ''}`;
  };
  // Pitch shifter: two read heads sweep a short delay line half a window
  // apart, cross-faded with a Hann window (the classic "delay-line" shifter).
  const SHIFTER = `class CsShift extends AudioWorkletProcessor {
    constructor() { super(); this.ratio = 1; this.size = 1 << 16; this.buf = [new Float32Array(this.size), new Float32Array(this.size)]; this.w = 0; this.phase = 0; this.win = Math.round(sampleRate * 0.08);
      this.port.onmessage = (e) => { this.ratio = e.data; }; }
    read(b, pos) { const s = this.size; const i = Math.floor(pos); const f = pos - i; const a = b[(i % s + s) % s]; const c = b[((i + 1) % s + s) % s]; return a + (c - a) * f; }
    process(inputs, outputs) {
      const inp = inputs[0]; const out = outputs[0]; if (!out.length) return true;
      const n = out[0].length; const W = this.win; const step = (1 - this.ratio) / W;
      for (let k = 0; k < n; k++) {
        for (let ch = 0; ch < out.length; ch++) { const src = inp[ch] || inp[0]; this.buf[ch % 2][(this.w + k) % this.size] = src ? src[k] : 0; }
        let p1 = this.phase; let p2 = (p1 + 0.5) % 1;
        const g1 = Math.sin(Math.PI * p1) ** 2; const g2 = Math.sin(Math.PI * p2) ** 2;
        const pos = this.w + k;
        for (let ch = 0; ch < out.length; ch++) {
          const b = this.buf[ch % 2];
          out[ch][k] = this.ratio === 1 ? b[pos % this.size] : this.read(b, pos - (p1 * W + 2)) * g1 + this.read(b, pos - (p2 * W + 2)) * g2;
        }
        this.phase = ((this.phase + step) % 1 + 1) % 1;
      }
      this.w = (this.w + n) % this.size;
      return true;
    }
  }
  registerProcessor('cs-shift', CsShift);`;
  let shifterReady = null;
  const setKeyShift = async (semi) => {
    if (!semi && !shifter) return true;
    if (!ensureGraph() || !actx.audioWorklet) return false;
    try {
      if (!shifterReady) shifterReady = actx.audioWorklet.addModule(URL.createObjectURL(new Blob([SHIFTER], { type: 'application/javascript' })));
      await shifterReady;
      if (!shifter) {
        shifter = new AudioWorkletNode(actx, 'cs-shift', { outputChannelCount: [2] });
        srcNode.disconnect();
        srcNode.connect(shifter);
        shifter.connect(graphOut());
      }
      shifter.port.postMessage(2 ** (semi / 12));
      return true;
    } catch (e) { return false; }
  };

  const fx = { tempo: 1, semi: 0 };
  const setupPlayerTools = () => {
    const right = $('.bt-player-right', player);
    if (!right || $('.bt-tools', player)) return;
    const ICON = {
      edit: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
      loop: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
      lyrics: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
      vol: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
      mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
      more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    };
    const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
    const tools = document.createElement('div');
    tools.className = 'bt-tools';
    tools.innerHTML = `
      <button type="button" class="bt-tool" data-tool="edit" aria-haspopup="dialog" aria-expanded="false">${ic('edit')}<span>Edit</span></button>
      <button type="button" class="bt-tool" data-tool="loop" aria-haspopup="dialog" aria-expanded="false">${ic('loop')}<span>Loop</span></button>
      <button type="button" class="bt-tool" data-tool="lyrics" aria-haspopup="dialog" aria-expanded="false">${ic('lyrics')}<span>Lyrics</span></button>
      <button type="button" class="bt-tool bt-tool-ic" data-tool="vol" aria-haspopup="dialog" aria-expanded="false" aria-label="Volume">${ic('vol')}</button>
      <button type="button" class="bt-tool bt-tool-ic" data-tool="more" aria-haspopup="menu" aria-expanded="false" aria-label="More">${ic('more')}</button>
      <div class="bt-pop" role="dialog" hidden></div>`;
    right.prepend(tools);
    const pop = $('.bt-pop', tools);
    let openTool = null;
    const closePop = () => {
      if (!openTool) return;
      $(`[data-tool="${openTool}"]`, tools).setAttribute('aria-expanded', 'false');
      openTool = null;
      pop.classList.remove('is-open');
      setTimeout(() => { if (!openTool) pop.hidden = true; }, 180);
    };
    const beat = () => byId.get(currentId);
    const paintEdit = () => {
      const b = beat();
      if (!b) return;
      const bpm = Math.round(b.bpm * fx.tempo);
      $('#bt-fx-bpm', pop).textContent = `${bpm} BPM`;
      $('#bt-fx-bpm-was', pop).textContent = fx.tempo === 1 ? 'Original' : `was ${b.bpm}`;
      $('#bt-fx-key', pop).textContent = transposeKey(b.key, fx.semi);
      $('#bt-fx-key-was', pop).textContent = fx.semi ? `${fx.semi > 0 ? '+' : ''}${fx.semi} st · was ${b.key}` : 'Original';
      const tr = $('#bt-fx-tempo', pop);
      tr.value = String(bpm);
      tr.style.setProperty('--p', `${((bpm - Number(tr.min)) / (Number(tr.max) - Number(tr.min))) * 100}%`);
      $('.bt-tool[data-tool="edit"]', tools).classList.toggle('is-on', fx.tempo !== 1 || fx.semi !== 0);
    };
    const applyTempo = () => { audio.preservesPitch = true; audio.mozPreservesPitch = true; audio.webkitPreservesPitch = true; audio.playbackRate = fx.tempo; };
    const panels = {
      edit: () => {
        const b = beat();
        pop.innerHTML = `
          <div class="bt-pop-head"><b>Edit preview</b><button type="button" class="bt-pop-reset" data-fx-reset>Reset</button></div>
          <div class="bt-fx">
            <div class="bt-fx-row"><span class="bt-fx-label">Tempo</span><span class="bt-fx-val"><b id="bt-fx-bpm"></b><small id="bt-fx-bpm-was"></small></span></div>
            <input type="range" id="bt-fx-tempo" class="bt-fx-range" min="${Math.max(20, b.bpm - 100)}" max="${b.bpm + 100}" step="1" aria-label="Tempo in BPM">
          </div>
          <div class="bt-fx">
            <div class="bt-fx-row"><span class="bt-fx-label">Key</span><span class="bt-fx-val"><b id="bt-fx-key"></b><small id="bt-fx-key-was"></small></span></div>
            <div class="bt-fx-steps"><button type="button" data-semi="-1" aria-label="Key down a semitone">−</button><span class="bt-fx-meter">${Array.from({ length: 25 }, (_, i) => `<i data-k="${i - 12}" role="button" tabindex="-1" title="${i - 12 > 0 ? '+' : ''}${i - 12} st"></i>`).join('')}</span><button type="button" data-semi="1" aria-label="Key up a semitone">+</button></div>
          </div>
          <p class="bt-pop-note" hidden></p>`;
        paintEdit();
        paintMeter();
      },
      loop: () => {
        const b = beat();
        const bar = 240 / (b.bpm || 120);
        pop.innerHTML = `
          <div class="bt-pop-head"><b>Loop</b>${loop.mode !== 'off' ? '<button type="button" class="bt-pop-reset" data-loop-mode="off">Turn off</button>' : ''}</div>
          <div class="bt-seg" role="radiogroup" aria-label="Loop">
            ${[['off', 'Off'], ['track', 'Whole track'], ['section', 'Section']].map(([m, l]) => `<button type="button" role="radio" aria-checked="${loop.mode === m}" data-loop-mode="${m}"${loop.mode === m ? ' class="is-on"' : ''}>${l}</button>`).join('')}
          </div>
          <div class="bt-loop-sec"${loop.mode === 'section' ? '' : ' hidden'}>
            <div class="bt-fx-row"><span class="bt-fx-label">Loop from here</span><span class="bt-fx-val"><small>${b.bpm} BPM · 1 bar = ${bar.toFixed(2)}s</small></span></div>
            <div class="bt-loop-bars" role="radiogroup" aria-label="Loop length" style="--i:${Math.max(0, LOOP_BARS.indexOf(loop.bars))}"${LOOP_BARS.includes(loop.bars) ? ' data-set' : ''}><span class="bt-loop-thumb" aria-hidden="true"></span>${LOOP_BARS.map((n) => `<button type="button" role="radio" aria-checked="${loop.bars === n}" data-loop-bars="${n}">${n} ${n === 1 ? 'bar' : 'bars'}</button>`).join('')}</div>
            <div class="bt-loop-ab">
              <button type="button" data-loop-set="a"><small>Start</small><b id="bt-loop-a">${fmtFine(loop.a)}</b></button>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              <button type="button" data-loop-set="b"><small>End</small><b id="bt-loop-b">${fmtFine(loop.b)}</b></button>
            </div>
          </div>`;
      },
      lyrics: () => {
        const b = beat();
        const k = `cs-lyrics-${b.id}`;
        let text = '';
        try { text = localStorage.getItem(k) || ''; } catch (e) {}
        pop.innerHTML = `
          <div class="bt-pop-head"><b>Lyrics · ${esc(b.title)}</b><button type="button" class="bt-pop-reset" data-copy>Copy</button></div>
          <textarea class="bt-lyrics" placeholder="Write your verse while the beat plays…" aria-label="Lyrics for ${esc(b.title)}">${esc(text)}</textarea>
          <p class="bt-pop-note" id="bt-lyrics-note">Saved on this device. <a href="login.html">Sign in</a> to keep your lyrics on every device.</p>`;
        const ta = $('.bt-lyrics', pop);
        const note = $('#bt-lyrics-note', pop);
        // Signed in: lyrics live on the account (synced, debounced); this
        // device keeps a copy too, so nothing is lost offline.
        let online = false;
        let timer = 0;
        Promise.resolve(window.csMe).then((me) => {
          if (!me || !me.email) return;
          online = true;
          note.textContent = 'Saved to your account.';
          return fetch(`/api/beats/lyrics?id=${encodeURIComponent(b.id)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
            if (!d) return;
            if (d.text && d.text !== ta.value && ta.isConnected && document.activeElement !== ta) ta.value = d.text;
            else if (!d.text && ta.value) fetch('/api/beats/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, text: ta.value }) }).catch(() => {});
          });
        }).catch(() => {});
        ta.addEventListener('input', () => {
          try { localStorage.setItem(k, ta.value); } catch (e) {}
          if (!online) return;
          note.textContent = 'Saving…';
          clearTimeout(timer);
          timer = setTimeout(() => {
            fetch('/api/beats/lyrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, text: ta.value }) })
              .then((r) => { note.textContent = r.ok ? 'Saved to your account.' : 'Saved on this device.'; })
              .catch(() => { note.textContent = 'Saved on this device.'; });
          }, 700);
        });
        setTimeout(() => ta.focus(), 60);
      },
      vol: () => {
        pop.innerHTML = `
          <div class="bt-vol"><button type="button" class="bt-vol-mute" aria-label="Mute">${ic(audio.muted || audio.volume === 0 ? 'mute' : 'vol')}</button>
          <input type="range" class="bt-fx-range" id="bt-vol" min="0" max="100" step="1" value="${Math.round(audio.volume * 100)}" aria-label="Volume" style="--p:${audio.muted ? 0 : Math.round(audio.volume * 100)}%"></div>`;
      },
      more: () => {
        const b = beat();
        pop.innerHTML = `
          <div class="bt-more" role="menu">
            <a role="menuitem" href="${beatUrl(b)}">Open track page</a>
            <button type="button" role="menuitem" data-more="share">Copy link</button>
            <button type="button" role="menuitem" data-more="similar">Play something similar</button>
            ${b.freeDownload ? '<button type="button" role="menuitem" data-more="free">Free download (tagged MP3)</button>' : ''}
            <button type="button" role="menuitem" data-more="save">${saved.has(b.id) ? 'Remove from saved' : 'Save track'}</button>
            ${b.source === 'producer' ? `<a role="menuitem" href="messages.html?beat=${encodeURIComponent(b.id)}">Message the producer</a>` : ''}
          </div>`;
      },
    };
    // Loop modes. Section keeps [a, b]; the tool button shows the state.
    const paintLoopBtn = () => {
      const lbtn = $('.bt-tool[data-tool="loop"]', tools);
      lbtn.classList.toggle('is-on', loop.mode !== 'off');
      $('span', lbtn).textContent = loop.mode === 'section' ? `${fmtTime(loop.a)}–${fmtTime(loop.b)}` : 'Loop';
    };
    const setLoopMode = (m) => {
      loop.mode = m;
      audio.loop = m === 'track';
      if (m === 'section' && !(loop.b > loop.a)) {
        const b = beat();
        const bar = 240 / (b.bpm || 120);
        const a = Math.max(0, Math.floor(audio.currentTime / bar) * bar);
        loop.a = a; loop.b = Math.min(audio.duration || a + bar * 4, a + bar * 4); loop.bars = 4;
      }
      paintLoopBtn();
      if (openTool === 'loop') panels.loop();
      startLoopTick();
      drawWave();
    };
    const LOOP_BARS = [1, 2, 4, 8, 16];
    const fmtFine = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
    // Start / End: hold and move up (later) or down (earlier), accelerating.
    let ab = null;
    let abDragged = false;
    pop.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('[data-loop-set]');
      if (!btn || e.button !== 0) return;
      ab = { which: btn.dataset.loopSet, y: e.clientY, a: loop.a, b: loop.b, moved: false, btn };
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
    });
    pop.addEventListener('pointermove', (e) => {
      if (!ab || e.buttons !== 1) return;
      const dy = ab.y - e.clientY;
      if (!ab.moved && Math.abs(dy) < 3) return;
      ab.moved = true;
      ab.btn.classList.add('is-dragging');
      // Accelerating: fine for small moves (~0.5 s per 10 px), fast for big ones.
      const mag = Math.abs(dy) / 20 + (Math.abs(dy) / 60) ** 2;
      const delta = Math.sign(dy) * Math.round(mag * 10) / 10;
      const dur = audio.duration || ab.b + 60;
      if (ab.which === 'a') setSection(Math.min(ab.b - 0.25, Math.max(0, ab.a + delta)), ab.b);
      else setSection(ab.a, Math.max(ab.a + 0.25, Math.min(dur, ab.b + delta)));
    });
    const abEnd = () => { if (!ab) return; if (ab.moved) { abDragged = true; ab.btn.classList.remove('is-dragging'); if (ab.which === 'a') audio.currentTime = loop.a; } ab = null; };
    pop.addEventListener('pointerup', abEnd);
    pop.addEventListener('pointercancel', abEnd);
    const refreshLoop = () => {
      const sec = $('.bt-loop-sec', pop);
      if (openTool !== 'loop') return;
      if (!sec || sec.hidden || loop.mode !== 'section') { panels.loop(); return; }
      const bars = $('.bt-loop-bars', sec);
      const i = LOOP_BARS.indexOf(loop.bars);
      if (i >= 0) { bars.style.setProperty('--i', i); bars.setAttribute('data-set', ''); } else bars.removeAttribute('data-set');
      $$('[data-loop-bars]', bars).forEach((el) => el.setAttribute('aria-checked', String(Number(el.dataset.loopBars) === loop.bars)));
      $('#bt-loop-a', sec).textContent = fmtFine(loop.a);
      $('#bt-loop-b', sec).textContent = fmtFine(loop.b);
    };
    const setSection = (a, b, bars = 0) => {
      if (!(b - a >= 0.25)) return;
      loop.a = a; loop.b = b; loop.bars = bars; loop.mode = 'section'; audio.loop = false;
      if (audio.currentTime < a || audio.currentTime > b) audio.currentTime = a;
      paintLoopBtn();
      refreshLoop();
      startLoopTick();
      drawWave();
    };
    window.__csLoop = { setSection, isSection: () => loop.mode === 'section' };
    // Key meter: hold the mouse button and sweep across the ticks.
    let meterDrag = false;
    let meterBusy = false;
    const pickTick = async (e) => {
      const m = $('.bt-fx-meter', pop);
      if (!m || meterBusy) return;
      const r = m.getBoundingClientRect();
      const k = Math.max(-12, Math.min(12, Math.round(((e.clientX - r.left) / r.width) * 24) - 12));
      if (k === fx.semi) return;
      meterBusy = true;
      const ok = await setKeyShift(k);
      meterBusy = false;
      if (!ok) return;
      lastSemi = fx.semi; fx.semi = k; paintEdit(); paintMeter();
    };
    pop.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.bt-fx-meter') || e.button !== 0) return;
      meterDrag = true;
      try { e.target.closest('.bt-fx-meter').setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      pickTick(e);
    });
    pop.addEventListener('pointermove', (e) => { if (meterDrag && e.buttons === 1) pickTick(e); });
    const endDrag = () => { if (meterDrag) { meterDrag = false; const m = $('.bt-fx-meter', pop); if (m) { m.classList.remove('is-bump'); void m.offsetWidth; m.classList.add('is-bump'); } } };
    pop.addEventListener('pointerup', endDrag);
    pop.addEventListener('pointercancel', endDrag);
    let lastSemi = 0;
    const paintMeter = () => $$('.bt-fx-meter i', pop).forEach((el) => {
      const k = Number(el.dataset.k);
      // stagger: ticks further from the previous value change a bit later
      el.style.transitionDelay = meterDrag ? '0ms' : `${Math.min(12, Math.abs(k - lastSemi)) * 22}ms`;
      el.classList.toggle('is-on', fx.semi !== 0 && ((fx.semi > 0 && k > 0 && k <= fx.semi) || (fx.semi < 0 && k < 0 && k >= fx.semi)));
      el.classList.toggle('is-zero', k === 0);
    });
    const openPop = (tool) => {
      if (openTool === tool) { closePop(); return; }
      if (!currentId) return;
      if (openTool) $(`[data-tool="${openTool}"]`, tools).setAttribute('aria-expanded', 'false');
      openTool = tool;
      pop.className = `bt-pop is-${tool}`;
      panels[tool]();
      pop.hidden = false;
      $(`[data-tool="${tool}"]`, tools).setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => pop.classList.add('is-open'));
    };

    tools.addEventListener('click', async (e) => {
      const t = e.target.closest('.bt-tool');
      if (t) {
        const tool = t.dataset.tool;
        openPop(tool);
        return;
      }
      const lm = e.target.closest('[data-loop-mode]');
      if (lm) { setLoopMode(lm.dataset.loopMode); return; }
      const lb = e.target.closest('[data-loop-bars]');
      if (lb) {
        const b = beat();
        const bar = 240 / (b.bpm || 120);
        const dur = audio.duration || 0;
        const a = Math.max(0, Math.floor(audio.currentTime / bar) * bar);
        setSection(a, Math.min(dur || a + bar * Number(lb.dataset.loopBars), a + bar * Number(lb.dataset.loopBars)), Number(lb.dataset.loopBars));
        return;
      }
      const ls = e.target.closest('[data-loop-set]');
      if (ls && abDragged) { abDragged = false; return; }
      if (ls) {
        const t = audio.currentTime;
        if (ls.dataset.loopSet === 'a') setSection(t, loop.b > t + 0.25 ? loop.b : Math.min(audio.duration || t + 4, t + 4));
        else setSection(loop.a < t - 0.25 ? loop.a : Math.max(0, t - 4), t);
        return;
      }
      if (e.target.closest('[data-fx-reset]')) {
        lastSemi = fx.semi; fx.tempo = 1; fx.semi = 0; applyTempo(); await setKeyShift(0); paintEdit(); paintMeter(); return;
      }
      const s = e.target.closest('[data-semi]');
      const tick = e.target.closest('.bt-fx-meter i');
      if (s || tick) {
        const next = tick ? Number(tick.dataset.k) : Math.max(-12, Math.min(12, fx.semi + Number(s.dataset.semi)));
        if (next === fx.semi) return;
        const ok = await setKeyShift(next);
        if (!ok) { const n = $('.bt-pop-note', pop); n.hidden = false; n.textContent = 'Key change is not available in this browser.'; return; }
        lastSemi = fx.semi; fx.semi = next; paintEdit(); paintMeter();
        $('.bt-fx-meter', pop).classList.remove('is-bump'); void $('.bt-fx-meter', pop).offsetWidth; $('.bt-fx-meter', pop).classList.add('is-bump');
        return;
      }
      if (e.target.closest('[data-copy]')) {
        const ta = $('.bt-lyrics', pop);
        try { await navigator.clipboard.writeText(ta.value); $('#bt-lyrics-note', pop).textContent = 'Copied.'; } catch (err) { ta.select(); }
        return;
      }
      if (e.target.closest('.bt-vol-mute')) {
        audio.muted = !audio.muted;
        panels.vol();
        return;
      }
      const m = e.target.closest('[data-more]');
      if (m) {
        const b = beat();
        if (m.dataset.more === 'share') {
          try { await navigator.clipboard.writeText(new URL(beatUrl(b), location.href).href); m.textContent = 'Link copied'; } catch (err) {}
          return;
        }
        if (m.dataset.more === 'save') { toggleSave(b.id); closePop(); }
        if (m.dataset.more === 'similar') { closePop(); playSimilar(); }
        if (m.dataset.more === 'free') { freeDownload(b, m); }
      }
    });
    tools.addEventListener('input', (e) => {
      if (e.target.id === 'bt-fx-tempo') {
        fx.tempo = Number(e.target.value) / beat().bpm;
        applyTempo();
        paintEdit();
      } else if (e.target.id === 'bt-vol') {
        audio.volume = Number(e.target.value) / 100;
        audio.muted = audio.volume === 0;
        e.target.style.setProperty('--p', `${e.target.value}%`);
        $('.bt-vol-mute', pop).innerHTML = ic(audio.muted ? 'mute' : 'vol');
      }
    });
    document.addEventListener('pointerdown', (e) => { if (openTool && !tools.contains(e.target)) closePop(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openTool) closePop(); });

    window.__csTools = {
      // Another track: back to its original tempo and key.
      onTrack: (b) => {
        if (b.id === fx.id) return;
        fx.id = b.id;
        if (fx.tempo !== 1 || fx.semi !== 0) { fx.tempo = 1; fx.semi = 0; applyTempo(); setKeyShift(0); }
        $('.bt-tool[data-tool="edit"]', tools).classList.remove('is-on');
        if (loop.mode === 'section') { loop.mode = 'off'; loop.a = 0; loop.b = 0; loop.bars = 0; paintLoopBtn(); }
        if (openTool) panels[openTool]();
      },
    };
  };

  const setupPlayer = () => {
    setupPlayerTools();
    setupWave();
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
    // Drag on the waveform: picks a loop section (the selection follows the
    // pointer); a plain click seeks.
    const frac = (e) => { const r = bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
    let drag = null;
    // Loop edges: grab the start (preferred when the two are close) or the end.
    const nearEdge = (e) => {
      if (loop.mode !== 'section' || !audio.duration || !wv.peaks) return null;
      const r = bar.getBoundingClientRect();
      const x = e.clientX - r.left;
      const da = Math.abs(x - (loop.a / audio.duration) * r.width);
      const db = Math.abs(x - (loop.b / audio.duration) * r.width);
      if (da <= 12 && da <= db + 6) return 'a';
      if (db <= 12) return 'b';
      return null;
    };
    const showEdgeTip = (edge) => {
      const t = edge === 'a' ? loop.a : loop.b;
      wv.tip.hidden = false;
      wv.tip.textContent = `${edge === 'a' ? 'Start' : 'End'} ${fmtTenths(t)}`;
      wv.tip.style.left = `${(t / audio.duration) * 100}%`;
    };
    bar.addEventListener('pointermove', (e) => {
      if (e.buttons || wv.edgeDrag) return;
      const edge = nearEdge(e);
      if (edge !== wv.edge) { wv.edge = edge; bar.style.cursor = edge ? 'ew-resize' : ''; drawWave(); }
      if (edge) showEdgeTip(edge);
    });
    bar.addEventListener('pointerdown', (e) => {
      const edge = nearEdge(e);
      if (edge) {
        try { bar.setPointerCapture(e.pointerId); } catch (err) {}
        wv.edgeDrag = edge;
        drag = { edge };
        showEdgeTip(edge);
        drawWave();
        return;
      }
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      if (wv.peaks && audio.duration) { drag = { x: e.clientX, f: frac(e), moved: false }; return; }
      seek(e);
    });
    bar.addEventListener('pointermove', (e) => {
      if (e.buttons !== 1) return;
      if (drag && drag.edge) {
        const t = frac(e) * audio.duration;
        if (drag.edge === 'a') window.__csLoop.setSection(Math.max(0, Math.min(loop.b - 0.25, t)), loop.b);
        else window.__csLoop.setSection(loop.a, Math.min(audio.duration, Math.max(loop.a + 0.25, t)));
        showEdgeTip(drag.edge);
        return;
      }
      if (!drag) { seek(e); return; }
      if (!drag.moved && Math.abs(e.clientX - drag.x) < 6) return;
      drag.moved = true;
      const f2 = frac(e);
      const a = Math.min(drag.f, f2) * audio.duration;
      const b = Math.max(drag.f, f2) * audio.duration;
      if (window.__csLoop && b - a >= 0.25) window.__csLoop.setSection(a, b);
    });
    const endEdge = () => {
      if (drag && drag.edge === 'a') audio.currentTime = loop.a;
      wv.edgeDrag = null; wv.tip.hidden = true; drawWave();
    };
    bar.addEventListener('pointerup', (e) => { if (drag && drag.edge) endEdge(); else if (drag && !drag.moved) seek(e); drag = null; });
    bar.addEventListener('pointercancel', () => { if (drag && drag.edge) endEdge(); drag = null; });
    bar.addEventListener('pointerleave', () => { if (!wv.edgeDrag && wv.edge) { wv.edge = null; bar.style.cursor = ''; drawWave(); } });
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
    }</tbody></table><p>Every license is non-exclusive and requires the credit "${esc(beat.producer)}". Full terms are in the license PDF you receive after purchase.</p>`;
  };
  const selectTier = (id) => {
    modalTier = id;
    $$('.bt-tier', modal).forEach((el) => { const on = el.dataset.tier === id; el.classList.toggle('is-selected', on); $('input', el).checked = on; });
    $('#bt-license-total').textContent = euro(modalBeat.prices[id]);
    const inCart = cart.find((c) => c.id === modalBeat.id);
    $('#bt-license-add').textContent = !canBuy ? SOON : inCart ? (inCart.tier === id ? 'In cart · View cart' : 'Update cart') : 'Add to cart';
    $('#bt-license-add').disabled = !canBuy;
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
            <span class="bt-tier-name">${esc(t.unlimited ? t.name.replace(/\s*unlimited$/i, '') : t.name)}${t.unlimited ? '<span class="bt-tier-pill">Unlimited</span>' : ''}</span>
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
      if (!canBuy) return;
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
    if (!canBuy) return;
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
    if (!canBuy) { note.textContent = 'Track licensing opens soon.'; note.classList.add('is-error'); return; }
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
  // Live catalogue (data/beats.json + approved producer uploads); the static
  // file is the fallback (local preview, API down).
  const loadCatalogue = () => fetch('/api/beats/catalogue', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`catalogue ${r.status}`))))
    .catch(() => fetch('/data/beats.json', { cache: 'no-cache' }).then((r) => r.json()));
  Promise.all([
    loadCatalogue(),
    fetch('/data/beat-licenses.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]).then(([catalogue, licenses]) => {
    LIC = licenses;
    PRODUCERS = catalogue.producers || {};
    BEATS = (catalogue.beats || []).filter((b) => b.status !== 'hidden' && tiersOf(b).length);
    byId = new Map(BEATS.map((b) => [b.id, b]));
    paintAccents(BEATS);
    canBuy = catalogue.salesOpen !== false;
    document.documentElement.classList.toggle('bt-sales-closed', !canBuy);
    if (!canBuy && window.csMe) {
      Promise.resolve(window.csMe).then((me) => {
        if (!me || !me.isAdmin) return;
        canBuy = true;
        document.documentElement.classList.remove('bt-sales-closed');
        const picked = beatRoot && $('#bp-tiers input:checked');
        if (picked) picked.dispatchEvent(new Event('change', { bubbles: true }));
      }).catch(() => {});
    }
    setupPlayer();
    setupModal();
    setupCart();
    if (catalogueRoot) setupCatalogue();
    if (trackPage) {
      const beat = byId.get(new URLSearchParams(location.search).get('id') || '');
      if (!beat || !window.CSBeatMarkup) {
        trackPage.innerHTML = '<div class="bp-wrap"><div class="bt-empty"><p>This track is not available.</p><a href="beats.html" class="btn btn-primary">Browse tracks</a></div></div>';
      } else {
        trackPage.insertAdjacentHTML('afterend', window.CSBeatMarkup.beatMainHtml(beat, { LIC, producers: PRODUCERS }));
        trackPage.remove();
        beatRoot = document.querySelector('[data-beat-id]');
        document.title = `${beat.title} by ${beat.producer} | ${beat.genre} track | Creative Sound`;
      }
    }
    if (beatRoot) setupBeatPage();
    if (savedRoot) renderSavedPage();
    syncSaved();
  }).catch((err) => {
    console.error('beats: catalogue failed to load', err);
    const empty = $('#bt-empty');
    if (empty) { empty.hidden = false; $('p', empty).textContent = 'The catalogue could not be loaded. Please refresh the page.'; }
  });
})();
