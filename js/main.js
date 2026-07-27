(() => {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------- Boot overlay ---------------------------- */
  // Runs once per tab session, echoes the plugin's own CRT power-on gesture.
  try {
    if (sessionStorage.getItem('creativeDistSiteIntroShown')) {
      document.body.classList.add('no-boot');
    } else {
      sessionStorage.setItem('creativeDistSiteIntroShown', '1');
    }
  } catch (err) {
    document.body.classList.add('no-boot');
  }

  /* ------------------------------ Smooth scroll -------------------------- */
  let lenis = null;
  if (!prefersReducedMotion && window.Lenis) {
    lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    function raf(time) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }
    requestAnimationFrame(raf);
  }

  /* --------------------------------- Header ------------------------------- */
  const header = document.getElementById('site-header');
  const navToggle = document.getElementById('nav-toggle');
  const siteNav = document.getElementById('site-nav');

  if (header) {
    const onScroll = () => {
      header.classList.toggle('scrolled', window.scrollY > 20);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  if (navToggle && siteNav) {
    navToggle.addEventListener('click', () => {
      const isOpen = siteNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });
    siteNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        siteNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------------------------- Plugin dropdown ---------------------------- */
  document.querySelectorAll('.nav-dropdown').forEach((dropdown) => {
    const trigger = dropdown.querySelector('.nav-dropdown-trigger');
    let closeTimer = null;

    const open = () => {
      clearTimeout(closeTimer);
      dropdown.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    };
    // Small grace period before closing so a mouse crossing the gap between
    // the trigger and the card (or briefly leaving) doesn't slam it shut.
    const scheduleClose = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        dropdown.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }, 300);
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdown.classList.contains('open') ? scheduleClose() : open();
    });
    dropdown.addEventListener('mouseenter', open);
    dropdown.addEventListener('mouseleave', scheduleClose);
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.nav-dropdown.open').forEach((dropdown) => {
      dropdown.classList.remove('open');
      dropdown.querySelector('.nav-dropdown-trigger').setAttribute('aria-expanded', 'false');
    });
  });

  /* ------------------------------ Scroll reveals -------------------------- */
  if (window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    if (lenis) {
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((time) => lenis.raf(time * 1000));
      gsap.ticker.lagSmoothing(0);
    }

    const groups = new Map();
    document.querySelectorAll('.reveal-up').forEach((el) => {
      const section = el.closest('section') || document.body;
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(el);
    });

    groups.forEach((els) => {
      gsap.set(els, { opacity: 0, y: 28 });
      gsap.to(els, {
        opacity: 1,
        y: 0,
        duration: 0.9,
        ease: 'power3.out',
        stagger: 0.08,
        scrollTrigger: {
          trigger: els[0].closest('section') || els[0],
          start: 'top 78%',
          once: true,
        },
      });
    });

    // Hero always plays immediately on load, not on scroll — only on pages
    // that actually have the full hero (product pages, not simple content pages).
    if (document.getElementById('hero')) {
      const heroEls = document.querySelectorAll('#hero .reveal-up');
      gsap.set(heroEls, { opacity: 0, y: 28 });
      gsap.to(heroEls, {
        opacity: 1,
        y: 0,
        duration: 1,
        ease: 'power3.out',
        stagger: 0.1,
        delay: prefersReducedMotion ? 0 : 0.7,
      });
    }

    // Subtle parallax drift on the hero glow.
    if (document.querySelector('.hero-glow')) {
      gsap.to('.hero-glow', {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true },
      });
    }
  } else {
    // Fallback: no animation library loaded, just show everything.
    document.querySelectorAll('.reveal-up').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
  }

  /* --------------------------------- Demo list ------------------------------ */
  // Only present on the Creative Dist product page. Each row is a fully
  // independent player — no shared "pick a track then hit play" step — but
  // only one plays at a time so they don't overlap.
  const demoRows = document.querySelectorAll('.demo-row');
  if (demoRows.length) {
    let activeRow = null;

    demoRows.forEach((row) => {
      const rowPlayBtn = row.querySelector('.demo-row-play');
      const iconPlay = row.querySelector('.icon-play');
      const iconPause = row.querySelector('.icon-pause');
      const audioDry = row.querySelector('.demo-row-audio-dry');
      const audioWet = row.querySelector('.demo-row-audio-wet');
      const toggleBtns = row.querySelectorAll('.demo-row-toggle-btn');
      const name = row.dataset.name || 'demo';

      let currentMode = 'wet';
      let isPlaying = false;

      const activeAudio = () => (currentMode === 'dry' ? audioDry : audioWet);
      const idleAudio = () => (currentMode === 'dry' ? audioWet : audioDry);

      function setMode(mode) {
        if (mode === currentMode) return;
        const wasPlaying = isPlaying;
        const t = activeAudio().currentTime;
        if (wasPlaying) activeAudio().pause();
        currentMode = mode;
        toggleBtns.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
        activeAudio().currentTime = t;
        if (wasPlaying) activeAudio().play().catch(() => {});
      }

      function stop() {
        activeAudio().pause();
        isPlaying = false;
        iconPlay.hidden = false;
        iconPause.hidden = true;
        row.classList.remove('is-playing');
        rowPlayBtn.setAttribute('aria-label', `Play ${name} demo`);
      }

      toggleBtns.forEach((btn) => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode));
      });

      rowPlayBtn.addEventListener('click', () => {
        if (isPlaying) {
          stop();
          activeRow = null;
          return;
        }
        if (activeRow && activeRow !== row) activeRow.dispatchEvent(new Event('cd:stop'));

        idleAudio().pause();
        activeAudio().play().catch(() => {});
        isPlaying = true;
        iconPlay.hidden = true;
        iconPause.hidden = false;
        row.classList.add('is-playing');
        rowPlayBtn.setAttribute('aria-label', `Pause ${name} demo`);
        activeRow = row;
      });

      row.addEventListener('cd:stop', stop);
      [audioDry, audioWet].forEach((audio) => audio.addEventListener('ended', stop));
    });
  }

  /* --------------------------------- Buy button ------------------------------ */
  // Only present on the Creative Dist product page.
  const buyButton = document.getElementById('buy-button');
  if (buyButton) {
    buyButton.addEventListener('click', async (e) => {
      e.preventDefault();
      const originalLabel = buyButton.textContent;
      buyButton.textContent = 'Redirecting to checkout…';
      buyButton.setAttribute('aria-disabled', 'true');

      try {
        const res = await fetch('/api/create-checkout-session', { method: 'POST' });
        if (!res.ok) throw new Error('Checkout session request failed');
        const { url } = await res.json();
        if (!url) throw new Error('No checkout URL returned');
        window.location.href = url;
      } catch (err) {
        console.error(err);
        buyButton.textContent = originalLabel;
        buyButton.removeAttribute('aria-disabled');
        alert('Checkout is not available right now — please try again in a moment.');
      }
    });
  }

  /* --------------------------- Header account status ------------------------ */
  // Swaps "Log in" for "My Account" if the visitor already has a session.
  const headerAccountLink = document.getElementById('header-account-link');
  if (headerAccountLink) {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          headerAccountLink.textContent = 'My Account';
          headerAccountLink.href = 'profile.html';
        }
      })
      .catch(() => {});
  }
})();
