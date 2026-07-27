/* Smooth, filled amber "skyline" background — a couple of soft layered
   waves drifting behind sections below the hero, gradient-filled so they
   read as glowing shapes rather than dry lines. */
(() => {
  'use strict';

  const canvases = document.querySelectorAll('.bars-bg');
  if (!canvases.length) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const LAYERS = [
    { amp: 0.22, base: 0.3, speed: 0.55, freq: 1.6, blur: 22, top: 'rgba(255,179,71,0.5)', bottom: 'rgba(232,134,44,0)' },
    { amp: 0.16, base: 0.18, speed: 0.35, freq: 2.3, blur: 14, top: 'rgba(255,140,0,0.4)', bottom: 'rgba(232,134,44,0)' },
    { amp: 0.1, base: 0.1, speed: 0.8, freq: 3.1, blur: 8, top: 'rgba(255,215,0,0.35)', bottom: 'rgba(232,134,44,0)' },
  ];

  canvases.forEach(initBars);

  function initBars(canvas) {
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let animId = null;
    let t = Math.random() * 100;
    const seeds = LAYERS.map(() => Math.random() * 1000);

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
    }

    function waveY(layer, seed, x) {
      const nx = x / width;
      const wobble =
        Math.sin(nx * Math.PI * layer.freq + t * layer.speed + seed) * 0.6 +
        Math.sin(nx * Math.PI * layer.freq * 1.9 + t * layer.speed * 1.3 + seed * 1.7) * 0.4;
      return height * (1 - layer.base - layer.amp * (0.5 + 0.5 * wobble));
    }

    function drawLayer(layer, seed) {
      const step = 14;
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let x = 0; x <= width; x += step) {
        ctx.lineTo(x, waveY(layer, seed, x));
      }
      ctx.lineTo(width, waveY(layer, seed, width));
      ctx.lineTo(width, height);
      ctx.closePath();

      const grad = ctx.createLinearGradient(0, height * (1 - layer.base - layer.amp), 0, height);
      grad.addColorStop(0, layer.top);
      grad.addColorStop(1, layer.bottom);
      ctx.fillStyle = grad;
      ctx.shadowColor = layer.top;
      ctx.shadowBlur = layer.blur;
      ctx.fill();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);
      LAYERS.forEach((layer, i) => drawLayer(layer, seeds[i]));
      ctx.shadowBlur = 0;
    }

    function step() {
      t += 0.006;
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
      resizeTimer = setTimeout(() => {
        resize();
        draw();
      }, 200);
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
      else start();
    });
  }
})();
