/* Animated amber "equalizer" bars background — a skyline of glowing bars
   pulsing at different speeds, for sections below the hero. */
(() => {
  'use strict';

  const canvases = document.querySelectorAll('.bars-bg');
  if (!canvases.length) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const BAR_WIDTH = 2;
  const GAP = 26;

  canvases.forEach(initBars);

  function initBars(canvas) {
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let bars = [];
    let animId = null;
    let t = Math.random() * 100;

    function seedBars() {
      const count = Math.max(1, Math.floor(width / (BAR_WIDTH + GAP)));
      bars = Array.from({ length: count }, (_, i) => ({
        x: i * (BAR_WIDTH + GAP) + GAP / 2,
        base: 0.08 + Math.random() * 0.14,
        amp: 0.08 + Math.random() * 0.2,
        speed: 0.3 + Math.random() * 0.6,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    function resize() {
      const rect = container.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedBars();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      bars.forEach((b) => {
        const h = (b.base + b.amp * (0.5 + 0.5 * Math.sin(t * b.speed + b.phase))) * height;
        const y = height - h;
        // Thin outline + a slightly brighter tip, no fill/glow — a flatter,
        // more geometric read than a solid glowing bar.
        ctx.strokeStyle = 'rgba(232,134,44,0.28)';
        ctx.lineWidth = BAR_WIDTH;
        ctx.beginPath();
        ctx.moveTo(b.x + BAR_WIDTH / 2, height);
        ctx.lineTo(b.x + BAR_WIDTH / 2, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,179,71,0.55)';
        ctx.fillRect(b.x, y - 1, BAR_WIDTH, 2);
      });
    }

    function step() {
      t += 0.016;
      draw();
      animId = requestAnimationFrame(step);
    }

    function start() {
      if (animId || prefersReducedMotion) return;
      step();
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
      resizeTimer = setTimeout(resize, 200);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });
  }
})();
