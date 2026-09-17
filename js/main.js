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

  /* --------------------------- Announcement ticker ------------------------ */
  // Each row ships with a handful of copies of the same item, which is only
  // ever enough to outrun very wide viewports by luck — on an ultra-wide or
  // 4K screen the row could run out before the -50% loop wrapped, leaving a
  // visible blank gap. Clone the row's own first item into itself until it's
  // comfortably wider than the viewport, so it always has enough copy to
  // loop seamlessly no matter the screen.
  document.querySelectorAll('.update-ticker-track').forEach((track) => {
    const rows = track.querySelectorAll('.update-ticker-row');
    if (rows.length < 2) return;
    const fill = () => {
      const target = window.innerWidth * 1.5;
      rows.forEach((row) => {
        const template = row.firstElementChild;
        if (!template) return;
        let guard = 0;
        while (row.scrollWidth < target && guard < 40) {
          row.appendChild(template.cloneNode(true));
          guard++;
        }
      });
    };
    fill();
    window.addEventListener('resize', fill);
  });

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

  /* ----------------------------- Code block copy ----------------------------- */
  document.querySelectorAll('.code-block-copy').forEach((btn) => {
    const code = btn.closest('.code-block').querySelector('code');
    if (!code) return;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        const original = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = original; }, 1800);
      } catch (err) {
        // Clipboard API unavailable (older browser, non-HTTPS, permission
        // denied) — the command is still fully selectable by hand.
      }
    });
  });

  /* ------------------------------- Plan selector ------------------------------- */
  // Pricing card's Full License / Demo radio pair — swaps which CTA shows
  // (Buy button vs the two OS demo links) instead of a separate dropdown.
  // The two candidates share one grid cell (.plan-cta-stack) so there's no
  // layout jump, but that also means a simultaneous cross-fade would show
  // them overlapping mid-transition — the solid Buy button ghosting through
  // the outlined demo-download cards, for instance. So the swap runs in two
  // steps instead: the outgoing CTA fades out completely first, and only
  // once that transition actually finishes (not a guessed timeout) does the
  // matching incoming CTA in that same stack get revealed and fade in.
  document.querySelectorAll('.plan-options').forEach((group) => {
    const card = group.closest('.pricing-card');
    if (!card) return;
    const options = [...group.querySelectorAll('.plan-option')];
    const ctas = [...card.querySelectorAll('[data-plan-cta]')];
    ctas.forEach((cta) => { if (cta.hidden) cta.classList.add('is-hiding'); });

    function revealCta(cta) {
      cta.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        cta.classList.remove('is-hiding');
      }));
    }

    options.forEach((opt) => {
      opt.addEventListener('click', () => {
        const plan = opt.dataset.plan;
        if (opt.classList.contains('plan-option-selected')) return;
        options.forEach((o) => {
          o.classList.toggle('plan-option-selected', o === opt);
          o.querySelector('input').checked = (o === opt);
        });
        ctas.forEach((cta) => {
          if (cta.dataset.planCta === plan || cta.hidden) return; // already the target, or already gone
          const stack = cta.closest('.plan-cta-stack') || card;
          const target = stack.querySelector(`[data-plan-cta="${plan}"]`);
          cta.classList.add('is-hiding');
          cta.addEventListener('transitionend', function onEnd(e) {
            if (e.propertyName !== 'opacity') return;
            cta.removeEventListener('transitionend', onEnd);
            cta.hidden = true;
            if (target) revealCta(target);
          });
        });
      });
    });
  });

  /* --------------------------------- Stories ---------------------------------- */
  // Every clip autoplays muted+looped so the marquee is always moving — a
  // video's src attaches lazily (just before it scrolls into view) so none
  // of the 8 clips downloads until it's actually about to be seen. Hovering
  // a card is what "plays" it visually (CSS scales it up over the rest);
  // right-clicking the hovered card toggles its sound, muting every other
  // card first so only one is ever audible.
  const storyCards = document.querySelectorAll('.story-card');
  const loadStory = (card) => {
    const video = card.querySelector('.story-video');
    if (video && !video.src) {
      video.src = video.dataset.src;
      video.play().catch(() => {});
    }
  };
  if (storyCards.length) {
    if (window.IntersectionObserver) {
      const lazyLoad = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          loadStory(entry.target);
          lazyLoad.unobserve(entry.target);
        });
      }, { rootMargin: '400px 200px' });
      storyCards.forEach((card) => lazyLoad.observe(card));
    } else {
      storyCards.forEach(loadStory);
    }

    storyCards.forEach((card) => {
      const video = card.querySelector('.story-video');
      if (!video) return;
      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const turningOn = video.muted;
        storyCards.forEach((other) => {
          const otherVideo = other.querySelector('.story-video');
          if (otherVideo) otherVideo.muted = true;
          other.classList.remove('is-unmuted');
        });
        if (turningOn) {
          video.muted = false;
          card.classList.add('is-unmuted');
        }
      });
    });
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
        }
      })
      .catch(() => {});
  }

  /* ------------------------- Require an account before buying ---------------- */
  // Guest checkout would leave a purchase with no site account attached, so
  // every Buy/Cart link is gated on being signed in first — that's the only
  // way a license reliably ends up tied to a profile instead of hoping the
  // buyer signs up afterwards with the exact same email. A fresh check runs
  // at click time (not cached from page load) so this can't go stale.
  document.querySelectorAll('a[href*="buy.stripe.com"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const target = a.href;
      fetch('/api/auth/me')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.email) {
            const url = new URL(target);
            url.searchParams.set('prefilled_email', data.email);
            window.location.href = url.toString();
          } else if (data) {
            window.location.href = target;
          } else {
            window.location.href = 'signup.html?next=' + encodeURIComponent(target);
          }
        })
        .catch(() => {
          // Can't confirm they're signed in — require an account rather
          // than silently letting a guest through to checkout.
          window.location.href = 'signup.html?next=' + encodeURIComponent(target);
        });
    });
  });

  /* ------------------------------- Site search -------------------------------- */
  // Lightweight client-side search over the site's own pages/sections — no
  // backend involved. The trigger button lives in every page's header; the
  // overlay itself is built once here and shared.
  const SEARCH_INDEX = [
    { name: 'Creative Dist', desc: 'Modular distortion plugin — overview & pricing', url: 'index.html' },
    { name: 'Saturation', desc: '14 distortion algorithms, one input', url: 'index.html#saturation' },
    { name: 'Noise', desc: 'Procedural noise layered under your signal', url: 'index.html#noise' },
    { name: 'Bode Shifter', desc: 'Frequency shifting for otherworldly motion', url: 'index.html#bode' },
    { name: 'EQ', desc: '5-band dual EQ', url: 'index.html#eq' },
    { name: 'Output', desc: 'Final gain stage', url: 'index.html#output' },
    { name: 'Pricing', desc: 'Buy Creative Dist', url: 'index.html#pricing' },
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
      document.body.classList.add('search-open');
      input.value = '';
      runSearch('');
      requestAnimationFrame(() => input.focus());
    }
    function closeSearch() {
      overlay.classList.remove('open');
      document.body.classList.remove('search-open');
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

  /* -------------------------- Pack sound picker ----------------------------- */
  // Each tile carries its own preview clip in data-audio. One shared Audio
  // instance is reused across tiles — selecting a tile stops whatever else
  // is playing and starts its clip; the clip ending (or re-tapping the
  // active tile) resets the UI the same way a manual pause would.
  const soundPicker = document.querySelector('.pack-sound-picker');
  if (soundPicker) {
    const tiles = soundPicker.querySelectorAll('.pack-sound-tile');
    const player = new Audio();

    function deactivateAll() {
      tiles.forEach((t) => t.classList.remove('is-active'));
      soundPicker.classList.remove('has-active');
    }

    player.addEventListener('ended', deactivateAll);

    tiles.forEach((tile) => {
      const src = tile.dataset.audio;
      tile.addEventListener('click', () => {
        const wasActive = tile.classList.contains('is-active');
        player.pause();
        deactivateAll();
        if (wasActive) return;
        if (src) {
          player.src = src;
          player.currentTime = 0;
          player.play().catch(() => {});
        }
        tile.classList.add('is-active');
        soundPicker.classList.add('has-active');
      });
    });
  }
})();
