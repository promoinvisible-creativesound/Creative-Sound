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

  /* ----------------------------- Demo download ----------------------------- */
  // Click-triggered OS chooser next to the Buy buttons — not hover-based like
  // the nav dropdown, since this sits in page content rather than the header.
  document.querySelectorAll('.demo-download').forEach((picker) => {
    const trigger = picker.querySelector('.demo-download-trigger');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = picker.classList.contains('open');
      document.querySelectorAll('.demo-download.open').forEach((other) => {
        other.classList.remove('open');
        other.querySelector('.demo-download-trigger').setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        picker.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      }
    });
  });
  document.addEventListener('click', () => {
    document.querySelectorAll('.demo-download.open').forEach((picker) => {
      picker.classList.remove('open');
      picker.querySelector('.demo-download-trigger').setAttribute('aria-expanded', 'false');
    });
  });

  /* -------------------------------- Side rail nav ---------------------------- */
  // Only present on the Creative Dist product page. Always visible, plain
  // text links — highlights whichever section is currently in view.
  const sideRail = document.querySelector('.side-rail');
  if (sideRail && window.IntersectionObserver) {
    const railLinks = sideRail.querySelectorAll('.side-rail-link');
    const sections = Array.from(railLinks)
      .map((link) => document.getElementById(link.dataset.section))
      .filter(Boolean);

    railLinks.forEach((link) => {
      link.addEventListener('click', (e) => {
        const section = document.getElementById(link.dataset.section);
        if (section) {
          e.preventDefault();
          // Center the section's graphic (or the whole section, for rows
          // without one) in the viewport instead of the browser default of
          // snapping its top edge to the top of the screen.
          const focusEl = section.querySelector('.feature-visual') || section;
          const rect = focusEl.getBoundingClientRect();
          const targetY = Math.max(0, window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2);
          if (lenis) {
            lenis.scrollTo(targetY, { duration: 1.1 });
          } else {
            window.scrollTo({ top: targetY, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
          }
          history.pushState(null, '', `#${link.dataset.section}`);
        }
        railLinks.forEach((l) => l.classList.toggle('active', l === link));
      });
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          railLinks.forEach((link) => {
            link.classList.toggle('active', link.dataset.section === entry.target.id);
          });
        });
      },
      { rootMargin: '-45% 0px -45% 0px' }
    );
    sections.forEach((section) => observer.observe(section));
  }

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

    // Deterministic pseudo-random bar heights (0..1) per track name, smoothed
    // so it reads like a real waveform rather than noise.
    function waveHeights(seed, n) {
      let s = 0;
      for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
      const rand = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      const raw = [];
      for (let i = 0; i < n; i++) raw.push(0.12 + rand() * 0.88);
      return raw.map((v, i) => {
        const prev = raw[i - 1] ?? v;
        const next = raw[i + 1] ?? v;
        return (prev + v * 2 + next) / 4;
      });
    }

    function drawWave(canvas, heights, progress) {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = window.devicePixelRatio || 1;
      const w = rect.width, h = rect.height;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const n = heights.length;
      const gap = 2;
      const barW = Math.max(1.5, (w - gap * (n - 1)) / n);
      const mid = h / 2;
      const playedBars = Math.round(progress * n);
      for (let i = 0; i < n; i++) {
        const barH = Math.max(2, heights[i] * h);
        const x = i * (barW + gap);
        const y = mid - barH / 2;
        ctx.fillStyle = i < playedBars ? '#FFD700' : 'rgba(232,134,44,0.32)';
        if (ctx.roundRect) {
          ctx.beginPath();
          ctx.roundRect(x, y, barW, barH, barW / 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, barW, barH);
        }
      }
    }

    demoRows.forEach((row) => {
      const rowPlayBtn = row.querySelector('.demo-row-play');
      const iconPlay = row.querySelector('.icon-play');
      const iconPause = row.querySelector('.icon-pause');
      const audioDry = row.querySelector('.demo-row-audio-dry');
      const audioWet = row.querySelector('.demo-row-audio-wet');
      const toggleBtns = row.querySelectorAll('.demo-row-toggle-btn');
      const canvas = row.querySelector('.demo-row-waveform');
      const name = row.dataset.name || 'demo';
      const heights = waveHeights(name, 64);

      let currentMode = 'wet';
      let isPlaying = false;

      const activeAudio = () => (currentMode === 'dry' ? audioDry : audioWet);
      const idleAudio = () => (currentMode === 'dry' ? audioWet : audioDry);

      function redraw() {
        const audio = activeAudio();
        const progress = isPlaying && audio.duration ? audio.currentTime / audio.duration : 0;
        drawWave(canvas, heights, progress);
      }

      row._cdRedraw = redraw;
      redraw();
      if (window.ResizeObserver) new ResizeObserver(redraw).observe(canvas);

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
        redraw();
      }

      function seekTo(ratio) {
        const audio = activeAudio();
        const apply = () => { if (audio.duration) audio.currentTime = ratio * audio.duration; redraw(); };
        if (audio.readyState >= 1) apply();
        else audio.addEventListener('loadedmetadata', apply, { once: true });
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

      canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        if (!isPlaying) rowPlayBtn.click();
        seekTo(ratio);
      });

      row.addEventListener('cd:stop', stop);
      [audioDry, audioWet].forEach((audio) => audio.addEventListener('ended', stop));
    });

    (function tick() {
      if (activeRow && activeRow._cdRedraw) activeRow._cdRedraw();
      requestAnimationFrame(tick);
    })();
  }

  /* --------------------------- Header account status ------------------------ */
  // Points the fixed account icon at the profile page (and labels it with
  // the visitor's name) once we know they already have a session.
  const headerAccountLink = document.getElementById('header-account-link');
  if (headerAccountLink) {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          headerAccountLink.href = 'profile.html';
          headerAccountLink.setAttribute('aria-label', data.firstName ? `Account — ${data.firstName}` : 'My Account');
          headerAccountLink.title = data.firstName || 'My Account';

          // Prefill the Stripe checkout email for signed-in visitors so the
          // purchase lands on the same email their license lookup uses.
          if (data.email) {
            document.querySelectorAll('a[href*="buy.stripe.com"]').forEach((a) => {
              const url = new URL(a.href);
              url.searchParams.set('prefilled_email', data.email);
              a.href = url.toString();
            });
          }
        }
      })
      .catch(() => {});
  }

  /* ------------------------------- Site search -------------------------------- */
  // Lightweight client-side search over the site's own pages/sections — no
  // backend involved. The trigger button lives in every page's header; the
  // overlay itself is built once here and shared.
  const SEARCH_INDEX = [
    { name: 'Creative Dist', desc: 'Modular distortion plugin — overview & pricing', url: 'creative-dist.html' },
    { name: 'Saturation', desc: '14 distortion algorithms, one input', url: 'creative-dist.html#saturation' },
    { name: 'Noise', desc: 'Procedural noise layered under your signal', url: 'creative-dist.html#noise' },
    { name: 'Bode Shifter', desc: 'Frequency shifting for otherworldly motion', url: 'creative-dist.html#bode' },
    { name: 'EQ', desc: '5-band dual EQ', url: 'creative-dist.html#eq' },
    { name: 'Output', desc: 'Final gain stage', url: 'creative-dist.html#output' },
    { name: 'Hear it in action', desc: 'Audio demos for each module', url: 'creative-dist.html#demo' },
    { name: 'Compatibility', desc: 'VST3 / AU, macOS / Windows', url: 'creative-dist.html#compatibility' },
    { name: 'Pricing', desc: 'Buy Creative Dist', url: 'creative-dist.html#pricing' },
    { name: 'Support / Tickets', desc: 'Open or check a support ticket', url: 'profile-tickets.html' },
    { name: 'Your account', desc: 'License, orders, tickets, settings', url: 'profile.html' },
    { name: 'License & Download', desc: 'Your license key and download links', url: 'profile-license.html' },
    { name: 'Order history', desc: 'Your past purchases', url: 'profile-orders.html' },
    { name: 'Account settings', desc: 'Name and password', url: 'profile-settings.html' },
    { name: 'Work with us', desc: 'Apply to join Creative Sound', url: 'work-with-us.html' },
    { name: 'About', desc: 'Who we are', url: 'about.html' },
    { name: 'Contact', desc: 'Get in touch', url: 'contact.html' },
    { name: 'Refund policy', desc: 'How refunds work', url: 'refund.html' },
    { name: 'Privacy policy', desc: 'How we handle your data', url: 'privacy.html' },
    { name: 'Log in', desc: 'Sign in to your account', url: 'login.html' },
    { name: 'Create account', desc: 'Sign up for Creative Sound', url: 'signup.html' },
  ];

  const searchBtn = document.getElementById('header-search-btn');
  if (searchBtn) {
    const overlay = document.createElement('div');
    overlay.className = 'site-search-overlay';
    overlay.innerHTML = `
      <div class="site-search-panel" role="dialog" aria-modal="true" aria-label="Search the site">
        <div class="site-search-field">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7"></circle>
            <path d="M21 21l-4.3-4.3"></path>
          </svg>
          <input type="text" placeholder="Search plugins, support, pages…" autocomplete="off" spellcheck="false">
          <button type="button" class="site-search-close">ESC</button>
        </div>
        <div class="site-search-results"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('input');
    const resultsEl = overlay.querySelector('.site-search-results');
    const closeBtn = overlay.querySelector('.site-search-close');
    let activeIndex = -1;
    let currentResults = [];

    function renderResults(items) {
      currentResults = items;
      activeIndex = items.length ? 0 : -1;
      if (!items.length) {
        resultsEl.innerHTML = '<p class="site-search-empty">No matches — try Creative Dist, support or pricing.</p>';
        return;
      }
      resultsEl.innerHTML = items.map((item, i) => `
        <button type="button" class="site-search-result${i === 0 ? ' active' : ''}" data-url="${item.url}">
          <span class="site-search-result-name">${item.name}</span>
          <span class="site-search-result-desc">${item.desc}</span>
        </button>
      `).join('');
    }

    function runSearch(query) {
      const q = query.trim().toLowerCase();
      const items = q
        ? SEARCH_INDEX.filter((item) => item.name.toLowerCase().includes(q) || item.desc.toLowerCase().includes(q))
        : SEARCH_INDEX;
      renderResults(items.slice(0, 8));
    }

    function setActive(index) {
      const buttons = resultsEl.querySelectorAll('.site-search-result');
      buttons.forEach((b) => b.classList.remove('active'));
      if (buttons[index]) {
        buttons[index].classList.add('active');
        activeIndex = index;
      }
    }

    function openSearch() {
      overlay.classList.add('open');
      input.value = '';
      runSearch('');
      requestAnimationFrame(() => input.focus());
    }
    function closeSearch() {
      overlay.classList.remove('open');
      searchBtn.focus();
    }

    searchBtn.addEventListener('click', openSearch);
    closeBtn.addEventListener('click', closeSearch);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSearch();
    });
    input.addEventListener('input', () => runSearch(input.value));
    resultsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.site-search-result');
      if (btn && btn.dataset.url) window.location.href = btn.dataset.url;
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        overlay.classList.contains('open') ? closeSearch() : openSearch();
        return;
      }
      if (!overlay.classList.contains('open')) return;
      if (e.key === 'Escape') {
        closeSearch();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(Math.min(activeIndex + 1, currentResults.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(Math.max(activeIndex - 1, 0));
      } else if (e.key === 'Enter') {
        const target = currentResults[activeIndex];
        if (target) window.location.href = target.url;
      }
    });
  }

  /* ------------------------------- Video lightbox ----------------------------- */
  // Powers any .video-card on the page (currently the tutorial listing).
  // data-video holds an embed URL; when it's empty the lightbox shows a
  // "coming soon" placeholder instead, so real links can be dropped in later
  // without touching markup or layout.
  const videoCards = document.querySelectorAll('.video-card');
  if (videoCards.length) {
    const lightbox = document.createElement('div');
    lightbox.className = 'video-lightbox';
    lightbox.innerHTML = `
      <div class="video-lightbox-panel" role="dialog" aria-modal="true">
        <button type="button" class="video-lightbox-close">ESC</button>
        <div class="video-lightbox-body"></div>
      </div>
    `;
    document.body.appendChild(lightbox);

    const lightboxBody = lightbox.querySelector('.video-lightbox-body');
    const lightboxClose = lightbox.querySelector('.video-lightbox-close');

    function openVideo(url, title) {
      lightboxBody.innerHTML = url
        ? `<iframe src="${url}" title="${title || 'Tutorial video'}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
        : '<div class="video-lightbox-empty">Video coming soon.</div>';
      lightbox.classList.add('open');
    }
    function closeVideo() {
      lightbox.classList.remove('open');
      lightboxBody.innerHTML = '';
    }

    videoCards.forEach((card) => {
      card.addEventListener('click', () => openVideo(card.dataset.video, card.dataset.title));
    });
    lightboxClose.addEventListener('click', closeVideo);
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) closeVideo();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('open')) closeVideo();
    });
  }
})();
