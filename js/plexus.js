/* Animated "plexus" network background: glowing amber particles connected
   by lines that fade with distance, drifting slowly behind the hero content.

   Kept cheap on purpose (it runs on every page that has one):
   - 30 frames a second at most, whatever the screen's refresh rate;
   - only the part of the canvas that is on screen is worked on;
   - links are drawn in a few batches (one stroke per batch, not one per link);
   - the glow of a dot is a small pre-drawn sprite, not shadowBlur;
   - fewer dots on phones and low-power devices; one still frame for reduced motion. */
(() => {
  'use strict';

  const canvases = document.querySelectorAll('.plexus-bg');
  if (!canvases.length) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection || {};
  const LOW = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 4 || !!conn.saveData;
  const LINE_RGB = '232,134,44';
  const LINK_DIST = 140;
  const SPEED = 0.15;
  const FRAME_MS = 33;
  const BUCKETS = 5;
  const MARGIN = 160; // draw a little beyond the screen edges

  // Glow of one dot, drawn once.
  const sprite = (() => {
    const s = 28;
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(232,134,44,0.95)');
    grad.addColorStop(0.18, 'rgba(232,134,44,0.9)');
    grad.addColorStop(0.45, 'rgba(232,134,44,0.28)');
    grad.addColorStop(1, 'rgba(232,134,44,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return { img: c, size: s };
  })();

  canvases.forEach(initPlexus);

  function initPlexus(canvas) {
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    let width = 0;
    let height = 0;
    let top = 0; // distance of the canvas from the top of the page
    let dpr = 1;
    let particles = [];
    let animId = null;
    let last = 0;

    function particleCount() {
      const area = width * height;
      return Math.min(LOW ? 36 : 90, Math.max(24, Math.round(area / (LOW ? 26000 : 18000))));
    }

    function seedParticles() {
      particles = Array.from({ length: particleCount() }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * SPEED,
        vy: (Math.random() - 0.5) * SPEED,
        r: Math.random() * 1.6 + 1,
      }));
    }

    function resize() {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2);
      width = rect.width;
      height = rect.height;
      top = rect.top + window.scrollY;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      // The part of the canvas that is on screen (plus a margin).
      const y0 = window.scrollY - top - MARGIN;
      const y1 = window.scrollY - top + window.innerHeight + MARGIN;

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      }

      const near = particles.filter((p) => p.y > y0 && p.y < y1);
      const buckets = Array.from({ length: BUCKETS }, () => []);
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          const a = near[i];
          const b = near[j];
          const dx = a.x - b.x;
          if (dx > LINK_DIST || dx < -LINK_DIST) continue;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DIST * LINK_DIST) {
            const k = Math.min(BUCKETS - 1, Math.floor((1 - Math.sqrt(d2) / LINK_DIST) * BUCKETS));
            buckets[k].push(a, b);
          }
        }
      }
      ctx.lineWidth = 1;
      for (let k = 0; k < BUCKETS; k++) {
        const list = buckets[k];
        if (!list.length) continue;
        ctx.strokeStyle = `rgba(${LINE_RGB},${(((k + 0.5) / BUCKETS) * 0.35).toFixed(3)})`;
        ctx.beginPath();
        for (let n = 0; n < list.length; n += 2) {
          ctx.moveTo(list[n].x, list[n].y);
          ctx.lineTo(list[n + 1].x, list[n + 1].y);
        }
        ctx.stroke();
      }

      for (const p of near) {
        const s = sprite.size * (0.55 + p.r * 0.32);
        ctx.drawImage(sprite.img, p.x - s / 2, p.y - s / 2, s, s);
      }
    }

    function step(t) {
      animId = requestAnimationFrame(step);
      if (t - last < FRAME_MS) return;
      last = t;
      draw();
    }

    function start() {
      if (animId || prefersReducedMotion) return;
      animId = requestAnimationFrame(step);
    }

    function stop() {
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }

    resize();
    draw();
    start();

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resize(); draw(); }, 200);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });

    // Not on screen at all (a canvas far down the page): do not animate it.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) start(); else stop(); });
      }, { rootMargin: '200px' }).observe(canvas);
    }
  }
})();
