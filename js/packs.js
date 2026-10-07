/* Packs page (packs.html): playable covers.
   - Pointer tilt + amber glare on the card (fine pointers only); the glare
     dot is placed exactly under the pointer.
   - Play button streams the pack's demo; while it plays, a canvas
     visualizer on the cover follows the real audio through a Web Audio
     analyser. One demo at a time; it falls off smoothly on pause.
   - Covers come in with a focus pull the first time they scroll into view.
   Everything decorative is skipped with prefers-reduced-motion; the play
   button still works. The whole card opens the pack page through a
   stretched title link (CSS only). */
(function () {
  const cards = document.querySelectorAll('.pk-card');
  if (!cards.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const MAX_TILT = 6; // degrees

  /* ------------------------------ Focus pull ------------------------------ */
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const cover = entry.target;
        const index = [...cards].indexOf(cover.closest('.pk-card'));
        setTimeout(() => cover.classList.remove('pk-pre'), 120 + index * 120);
        io.unobserve(cover);
      });
    }, { threshold: 0.35 });
    cards.forEach((card) => {
      const cover = card.querySelector('.pk-cover');
      cover.classList.add('pk-pre');
      io.observe(cover);
    });
  }

  /* --------------------------------- Tilt --------------------------------- */
  if (finePointer && !reduceMotion) {
    cards.forEach((card) => {
      // The wrapper never tilts, so its box is the card's untilted layout box.
      const wrap = card.parentElement;
      let frame = 0;
      let last = null;
      const apply = () => {
        frame = 0;
        if (!last) return;
        const r = wrap.getBoundingClientRect();
        const x = (last.clientX - r.left) / r.width;  // 0..1
        const y = (last.clientY - r.top) / r.height;  // 0..1
        card.style.setProperty('--ry', `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
        card.style.setProperty('--rx', `${((0.5 - y) * 2 * MAX_TILT * 0.7).toFixed(2)}deg`);
        // The glare is drawn on the cover (first item, at the card's top-left
        // inside the 1px border), in the card's own tilted plane. Undo the
        // card's current perspective + rotation (a plane homography) so the
        // dot lands exactly under the pointer, corners included.
        const ox = r.width / 2;
        const oy = r.height / 2;
        const t = getComputedStyle(card).transform;
        const m = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
        const X = last.clientX - r.left - ox;
        const Y = last.clientY - r.top - oy;
        const A = m.m11 - m.m14 * X, B = m.m21 - m.m24 * X, E = m.m44 * X - m.m41;
        const C = m.m12 - m.m14 * Y, D = m.m22 - m.m24 * Y, F = m.m44 * Y - m.m42;
        const det = A * D - B * C || 1;
        const lx = (E * D - B * F) / det + ox - 1;
        const ly = (A * F - E * C) / det + oy - 1;
        card.style.setProperty('--gx', `${lx.toFixed(1)}px`);
        card.style.setProperty('--gy', `${ly.toFixed(1)}px`);
      };
      // The tilt eases in over 0.12s; re-place the dot once it settles.
      card.addEventListener('transitionend', (e) => {
        if (e.target === card && e.propertyName === 'transform' && last && !frame) frame = requestAnimationFrame(apply);
      });
      card.addEventListener('pointerenter', () => card.classList.add('is-tilting'));
      card.addEventListener('pointermove', (e) => {
        last = e;
        if (!frame) frame = requestAnimationFrame(apply);
      });
      card.addEventListener('pointerleave', () => {
        last = null;
        card.classList.remove('is-tilting'); // longer settle transition takes over
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ------------------------- Player + visualizer -------------------------- */
  // Canvas drawn every frame while a demo plays:
  //  1. spectrum silhouette (log-spaced bands, fast attack / slow release),
  //     amber-to-gold gradient with a blurred glow and a faint reflection
  //  2. a bright contour line along its top edge
  //  3. a thin oscilloscope trace of the waveform
  //  4. embers that rise from the silhouette on bass hits
  // Bass energy also drives --pulse (bloom from below) and --kick (cover
  // scale). On pause the bands fall to zero and the loop stops once
  // everything has settled.
  const BANDS = 48;
  let ctx = null;
  let current = null;

  const sizeCanvas = (state) => {
    const canvas = state.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return false;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    state.w = w;
    state.h = h;
    state.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  };

  // Smooth curve through the band points (midpoint quadratic splines).
  const tracePath = (g, pts) => {
    g.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      g.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const end = pts[pts.length - 1];
    g.lineTo(end[0], end[1]);
  };

  const frame = (state, now) => {
    const { g, analyser, freq, wave, bands, embers, col } = state;
    if (!sizeCanvas(state)) { state.raf = requestAnimationFrame((t) => frame(state, t)); return; }
    const { w, h } = state;
    const dt = Math.min(0.05, (now - (state.t || now)) / 1000) || 0.016;
    state.t = now;
    const live = state.playing;

    if (live) {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(wave);
    }

    // Bands: log-spaced over the useful part of the spectrum.
    const usable = freq.length * 0.7;
    let energy = 0;
    for (let i = 0; i < BANDS; i++) {
      let target = 0;
      if (live) {
        const a = Math.floor(Math.pow(i / BANDS, 1.7) * usable);
        const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / BANDS, 1.7) * usable));
        let sum = 0;
        for (let j = a; j < b; j++) sum += freq[j];
        target = Math.pow(sum / (b - a) / 255, 2.2);
        // Lift the highs a little so the right side isn't always flat.
        target = Math.min(1, target * (0.85 + (i / BANDS) * 0.6));
      }
      const k = target > bands[i] ? 0.55 : 0.12; // fast attack, slow release
      bands[i] += (target - bands[i]) * k;
      energy += bands[i];
    }
    energy /= BANDS;

    // Kick detection: onset (sudden rise) of the raw low end, roughly
    // 40-160 Hz, against its own running average. Works on the unsmoothed
    // bins so a sustained bass line doesn't hide the drum hits.
    const bass = (bands[0] + bands[1] + bands[2] + bands[3]) / 4;
    let low = 0;
    if (live) {
      const binHz = ctx.sampleRate / (freq.length * 2);
      const a = Math.max(1, Math.floor(40 / binHz));
      const b = Math.max(a + 1, Math.ceil(160 / binHz));
      for (let j = a; j < b; j++) low += freq[j];
      low /= (b - a) * 255;
    }
    const rise = low - state.prevLow;
    state.prevLow = low;
    state.bassAvg += (low - state.bassAvg) * 0.08;
    const hit = live && low > 0.35 && rise > 0.035 && low > state.bassAvg * 1.06 && now - state.lastHit > 160;
    if (hit) state.lastHit = now;
    state.pulse = hit ? 1 : state.pulse * Math.pow(0.02, dt); // ~0.6s decay
    state.cover.style.setProperty('--pulse', Math.max(state.pulse, bass * 0.6).toFixed(3));
    state.cover.style.setProperty('--kick', state.pulse.toFixed(3));

    g.clearRect(0, 0, w, h);
    const base = h - 8;
    const maxH = h * 0.74;
    const pad = 10;
    const step = (w - pad * 2) / (BANDS - 1);
    const pts = bands.map((v, i) => [pad + i * step, base - v * maxH]);

    g.save();
    g.globalCompositeOperation = 'lighter';

    // 1. Filled silhouette with glow.
    const fill = g.createLinearGradient(0, base - maxH, 0, base);
    fill.addColorStop(0, `rgba(${col.hi}, 0.55)`);
    fill.addColorStop(0.45, `rgba(${col.fx}, 0.45)`);
    fill.addColorStop(1, `rgba(${col.fx}, 0.04)`);
    g.beginPath();
    g.moveTo(pad, base);
    tracePath(g, pts);
    g.lineTo(w - pad, base);
    g.closePath();
    g.shadowColor = `rgba(${col.fx}, 0.9)`;
    g.shadowBlur = 22;
    g.fillStyle = fill;
    g.fill();

    // Faint mirrored reflection under the baseline.
    g.globalAlpha = 0.2;
    g.shadowBlur = 0;
    g.beginPath();
    g.moveTo(pad, base);
    tracePath(g, pts.map(([x, y]) => [x, base + (base - y) * 0.22]));
    g.lineTo(w - pad, base);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;

    // 2. Contour line.
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    tracePath(g, pts);
    g.lineWidth = 1.6;
    g.strokeStyle = `rgba(${col.soft}, 0.95)`;
    g.shadowColor = `rgba(${col.hi}, 0.9)`;
    g.shadowBlur = 10;
    g.stroke();

    // 3. Oscilloscope trace across the upper middle of the canvas.
    if (live) {
      g.beginPath();
      const mid = h * 0.38;
      const amp = h * 0.16 * (0.4 + energy);
      const n = wave.length;
      for (let i = 0; i < n; i += 4) {
        const x = (i / (n - 1)) * w;
        const y = mid + ((wave[i] - 128) / 128) * amp;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.lineWidth = 1;
      g.strokeStyle = `rgba(${col.hi}, 0.45)`;
      g.shadowBlur = 8;
      g.stroke();
    }

    // 4. Embers: spawn on hits from the silhouette's top edge, rise and fade.
    if (hit) {
      const count = 6 + Math.round(bass * 10);
      for (let i = 0; i < count; i++) {
        const bi = Math.floor(Math.random() * BANDS * 0.6);
        embers.push({
          x: pts[bi][0] + (Math.random() - 0.5) * step,
          y: pts[bi][1],
          vx: (Math.random() - 0.5) * 30,
          vy: -(40 + Math.random() * 90),
          life: 1,
          r: 0.8 + Math.random() * 1.8,
        });
      }
    }
    g.shadowColor = `rgba(${col.fx}, 1)`;
    g.shadowBlur = 10;
    g.fillStyle = `rgba(${col.soft}, 1)`;
    for (let i = embers.length - 1; i >= 0; i--) {
      const e = embers[i];
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.vy += 20 * dt; // a touch of drag
      e.life -= dt * 0.9;
      if (e.life <= 0 || e.y < -10) { embers.splice(i, 1); continue; }
      g.globalAlpha = e.life;
      g.beginPath();
      g.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // Keep drawing while playing, or until the fall-off has finished.
    const settled = !live && energy < 0.002 && !embers.length && state.pulse < 0.01;
    if (settled) {
      state.raf = 0;
      g.clearRect(0, 0, w, h);
      state.cover.classList.remove('is-fading');
      state.cover.style.setProperty('--pulse', '0');
      state.cover.style.setProperty('--kick', '0');
      return;
    }
    state.raf = requestAnimationFrame((t) => frame(state, t));
  };

  const stop = (state) => {
    state.audio.pause();
    state.playing = false;
    state.cover.classList.remove('is-playing');
    state.button.setAttribute('aria-pressed', 'false');
    if (state.raf) state.cover.classList.add('is-fading'); // let it fall off
  };

  cards.forEach((card) => {
    const cover = card.querySelector('.pk-cover');
    const button = card.querySelector('.pk-play');
    const canvas = card.querySelector('.pk-viz');
    if (!button) return;
    const audio = new Audio();
    audio.preload = 'none';
    audio.src = button.dataset.audio;
    // Effect colours come from the card's CSS (--fx / --fx-hi / --fx-soft).
    const css = getComputedStyle(card);
    const col = {
      fx: css.getPropertyValue('--fx').trim() || '232,134,44',
      hi: css.getPropertyValue('--fx-hi').trim() || '255,215,0',
      soft: css.getPropertyValue('--fx-soft').trim() || '255,228,170',
    };
    const state = {
      col, cover, button, audio, canvas, g: canvas ? canvas.getContext('2d') : null,
      analyser: null, freq: null, wave: null, raf: 0, playing: false, t: 0,
      bands: new Array(BANDS).fill(0),
      embers: [], bassAvg: 0, prevLow: 0, lastHit: 0, pulse: 0, w: 0, h: 0,
    };

    audio.addEventListener('ended', () => { stop(state); if (current === state) current = null; });

    button.addEventListener('click', async () => {
      if (current === state && !audio.paused) { stop(state); current = null; return; }
      if (current && current !== state) stop(current);
      current = state;

      if (!reduceMotion && state.g && (window.AudioContext || window.webkitAudioContext)) {
        try {
          ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
          if (ctx.state === 'suspended') await ctx.resume();
          if (!state.analyser) {
            const source = ctx.createMediaElementSource(audio);
            state.analyser = ctx.createAnalyser();
            state.analyser.fftSize = 2048;
            state.analyser.smoothingTimeConstant = 0.5;
            source.connect(state.analyser);
            state.analyser.connect(ctx.destination);
            state.freq = new Uint8Array(state.analyser.frequencyBinCount);
            state.wave = new Uint8Array(state.analyser.fftSize);
          }
        } catch (e) { state.analyser = null; }
      }

      try {
        await audio.play();
      } catch (e) {
        cover.classList.remove('is-playing');
        button.setAttribute('aria-pressed', 'false');
        current = null;
        return;
      }
      state.playing = true;
      cover.classList.remove('is-fading');
      cover.classList.add('is-playing');
      button.setAttribute('aria-pressed', 'true');
      if (state.analyser && !state.raf) state.raf = requestAnimationFrame((t) => frame(state, t));
    });
  });

  // Leaving the tab pauses the demo instead of playing to nobody.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && current) { stop(current); current = null; }
  });
})();
