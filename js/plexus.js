/* Animated "plexus" network background: glowing amber particles connected
   by lines that fade with distance, drifting slowly behind the hero content. */
(() => {
  'use strict';

  const canvases = document.querySelectorAll('.plexus-bg');
  if (!canvases.length) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DOT_RGB = '232,134,44';
  const LINE_RGB = '232,134,44';
  const LINK_DIST = 140;
  const SPEED = 0.15;

  canvases.forEach(initPlexus);

  function initPlexus(canvas) {
    const ctx = canvas.getContext('2d');
    const container = canvas.parentElement;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles = [];
    let animId = null;

    function particleCount() {
      const area = width * height;
      return Math.min(90, Math.max(28, Math.round(area / 14000)));
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
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedParticles();
    }

    function draw() {
      ctx.clearRect(0, 0, width, height);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
      });

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const a = particles[i];
          const b = particles[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < LINK_DIST) {
            ctx.strokeStyle = `rgba(${LINE_RGB},${(1 - dist / LINK_DIST) * 0.35})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      particles.forEach((p) => {
        ctx.beginPath();
        ctx.shadowColor = `rgba(${DOT_RGB},0.9)`;
        ctx.shadowBlur = 8;
        ctx.fillStyle = `rgba(${DOT_RGB},0.9)`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    }

    function step() {
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
