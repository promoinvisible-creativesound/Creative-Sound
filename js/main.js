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
      document.body.classList.toggle('nav-open', isOpen);
      if (lenis) { if (isOpen) lenis.stop(); else lenis.start(); }
    });
    siteNav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        siteNav.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-open');
        if (lenis) lenis.start();
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

    card.dataset.plan = (group.querySelector('.plan-option-selected') || options[0]).dataset.plan;

    options.forEach((opt) => {
      opt.addEventListener('click', () => {
        const plan = opt.dataset.plan;
        if (opt.classList.contains('plan-option-selected')) return;
        card.dataset.plan = plan;
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

  // "Try the free demo" links (hero, closing CTA) jump to the pricing card
  // with the Demo option already picked, so the download buttons are the
  // first thing in view instead of the Buy button. Same for a #demo URL.
  const selectPlan = (plan) => {
    const opt = document.querySelector(`.plan-option[data-plan="${plan}"]`);
    if (opt) opt.click();
  };
  document.querySelectorAll('[data-select-plan]').forEach((link) => {
    link.addEventListener('click', () => selectPlan(link.dataset.selectPlan));
  });
  if (location.hash === '#demo') {
    selectPlan('demo');
    const pricing = document.getElementById('pricing');
    if (pricing) pricing.scrollIntoView();
  }

  /* ------------------------------ Signal chain ------------------------------- */
  // Explainer for "4 reorderable slots": every few seconds two neighbouring
  // modules trade places. FLIP: move the chips in the DOM, then animate each
  // from where it was to where it now is, so it works the same in the
  // horizontal (desktop) and vertical (phone) layouts. Only runs while the
  // diagram is on screen and the tab is visible; static with reduced motion.
  const chainSlots = [...document.querySelectorAll('.chain-slot')];
  if (chainSlots.length > 1 && !prefersReducedMotion && 'IntersectionObserver' in window) {
    const SWAP_MS = 520;
    const PAUSE_MS = 2200;
    let visible = false;
    let timer = null;
    let busy = false;
    let lastPair = -1;

    const swap = () => {
      timer = null;
      if (!visible || document.hidden) return;
      busy = true;
      let i;
      do { i = Math.floor(Math.random() * (chainSlots.length - 1)); } while (i === lastPair && chainSlots.length > 2);
      lastPair = i;
      const a = chainSlots[i].querySelector('.chain-chip');
      const b = chainSlots[i + 1].querySelector('.chain-chip');
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      chainSlots[i].appendChild(b);
      chainSlots[i + 1].appendChild(a);
      const timing = { duration: SWAP_MS, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' };
      [[a, ra], [b, rb]].forEach(([chip, from]) => {
        const to = chip.getBoundingClientRect();
        chip.classList.add('is-moving');
        chip.animate(
          [{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }],
          timing
        ).finished.then(() => chip.classList.remove('is-moving'), () => chip.classList.remove('is-moving'));
      });
      setTimeout(() => { busy = false; schedule(); }, SWAP_MS);
    };
    const schedule = () => {
      if (timer || busy || !visible || document.hidden) return;
      timer = setTimeout(swap, PAUSE_MS);
    };
    const stop = () => { clearTimeout(timer); timer = null; };

    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule(); else stop();
    }, { threshold: 0.4 }).observe(document.querySelector('.chain'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else schedule(); });
  }

  /* --------------------------- Demo download state --------------------------- */
  // A 7–11 MB zip gives no sign of life on click, so the button's format
  // label reads "Download started ✓" for a few seconds, then swaps back.
  document.querySelectorAll('.demo-download-link').forEach((link) => {
    const fmt = link.querySelector('.demo-download-fmt');
    if (!fmt) return;
    const original = fmt.textContent;
    let resetTimer = null;
    const setLabel = (text, started) => {
      fmt.classList.add('is-swapping');
      setTimeout(() => {
        fmt.textContent = text;
        link.classList.toggle('is-started', started);
        fmt.classList.remove('is-swapping');
      }, 120);
    };
    link.addEventListener('click', () => {
      clearTimeout(resetTimer);
      setLabel('Download started ✓', true);
      resetTimer = setTimeout(() => setLabel(original, false), 3500);
    });
  });

  /* --------------------------------- Stories ---------------------------------- */
  // Every clip autoplays muted+looped so the marquee is always moving — a
  // video's src attaches lazily (just before it scrolls into view) so none
  // of the 8 clips downloads until it's actually about to be seen. Hovering
  // a card is what "plays" it visually (CSS scales it up over the rest);
  // tapping a card's speaker icon toggles its sound, muting every other
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
      const soundBtn = card.querySelector('.story-sound');
      if (!video || !soundBtn) return;
      soundBtn.addEventListener('click', (e) => {
        e.stopPropagation();
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
      if (el.closest('#hero')) return; // the hero has its own entrance below
      const section = el.closest('section') || document.body;
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(el);
    });

    // Short and small on purpose: ~10 sections reveal on the way down, so a
    // long rise turns into waiting. 0.6s / 16px reads as "arriving", not
    // as a performance.
    const sectionReveals = new Map();
    groups.forEach((els, section) => {
      gsap.set(els, { opacity: 0, y: 16 });
      const tween = gsap.to(els, {
        opacity: 1,
        y: 0,
        duration: 0.6,
        ease: 'power3.out',
        stagger: 0.06,
        scrollTrigger: {
          trigger: els[0].closest('section') || els[0],
          start: 'top 82%',
          once: true,
        },
      });
      sectionReveals.set(section, tween);
    });

    // Landing on a section through a link ("Free demo" -> #pricing, a #demo
    // URL, the nav) shows it at once instead of leaving it blank until the
    // next scroll event wakes ScrollTrigger up.
    const revealNow = (hash) => {
      const target = hash && hash.length > 1 && document.getElementById(hash.slice(1));
      const section = target && (target.closest('section') || target);
      const tween = section && sectionReveals.get(section);
      if (tween) tween.progress(1);
    };
    revealNow(location.hash === '#demo' ? '#pricing' : location.hash);
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href^="#"]');
      if (link) revealNow(link.getAttribute('href'));
    });

    // Hero always plays on load, not on scroll — only on pages that actually
    // have the full hero. On the home page it waits for the boot intro to
    // clear (inline script in index.html fires "boot:done"), otherwise it
    // would play underneath the overlay and nobody would ever see it.
    if (document.getElementById('hero')) {
      const heroEls = document.querySelectorAll('#hero .reveal-up');
      gsap.set(heroEls, { opacity: 0, y: 16 });
      const heroIn = gsap.to(heroEls, {
        opacity: 1,
        y: 0,
        duration: 0.7,
        ease: 'power3.out',
        stagger: 0.07,
        paused: true,
      });
      const bootOverlay = document.getElementById('boot-overlay');
      if (!bootOverlay || prefersReducedMotion || window.__bootDone) {
        heroIn.play();
      } else {
        // Starts while the overlay is still fading (0.5s), so the two overlap.
        document.addEventListener('boot:done', () => gsap.delayedCall(0.15, () => heroIn.play()), { once: true });
        setTimeout(() => { if (!heroIn.isActive() && heroIn.progress() === 0) heroIn.play(); }, 7000);
      }
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
  // The same request is shared with js/header-menu.js through window.csMe.
  window.csMe = fetch('/api/auth/me')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  // New features are open to everyone. If the server is put back in private
  // preview (PREVIEW_LOCK=1) it answers preview:false for other accounts and
  // css/style.css hides their links again.
  document.documentElement.classList.add('is-preview');
  window.csPreview = window.csMe.then((me) => !(me && me.preview === false));
  window.csPreview.then((on) => { if (!on) document.documentElement.classList.remove('is-preview'); });
  const headerAccountLink = document.getElementById('header-account-link');
  if (headerAccountLink) {
    window.csMe
      .then((data) => {
        if (data) {
          headerAccountLink.href = 'profile.html';
          headerAccountLink.setAttribute('aria-label', data.firstName ? `Account — ${data.firstName}` : 'My Account');
          headerAccountLink.title = data.firstName || 'My Account';
        }
      })
      .catch(() => {});
  }

  /* --------------------------- Footer on phones ----------------------------- */
  // Product / Company / Legal collapse into tappable rows on small screens
  // (css/style.css shows the chevron and hides the links until opened).
  document.querySelectorAll('#site-footer .footer-col:not(.footer-col-brand) .footer-col-title').forEach((title) => {
    const col = title.parentElement;
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-expanded', 'false');
    title.insertAdjacentHTML('beforeend', '<svg class="footer-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>');
    const toggle = () => {
      const open = col.classList.toggle('is-open');
      title.setAttribute('aria-expanded', String(open));
    };
    title.addEventListener('click', toggle);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  /* ------------------------------ Click tracking ----------------------------- */
  // Vercel Web Analytics custom events for the clicks that matter: Buy, free
  // demo, demo download, pack download and pack preview. window.va queues
  // calls until /_vercel/insights/script.js has loaded. Custom events only
  // show up on a Vercel plan that includes them; otherwise they're dropped.
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  const track = (name, data) => { try { window.va('event', { name, data }); } catch (e) {} };
  const pageName = location.pathname.replace(/^\/|\.html$/g, '') || 'home';
  document.addEventListener('click', (e) => {
    const el = e.target.closest('a, button');
    if (!el) return;
    const href = el.getAttribute('href') || '';
    const where = (el.closest('section[id]') && el.closest('section[id]').id) || (el.closest('header') ? 'header' : el.closest('footer') ? 'footer' : 'page');
    if (href.includes('client_reference_id=creative-presets')) {
      track('Pack download', { pack: href.includes('vol-2') ? 'Creative Presets Vol. 2' : 'Creative Presets', page: pageName });
    } else if (href.includes('buy.stripe.com')) {
      track('Buy click', { page: pageName, where });
    } else if (el.classList.contains('demo-download-link')) {
      track('Demo download', { os: href.includes('Windows') ? 'Windows' : 'macOS', page: pageName });
    } else if (el.dataset.selectPlan === 'demo' || href.endsWith('#demo')) {
      track('Free demo click', { page: pageName, where });
    } else if (el.classList.contains('pk-play') && el.getAttribute('aria-pressed') !== 'true') {
      track('Pack preview play', { pack: (el.getAttribute('aria-label') || '').replace(/^Play the | demo$/g, '') });
    }
  }, true);

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
  // Spotlight-style search over the site's pages, plugin features and the
  // live track catalogue (titles, producers, genres, moods). Built once,
  // opened from the header button or Ctrl/Cmd+K.
  const SEARCH_INDEX = [
    { name: 'Creative Dist 2.0', desc: 'Modular distortion plugin, overview and pricing', url: 'creative-dist-2', group: 'Plugin', icon: 'plugin' },
    { name: 'Saturation', desc: '18 saturation modes', url: 'creative-dist-2#saturation', group: 'Plugin', icon: 'plugin' },
    { name: 'Noise', desc: 'Procedural noise layered under your signal', url: 'creative-dist-2#noise', group: 'Plugin', icon: 'plugin' },
    { name: 'Bode Shifter', desc: 'Frequency shifting with Key Follow', url: 'creative-dist-2#bode', group: 'Plugin', icon: 'plugin' },
    { name: 'Flux', desc: 'New in 2.0: morphs between two of nine algorithms', url: 'creative-dist-2#flux', group: 'Plugin', icon: 'plugin' },
    { name: 'Equalizer', desc: '5-band EQ, Pre/Post, Linear Phase', url: 'creative-dist-2#eq', group: 'Plugin', icon: 'plugin' },
    { name: 'Output', desc: 'Auto Gain, Input Gain, Level, Soft Clip', url: 'creative-dist-2#output', group: 'Plugin', icon: 'plugin' },
    { name: 'Pricing', desc: 'Buy Creative Dist 2.0 or get the free demo', url: 'creative-dist-2#pricing', group: 'Plugin', icon: 'plugin' },
    { name: 'Tutorial', desc: 'Learn Creative Dist step by step', url: 'tutorial.html', group: 'Plugin', icon: 'play' },
    { name: 'Home', desc: 'Plugins, sound packs and tracks', url: '/', group: 'Pages', icon: 'home' },
    { name: 'Track Store', desc: 'License tracks: MP3, WAV, stems, project files', url: 'beats.html', group: 'Pages', icon: 'music' },
    { name: 'Sound packs', desc: 'Free Serum preset packs', url: 'packs.html', group: 'Pages', icon: 'box' },
    { name: 'Sell your tracks', desc: 'Upload as a producer and keep 80% of each sale', url: 'signup.html?role=producer', group: 'Pages', icon: 'upload' },
    { name: 'FAQ', desc: 'Answers to common questions', url: 'faq.html', group: 'Help', icon: 'help' },
    { name: 'Support', desc: 'Open or check a support request', url: 'profile-tickets.html', group: 'Help', icon: 'help' },
    { name: 'Contact', desc: 'Get in touch', url: 'contact.html', group: 'Help', icon: 'mail' },
    { name: 'Refund policy', desc: 'How refunds work', url: 'refund.html', group: 'Help', icon: 'doc' },
    { name: 'Privacy policy', desc: 'How we handle your data', url: 'privacy.html', group: 'Help', icon: 'doc' },
    { name: 'Your account', desc: 'Profile, orders, downloads, settings', url: 'profile.html', group: 'Account', icon: 'user' },
    { name: 'Licenses & downloads', desc: 'Your license keys and files', url: 'profile-license.html', group: 'Account', icon: 'key' },
    { name: 'Orders', desc: 'Everything you bought', url: 'profile-orders.html', group: 'Account', icon: 'box' },
    { name: 'Saved tracks', desc: 'Tracks you saved with the heart', url: 'profile-saved.html', group: 'Account', icon: 'heart' },
    { name: 'Settings', desc: 'Name, account type and password', url: 'profile-settings.html', group: 'Account', icon: 'gear' },
    { name: 'Producer area', desc: 'Your uploads and payouts', url: 'profile-producer.html', group: 'Account', icon: 'upload' },
    { name: 'Work with us', desc: 'Apply to join Creative Sound', url: 'work-with-us.html', group: 'Pages', icon: 'doc' },
    { name: 'About', desc: 'Who we are', url: 'about.html', group: 'Pages', icon: 'doc' },
    { name: 'Log in', desc: 'Sign in to your account', url: 'login.html', group: 'Account', icon: 'user' },
    { name: 'Create account', desc: 'Sign up for Creative Sound', url: 'signup.html', group: 'Account', icon: 'user' },
  ];
  const QUICK = [
    { name: 'Creative Dist 2.0', url: 'creative-dist-2' },
    { name: 'Track Store', url: 'beats.html' },
    { name: 'Sound packs', url: 'packs.html' },
    { name: 'Support', url: 'profile-tickets.html' },
  ];
  const GROUP_ORDER = ['Track Store', 'Plugin', 'Pages', 'Help', 'Account'];
  const SI = {
    plugin: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="12" r="2.2"/><circle cx="15.5" cy="12" r="2.2"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z"/>',
    home: '<path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
    box: '<path d="M4 7.5L12 3l8 4.5v9L12 21l-8-4.5z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.3"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6 8.5-6"/>',
    doc: '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.2a7.5 7.5 0 0 1 15 0"/>',
    key: '<circle cx="7.5" cy="15.5" r="3.5"/><path d="M10 13l9-9M15.5 7.5l2.5 2.5"/>',
    heart: '<path d="M12 20.3l-1.3-1.2C5.8 14.7 3 12.1 3 8.9 3 6.3 5 4.3 7.6 4.3c1.5 0 2.9.7 3.8 1.8h1.2c.9-1.1 2.3-1.8 3.8-1.8C19 4.3 21 6.3 21 8.9c0 3.2-2.8 5.8-7.7 10.2z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  };
  const sEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sIcon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${SI[k] || SI.doc}</svg>`;

  const searchBtn = document.getElementById('header-search-btn');
  if (searchBtn) {
    const overlay = document.createElement('div');
    overlay.className = 'site-search-overlay';
    overlay.innerHTML = `
      <div class="site-search-panel" role="dialog" aria-modal="true" aria-label="Search the site">
        <div class="site-search-field">
          ${sIcon('search')}
          <input type="search" placeholder="Search tracks, plugins, help…" aria-label="Search the site" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="site-search-results">
          <button type="button" class="site-search-close" aria-label="Close search">Cancel</button>
        </div>
        <div class="site-search-results" id="site-search-results" role="listbox"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('input');
    const resultsEl = overlay.querySelector('.site-search-results');
    const closeBtn = overlay.querySelector('.site-search-close');
    let activeIndex = -1;
    let currentResults = [];
    let tracks = null; // loaded on first open

    const loadTracks = () => {
      if (tracks) return;
      tracks = [];
      const toItems = (data) => (data.beats || []).filter((b) => b.status !== 'hidden').map((b) => ({
        name: b.title,
        desc: [b.producer, b.genre, b.bpm ? `${b.bpm} BPM` : '', b.key].filter(Boolean).join(' · '),
        hay: [b.title, b.producer, b.genre, b.mood, b.key, b.typeBeat, ...(b.tags || [])].join(' ').toLowerCase(),
        url: b.source === 'producer' ? `track.html?id=${encodeURIComponent(b.id)}` : `beats/${encodeURIComponent(b.id)}.html`,
        cover: b.cover || '', group: 'Track Store', icon: 'music',
      }));
      fetch('/api/beats/catalogue').then((r) => (r.ok ? r.json() : Promise.reject()))
        .catch(() => fetch('data/beats.json').then((r) => r.json()))
        .then((d) => { tracks = toItems(d); if (overlay.classList.contains('open') && input.value.trim()) runSearch(input.value); })
        .catch(() => {});
    };

    const rowHtml = (item, i) => `
      <button type="button" class="site-search-result${i === 0 ? ' active' : ''}" role="option" data-i="${i}" data-url="${sEsc(item.url)}">
        ${item.cover ? `<img class="ss-art" src="${sEsc(item.cover)}" alt="" loading="lazy">` : `<span class="ss-tile">${sIcon(item.icon)}</span>`}
        <span class="ss-text"><span class="site-search-result-name">${sEsc(item.name)}</span><span class="site-search-result-desc">${sEsc(item.desc)}</span></span>
        <svg class="ss-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>
      </button>`;

    function renderResults(items, q) {
      currentResults = items;
      activeIndex = items.length ? 0 : -1;
      if (!items.length) {
        resultsEl.innerHTML = `<div class="site-search-empty"><b>No results for “${sEsc(q)}”</b><span>Try a track name, a genre like trap, or “support”.</span></div>`;
        return;
      }
      let i = 0;
      const groups = GROUP_ORDER.map((g) => [g, items.filter((it) => it.group === g)]).filter(([, list]) => list.length);
      currentResults = groups.flatMap(([, list]) => list);
      resultsEl.innerHTML = groups.map(([g, list]) => `<p class="ss-group">${g}</p>${list.map((it) => rowHtml(it, i++)).join('')}`).join('');
    }

    function renderHome() {
      currentResults = SEARCH_INDEX.filter((it) => ['Home', 'Track Store', 'Creative Dist 2.0', 'Support'].includes(it.name));
      activeIndex = -1;
      resultsEl.innerHTML = `
        <p class="ss-group">Quick links</p>
        <div class="ss-quick">${QUICK.map((q) => `<a href="${q.url}" class="ss-chip">${sEsc(q.name)}</a>`).join('')}</div>
        <p class="ss-group">Suggested</p>
        ${currentResults.map((it, i) => rowHtml(it, i)).join('')}`;
      resultsEl.querySelectorAll('.site-search-result').forEach((b) => b.classList.remove('active'));
    }

    function runSearch(query) {
      const q = query.trim().toLowerCase();
      if (!q) { renderHome(); return; }
      const words = q.split(/\s+/);
      const hit = (it) => { const h = it.hay || `${it.name} ${it.desc}`.toLowerCase(); return words.every((w) => h.includes(w)); };
      const score = (it) => (it.name.toLowerCase().startsWith(q) ? 0 : it.name.toLowerCase().includes(q) ? 1 : 2);
      const pages = SEARCH_INDEX.filter(hit).sort((a, b) => score(a) - score(b)).slice(0, 8);
      const found = (tracks || []).filter(hit).sort((a, b) => score(a) - score(b)).slice(0, 6);
      renderResults([...found, ...pages], query.trim());
    }

    function setActive(index) {
      const buttons = resultsEl.querySelectorAll('.site-search-result');
      buttons.forEach((b) => b.classList.remove('active'));
      if (buttons[index]) {
        buttons[index].classList.add('active');
        buttons[index].scrollIntoView({ block: 'nearest' });
        activeIndex = index;
      }
    }

    function openSearch() {
      loadTracks();
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

  /* --------------------------- Pack screen player ----------------------------- */
  // Each .pack-screen is a small device: an LCD (title, live oscilloscope,
  // seekable progress) plus prev/play/next keys, driven by a list of
  // .pack-screen-track buttons that carry data-audio / data-title / data-kind.
  // The scope is drawn from a Web Audio AnalyserNode on the same <audio>
  // element that plays the sound; if the graph can't be built (old browser)
  // it falls back to a synthetic waveform so the screen still feels alive.
  const screenPlayers = [];
  document.querySelectorAll('.pack-screen').forEach((root) => {
    const tracks = Array.from(root.querySelectorAll('.pack-screen-track'));
    if (!tracks.length) return;

    const $ = (sel) => root.querySelector(sel);
    const titleEl = $('.pack-screen-title');
    const kindEl = $('.pack-screen-kind');
    const countEl = $('.pack-screen-count');
    const timeEl = $('.pack-screen-time');
    const durEl = $('.pack-screen-dur');
    const bar = $('.pack-screen-bar');
    const fill = $('.pack-screen-bar-fill');
    const canvas = $('.pack-screen-scope');
    const playKey = $('.pack-screen-key-play');
    const prevKey = $('.pack-screen-key-prev');
    const nextKey = $('.pack-screen-key-next');
    const g = canvas.getContext('2d');

    const player = new Audio();
    player.preload = 'none';
    screenPlayers.push(player);
    let idx = 0;
    let loaded = -1;
    let ctx = null;
    let analyser = null;
    let samples = null;
    let freqs = null;
    const SCREEN_BANDS = 40;
    const bands = new Array(SCREEN_BANDS).fill(0);
    let synthetic = false;
    let raf = 0;
    let dpr = 1;

    if (tracks.length === 1) root.classList.add('is-single');

    function fmt(s) {
      if (!isFinite(s) || s < 0) return '0:00';
      const m = Math.floor(s / 60);
      const r = Math.floor(s % 60);
      return m + ':' + (r < 10 ? '0' : '') + r;
    }

    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function show(i, animate) {
      idx = i;
      const t = tracks[i];
      tracks.forEach((b, k) => b.classList.toggle('is-current', k === i));
      titleEl.textContent = t.dataset.title || t.textContent.trim();
      kindEl.textContent = t.dataset.kind || '';
      if (countEl) countEl.textContent = pad(i + 1) + '/' + pad(tracks.length);
      if (animate) {
        titleEl.classList.remove('is-changing');
        void titleEl.offsetWidth;
        titleEl.classList.add('is-changing');
      }
    }

    function resetProgress() {
      fill.style.width = '0%';
      timeEl.textContent = '0:00';
      durEl.textContent = '--:--';
      root.classList.remove('has-track');
      bar.setAttribute('aria-valuenow', '0');
    }

    function load(i) {
      if (loaded === i) return;
      loaded = i;
      player.src = tracks[i].dataset.audio;
      resetProgress();
    }

    function ensureGraph() {
      if (analyser || synthetic) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctx = new AC();
        const src = ctx.createMediaElementSource(player);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        src.connect(analyser);
        analyser.connect(ctx.destination);
        samples = new Uint8Array(analyser.fftSize);
        freqs = new Uint8Array(analyser.frequencyBinCount);
      } catch (e) {
        synthetic = true;
        analyser = null;
      }
    }

    function play(i) {
      if (i !== undefined) show(i, i !== idx);
      load(idx);
      ensureGraph();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      player.currentTime = player.currentTime || 0;
      player.play().catch(() => {});
    }

    function step(dir) {
      const n = (idx + dir + tracks.length) % tracks.length;
      const wasPlaying = !player.paused;
      show(n, true);
      load(n);
      if (wasPlaying) play(); else resetProgress();
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      drawFrame();
    }

    function drawFrame() {
      const w = canvas.width;
      const h = canvas.height;
      const color = getComputedStyle(canvas).color;
      g.clearRect(0, 0, w, h);
      const mid = h / 2;
      const playing = !player.paused;
      const pts = 140;
      const t = performance.now() / 1000;

      // Same look as the packs page visualizer: a glowing spectrum silhouette
      // rising from the bottom of the LCD, in the screen's own colour, with
      // the waveform drawn over it.
      const rgb = (color.match(/\d+(\.\d+)?/g) || [255, 179, 71]).slice(0, 3).join(', ');
      if (playing && analyser) {
        analyser.getByteFrequencyData(freqs);
        const usable = freqs.length * 0.7;
        for (let i = 0; i < SCREEN_BANDS; i++) {
          const a = Math.floor(Math.pow(i / SCREEN_BANDS, 1.7) * usable);
          const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / SCREEN_BANDS, 1.7) * usable));
          let sum = 0;
          for (let j = a; j < b; j++) sum += freqs[j];
          const target = Math.min(1, Math.pow(sum / (b - a) / 255, 1.7) * (0.9 + (i / SCREEN_BANDS) * 0.7));
          bands[i] += (target - bands[i]) * (target > bands[i] ? 0.55 : 0.12);
        }
      } else {
        for (let i = 0; i < SCREEN_BANDS; i++) bands[i] = 0;
      }
      if (bands.some((v) => v > 0.002)) {
        const base = h;
        const maxH = h * 0.92;
        const stepX = w / (SCREEN_BANDS - 1);
        const fillG = g.createLinearGradient(0, base - maxH, 0, base);
        fillG.addColorStop(0, `rgba(${rgb}, 0.7)`);
        fillG.addColorStop(1, `rgba(${rgb}, 0.06)`);
        g.save();
        g.beginPath();
        g.moveTo(0, base);
        for (let i = 0; i < SCREEN_BANDS; i++) {
          const x = i * stepX;
          const y = base - bands[i] * maxH;
          if (i === 0) g.lineTo(x, y);
          else {
            const px = (i - 1) * stepX;
            const py = base - bands[i - 1] * maxH;
            g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
          }
        }
        g.lineTo(w, base - bands[SCREEN_BANDS - 1] * maxH);
        g.lineTo(w, base);
        g.closePath();
        g.shadowColor = `rgba(${rgb}, 0.8)`;
        g.shadowBlur = 16 * dpr;
        g.fillStyle = fillG;
        g.fill();
        g.restore();
      }

      g.lineWidth = 2 * dpr;
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.strokeStyle = color;
      g.shadowColor = `rgba(${rgb}, 0.9)`;
      g.shadowBlur = playing ? 8 * dpr : 0;

      if (playing && analyser) analyser.getByteTimeDomainData(samples);

      g.beginPath();
      for (let i = 0; i <= pts; i++) {
        const x = (i / pts) * w;
        let v = 0;
        if (playing && analyser) {
          const s = samples[Math.floor((i / pts) * (samples.length - 1))];
          v = ((s - 128) / 128) * 1.7;
        } else if (playing) {
          const e = 0.45 + 0.35 * Math.sin(t * 3.1) * Math.sin(t * 1.3);
          v = (Math.sin(i * 0.21 + t * 9) * 0.6 + Math.sin(i * 0.53 - t * 5) * 0.4) * e;
        } else {
          v = Math.sin(i * 0.12 + t * 1.2) * 0.025;
        }
        v = Math.max(-1, Math.min(1, v));
        const y = mid + v * mid * 0.85;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }

    function loop() {
      drawFrame();
      raf = requestAnimationFrame(loop);
    }

    function start() {
      if (!raf) raf = requestAnimationFrame(loop);
    }

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      drawFrame();
    }

    function setProgress(ratio) {
      const r = Math.max(0, Math.min(1, ratio));
      fill.style.width = (r * 100) + '%';
      bar.setAttribute('aria-valuenow', String(Math.round(r * 100)));
    }

    player.addEventListener('play', () => { screenPlayers.forEach((p) => { if (p !== player) p.pause(); }); root.classList.add('is-playing', 'has-track'); playKey.setAttribute('aria-label', 'Pause'); start(); });
    player.addEventListener('pause', () => { root.classList.remove('is-playing'); playKey.setAttribute('aria-label', 'Play'); stop(); });
    player.addEventListener('loadedmetadata', () => { durEl.textContent = fmt(player.duration); });
    player.addEventListener('timeupdate', () => {
      timeEl.textContent = fmt(player.currentTime);
      if (player.duration) setProgress(player.currentTime / player.duration);
    });
    player.addEventListener('ended', () => {
      if (idx < tracks.length - 1) {
        play(idx + 1);
      } else {
        player.currentTime = 0;
        setProgress(0);
        timeEl.textContent = '0:00';
      }
    });
    player.addEventListener('error', () => { root.classList.remove('is-playing'); stop(); });

    playKey.addEventListener('click', () => { if (player.paused) play(); else player.pause(); });
    if (prevKey) prevKey.addEventListener('click', () => step(-1));
    if (nextKey) nextKey.addEventListener('click', () => step(1));
    tracks.forEach((b, i) => {
      b.addEventListener('click', () => {
        if (i === idx && !player.paused) { player.pause(); return; }
        if (i === idx && loaded === i) { play(); return; }
        show(i, true);
        play();
      });
    });

    function seekFromEvent(e) {
      const rect = bar.getBoundingClientRect();
      const r = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      if (loaded !== idx) { load(idx); }
      if (player.duration) { player.currentTime = r * player.duration; setProgress(r); }
      else {
        player.addEventListener('loadedmetadata', () => { player.currentTime = r * player.duration; }, { once: true });
        if (player.paused) play();
      }
    }
    bar.addEventListener('pointerdown', (e) => {
      bar.setPointerCapture(e.pointerId);
      seekFromEvent(e);
    });
    bar.addEventListener('pointermove', (e) => { if (e.buttons === 1) seekFromEvent(e); });
    bar.addEventListener('keydown', (e) => {
      if (!player.duration) return;
      if (e.key === 'ArrowRight') { player.currentTime = Math.min(player.duration, player.currentTime + 5); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { player.currentTime = Math.max(0, player.currentTime - 5); e.preventDefault(); }
    });

    show(0, false);
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); else window.addEventListener('resize', resize);
    resize();
  });
})();
