/* Beats page (beats.html): catalogue, filters, persistent player, license
   picker, cart and checkout.

   Data comes from data/beats.json (catalogue + per-tier prices in cents) and
   data/beat-licenses.json (the four tiers). The server re-reads prices from
   the same file at checkout, so nothing priced in the browser is trusted.

   Motion follows the rules in css/beats.css: entrance stagger once, CSS
   transitions for state, WAAPI only for the add-to-cart flight and the
   cart badge, everything gentler with prefers-reduced-motion. */
(function () {
  const root = document.querySelector('.beats-page');
  if (!root) return;

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
  let byId = new Map();

  /* ------------------------------- Rendering ------------------------------- */
  const tintClass = (b) => `bt-tint-${['amber', 'blue', 'red', 'violet', 'green'].includes(b.tint) ? b.tint : 'amber'}`;
  const art = (b) => `
    <div class="bt-art">
      ${b.cover
        ? `<img src="${esc(b.cover)}" alt="" loading="lazy">`
        : `<div class="bt-art-gen" aria-hidden="true"></div><span class="bt-art-word" aria-hidden="true">${esc(b.title)}</span>`}
      <span class="bt-art-bpm" aria-hidden="true">${b.bpm} BPM</span>
    </div>`;
  const tiersOf = (b) => LIC.order.filter((t) => b.prices && b.prices[t] > 0);
  const minPrice = (b) => Math.min(...tiersOf(b).map((t) => b.prices[t]));

  const cardHtml = (b, i) => `
    <article class="bt-card ${tintClass(b)}" data-id="${esc(b.id)}" style="--i:${Math.min(i, 12)}">
      <div class="bt-cover-wrap" style="position:relative">
        ${art(b)}
        <button type="button" class="bt-play" aria-label="Play ${esc(b.title)}" aria-pressed="false">
          <svg class="bt-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>
          <svg class="bt-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>
        </button>
        <span class="bt-eq" aria-hidden="true"><i></i><i></i><i></i></span>
      </div>
      <div class="bt-body">
        <div class="bt-titles">
          <span class="bt-name">${esc(b.title)}</span>
          <span class="bt-by">prod. <b>${esc(b.producer)}</b>${b.typeBeat && b.typeBeat.length ? ` · ${esc(b.typeBeat.join(', '))} type beat` : ''}</span>
        </div>
        <div class="bt-facts">
          <span class="bt-fact">${b.bpm} BPM</span>
          <span class="bt-fact">${esc(b.key)}</span>
          <span class="bt-fact">${esc(b.genre)}</span>
        </div>
        <button type="button" class="bt-buy" data-buy aria-label="Choose a license for ${esc(b.title)}, from ${euro(minPrice(b))}">
          <span>License from</span><strong>${euro(minPrice(b))}</strong>
        </button>
      </div>
    </article>`;

  /* -------------------------------- Filters -------------------------------- */
  const grid = $('#bt-grid');
  const state = {
    cat: 'all', q: '', genre: '', mood: '', bpm: '', key: '', sort: 'new',
    tags: new Set(), view: store.get('bt-view', 'grid'),
  };
  let firstRender = true;
  let visible = [];

  const NEW_DAYS = 30;
  const matches = (b) => {
    if (state.cat === 'new' && (Date.now() - new Date(b.released).getTime()) / 864e5 > NEW_DAYS) return false;
    if (state.cat === 'under30' && minPrice(b) >= 3000) return false;
    if (state.cat === 'stems' && !(b.prices.trackout > 0)) return false;
    if (state.cat === 'project' && !(b.prices.project > 0)) return false;
    if (state.genre && b.genre !== state.genre) return false;
    if (state.mood && b.mood !== state.mood) return false;
    if (state.key && b.key !== state.key) return false;
    if (state.bpm) {
      const [lo, hi] = state.bpm.split('-').map(Number);
      if (b.bpm < lo || b.bpm > hi) return false;
    }
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
  const isFiltered = () => state.cat !== 'all' || state.q || state.genre || state.mood || state.bpm || state.key || state.tags.size;

  const paint = () => {
    grid.innerHTML = visible.map(cardHtml).join('');
    grid.dataset.view = state.view;
    $('#bt-empty').hidden = visible.length > 0;
    $('#bt-count').textContent = `${visible.length} beat${visible.length === 1 ? '' : 's'}`;
    $('#bt-reset').hidden = !isFiltered();
    syncCards();
  };

  const render = () => {
    visible = BEATS.filter(matches).sort(sorters[state.sort]);
    if (firstRender) {
      firstRender = false;
      paint();
      // Entrance once, when the grid first scrolls into view.
      const cards = $$('.bt-card', grid);
      cards.forEach((c) => c.classList.add('bt-enter'));
      const go = () => cards.forEach((c) => { c.classList.remove('bt-enter'); c.classList.add('bt-in'); });
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) { io.disconnect(); go(); }
        }, { threshold: 0.1 });
        io.observe(grid);
      } else go();
      return;
    }
    // Filtering happens often: a quick fade, no movement.
    if (reduceMotion) { paint(); return; }
    grid.classList.add('is-swapping');
    setTimeout(() => { paint(); grid.classList.remove('is-swapping'); }, 150);
  };

  const fillSelect = (id, values) => {
    const sel = $(id);
    values.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
  };

  const setupFilters = () => {
    const uniq = (k) => [...new Set(BEATS.map((b) => b[k]).filter(Boolean))].sort();
    fillSelect('#bt-genre', uniq('genre'));
    fillSelect('#bt-mood', uniq('mood'));
    fillSelect('#bt-key', uniq('key'));

    // Most used tags first, capped so the row stays one glance.
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

    $$('.bt-cat').forEach((btn) => btn.addEventListener('click', () => {
      state.cat = btn.dataset.cat;
      $$('.bt-cat').forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
      render();
    }));

    let qTimer = 0;
    $('#bt-q').addEventListener('input', (e) => {
      clearTimeout(qTimer);
      qTimer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); render(); }, 160);
    });
    [['#bt-genre', 'genre'], ['#bt-mood', 'mood'], ['#bt-bpm', 'bpm'], ['#bt-key', 'key'], ['#bt-sort', 'sort']].forEach(([id, k]) => {
      $(id).addEventListener('change', (e) => {
        state[k] = e.target.value;
        if (k !== 'sort') e.target.classList.toggle('is-set', !!e.target.value);
        render();
      });
    });

    const reset = () => {
      Object.assign(state, { cat: 'all', q: '', genre: '', mood: '', bpm: '', key: '' });
      state.tags.clear();
      $('#bt-q').value = '';
      ['#bt-genre', '#bt-mood', '#bt-bpm', '#bt-key'].forEach((id) => { $(id).value = ''; $(id).classList.remove('is-set'); });
      $$('.bt-cat').forEach((b) => { b.classList.toggle('is-active', b.dataset.cat === 'all'); b.setAttribute('aria-selected', String(b.dataset.cat === 'all')); });
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

    grid.addEventListener('click', (e) => {
      const card = e.target.closest('.bt-card');
      if (!card) return;
      const beat = byId.get(card.dataset.id);
      if (e.target.closest('.bt-play')) togglePlay(beat.id);
      else if (e.target.closest('[data-buy]')) openLicense(beat, e.target.closest('[data-buy]'));
    });
  };

  /* ------------------------------ License tiers ---------------------------- */
  const renderTierGrid = () => {
    $('#bt-tier-grid').innerHTML = LIC.order.map((id) => {
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

  const showPlayer = (beat) => {
    player.className = `bt-player ${tintClass(beat)}${audio.paused ? '' : ' is-playing'}${player.classList.contains('is-visible') ? ' is-visible' : ''}`;
    $('#bt-player-cover').innerHTML = art(beat);
    $('#bt-player-title').textContent = beat.title;
    $('#bt-player-producer').textContent = `prod. ${beat.producer}`;
    $('#bt-player-buy').textContent = `Buy · from ${euro(minPrice(beat))}`;
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
    $$('.bt-card', grid).forEach((c) => {
      const cur = c.dataset.id === currentId;
      const playing = cur && !audio.paused;
      c.classList.toggle('is-current', cur);
      c.classList.toggle('is-playing', playing);
      const btn = $('.bt-play', c);
      btn.setAttribute('aria-pressed', String(playing));
      btn.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${byId.get(c.dataset.id).title}`);
    });
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
  const togglePlay = (id) => {
    if (id === currentId && !audio.paused) audio.pause();
    else play(id);
  };
  const step = (dir) => {
    const list = visible.length ? visible : BEATS;
    const i = list.findIndex((b) => b.id === currentId);
    const next = list[(i + dir + list.length) % list.length];
    if (next) play(next.id);
  };

  // Visualizer + progress, drawn only while playing (and while settling).
  const rgbOf = (el) => (getComputedStyle(el).getPropertyValue('--fx') || '232,134,44').trim();
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
        grad.addColorStop(0, `rgba(${rgb}, 0.0)`);
        grad.addColorStop(0.35, `rgba(${rgb}, 0.28)`);
        grad.addColorStop(0.5, `rgba(${rgb}, 0.38)`);
        grad.addColorStop(0.65, `rgba(${rgb}, 0.28)`);
        grad.addColorStop(1, `rgba(${rgb}, 0.0)`);
        // Mirrored silhouette around the progress line.
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
  const updateProgress = () => {
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    $('#bt-player-fill').style.transform = `scaleX(${p.toFixed(4)})`;
    $('#bt-player-bar').setAttribute('aria-valuenow', String(Math.round(p * 100)));
    $('#bt-time').textContent = fmtTime(audio.currentTime);
    $('#bt-dur').textContent = fmtTime(audio.duration);
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
    // Space toggles play when focus isn't in a field or on a button.
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || !currentId) return;
      if (e.target.closest('input, select, textarea, button, a, [role="slider"], dialog')) return;
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
    $$('.bt-tier', modal).forEach((el) => {
      const on = el.dataset.tier === id;
      el.classList.toggle('is-selected', on);
      $('input', el).checked = on;
    });
    $('#bt-license-total').textContent = euro(modalBeat.prices[id]);
    const inCart = cart.find((c) => c.id === modalBeat.id);
    $('#bt-license-add').textContent = inCart ? (inCart.tier === id ? 'In cart · View cart' : 'Update cart') : 'Add to cart';
  };

  const openLicense = (beat, trigger) => {
    modalBeat = beat;
    modalTrigger = trigger || null;
    modal.className = `bt-modal ${tintClass(beat)}`;
    $('#bt-license-cover').innerHTML = art(beat);
    $('#bt-license-title').textContent = beat.title;
    $('#bt-license-sub').textContent = `prod. ${beat.producer} · ${beat.bpm} BPM · ${beat.key}`;
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
    modal.addEventListener('close', () => { if (modalTrigger && document.contains(modalTrigger)) modalTrigger.focus(); });
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

  const cleanCart = () => {
    cart = cart.filter((c) => byId.has(c.id) && byId.get(c.id).prices[c.tier] > 0);
  };
  const saveCart = () => { store.set('bt-cart', cart); renderCart(); };
  const addToCart = (id, tier) => {
    const i = cart.findIndex((c) => c.id === id);
    if (i >= 0) cart[i].tier = tier; else cart.push({ id, tier });
    saveCart();
    $$('.bt-card', grid).forEach((c) => { if (c.dataset.id === id) $('.bt-buy', c).classList.add('in-cart'); });
  };
  const cartTotal = () => cart.reduce((s, c) => s + byId.get(c.id).prices[c.tier], 0);

  const renderCart = () => {
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
          <span><span class="bt-cart-name">${esc(b.title)}</span><span class="bt-cart-tier">${esc(LIC.tiers[c.tier].name)} · prod. ${esc(b.producer)}</span></span>
          <span class="bt-cart-side"><span class="bt-cart-price">${euro(b.prices[c.tier])}</span><button type="button" class="bt-cart-remove" aria-label="Remove ${esc(b.title)} from cart">Remove</button></span>
        </li>`;
    }).join('');
    $$('.bt-card', grid).forEach((c) => { const b = $('.bt-buy', c); if (b) b.classList.toggle('in-cart', cart.some((x) => x.id === c.dataset.id)); });
  };

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
    if (drawerReturn && document.contains(drawerReturn)) drawerReturn.focus();
  };

  // The cover flies from the license picker into the cart button, then the
  // badge pulses: shows where the beat went (spatial consistency).
  const flyToCart = (beat, fromRect) => {
    const bump = () => {
      if (reduceMotion) return;
      fab.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 260, easing: EASE_OUT });
      $('#bt-cart-count').animate([{ transform: 'scale(0.6)' }, { transform: 'scale(1)' }], { duration: 220, easing: EASE_OUT });
    };
    if (reduceMotion || !fromRect || !fromRect.width) { bump(); return; }
    const toRect = fab.getBoundingClientRect();
    const fly = document.createElement('div');
    fly.className = `bt-fly ${tintClass(beat)}`;
    fly.innerHTML = art(beat);
    Object.assign(fly.style, { left: `${fromRect.left}px`, top: `${fromRect.top}px`, width: `${fromRect.width}px` });
    document.body.appendChild(fly);
    const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
    const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
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
      const done = () => { cart = cart.filter((c) => c.id !== id); saveCart(); if (!cart.length) $('.bt-modal-close', drawer).focus(); };
      if (reduceMotion) { done(); return; }
      li.classList.add('is-leaving');
      setTimeout(done, 180);
    });
    $('#bt-checkout').addEventListener('click', checkout);
    if (new URLSearchParams(location.search).get('cart') === '1' && cart.length) openCart();
  };

  const checkout = async () => {
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
        // Purchases are tied to an account, same as the rest of the shop.
        location.href = `signup.html?next=${encodeURIComponent('/beats.html?cart=1')}`;
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout is not available right now. Please try again.');
      location.href = data.url;
    } catch (err) {
      note.textContent = err.message;
      note.classList.add('is-error');
      btn.disabled = false;
      btn.textContent = 'Checkout';
    }
  };

  /* ---------------------------------- Boot --------------------------------- */
  Promise.all([
    fetch('data/beats.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('data/beat-licenses.json', { cache: 'no-cache' }).then((r) => r.json()),
  ]).then(([catalogue, licenses]) => {
    LIC = licenses;
    BEATS = (catalogue.beats || []).filter((b) => b.status !== 'hidden' && tiersOf(b).length);
    byId = new Map(BEATS.map((b) => [b.id, b]));
    setupFilters();
    setupPlayer();
    setupModal();
    setupCart();
    renderTierGrid();
    render();
  }).catch((err) => {
    console.error('beats: catalogue failed to load', err);
    $('#bt-count').textContent = '';
    $('#bt-empty').hidden = false;
    $('#bt-empty p').textContent = 'The catalogue could not be loaded. Please refresh the page.';
  });
})();
