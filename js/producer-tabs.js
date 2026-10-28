// Producer area: one section at a time (Tracks, Storefront, Licenses, Payouts,
// Tax & statements). The active tab lives in the URL hash, so links such as
// profile-producer.html#payouts (also the Stripe return link) open the right one.
(() => {
  'use strict';
  const body = document.getElementById('pa-body');
  const bar = document.getElementById('pa-tabs');
  if (!body || !bar) return;
  const tabs = [...bar.querySelectorAll('[data-tab]')];
  const names = new Set(tabs.map((t) => t.dataset.tab));
  // Ids that live inside a tab but are not tab names.
  const alias = { statements: 'tax' };
  const DESC = {
    tracks: 'Your uploads and where each one is in review.',
    storefront: 'Your public page: banner, colour and pinned tracks.',
    licenses: 'The limits and terms buyers get with each license.',
    payouts: 'Your balance and how you get paid every Monday.',
    tax: 'Your tax details and a monthly statement to invoice from.',
  };
  const descEl = document.getElementById('pa-tab-desc');

  const fromHash = () => {
    const h = decodeURIComponent(location.hash.replace('#', ''));
    const name = alias[h] || h;
    return names.has(name) ? name : 'tracks';
  };
  const mq = window.matchMedia('(max-width:640px)');
  const prev = document.getElementById('pa-tabs-prev');
  const next = document.getElementById('pa-tabs-next');
  const dots = [...document.querySelectorAll('#pa-dots i')];
  // One phone "page" = the width of one tab (the bar minus its padding).
  const pageW = () => tabs[0].offsetWidth || bar.clientWidth;
  let moving = false; // true while the script itself moves the bar
  const indexOf = (name) => tabs.findIndex((t) => t.dataset.tab === name);
  const goTo = (i, smooth) => {
    moving = true;
    bar.scrollTo({ left: i * pageW(), behavior: smooth ? 'smooth' : 'auto' });
    setTimeout(() => { moving = false; }, smooth ? 450 : 60);
  };
  const show = (name, { scroll } = {}) => {
    body.dataset.active = name;
    const idx = indexOf(name);
    dots.forEach((d, i) => d.classList.toggle('is-on', i === idx));
    if (descEl) descEl.textContent = DESC[name] || '';
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= tabs.length - 1;
    if (mq.matches && Math.round(bar.scrollLeft / pageW()) !== idx) goTo(idx, false);
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-on', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    if (scroll && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start', behavior: 'auto' });
    const on = tabs.find((t) => t.dataset.tab === name);
    if (on && !mq.matches && bar.scrollWidth > bar.clientWidth) {
      // Desktop/tablet row that scrolls: keep the active tab in view (without moving the page).
      const left = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
      bar.scrollTo({ left, behavior: 'auto' });
    }
  };

  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', `#${a.dataset.tab}`);
    show(a.dataset.tab, { scroll: true });
  });
  window.addEventListener('hashchange', () => show(fromHash(), { scroll: true }));

  // Phones: swiping the bar changes the section; so do the arrows.
  const step = (d) => {
    const i = Math.max(0, Math.min(tabs.length - 1, indexOf(body.dataset.active) + d));
    const name = tabs[i].dataset.tab;
    history.replaceState(null, '', `#${name}`);
    show(name);
    goTo(i, true);
  };
  if (prev) prev.addEventListener('click', () => step(-1));
  if (next) next.addEventListener('click', () => step(1));
  let timer = 0;
  bar.addEventListener('scroll', () => {
    if (!mq.matches || moving) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const i = Math.max(0, Math.min(tabs.length - 1, Math.round(bar.scrollLeft / pageW())));
      const name = tabs[i].dataset.tab;
      if (name === body.dataset.active) return;
      history.replaceState(null, '', `#${name}`);
      show(name);
    }, 90);
  }, { passive: true });
  const onResize = () => { if (mq.matches) goTo(indexOf(body.dataset.active), false); else bar.scrollTo({ left: 0, behavior: 'auto' }); };
  if (mq.addEventListener) mq.addEventListener('change', onResize);
  show(fromHash());
  // Arriving with a link such as #payouts: start at the tabs, not halfway down the page.
  // (the browser's own jump to the #id happens after load, so wait a moment).
  if (location.hash) {
    const go = () => setTimeout(() => bar.scrollIntoView({ block: 'start', behavior: 'auto' }), 200);
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }

  // A red dot on "Tax & statements" while the tax details still need to be confirmed.
  const dot = document.getElementById('pa-dot-tax');
  const badge = document.getElementById('tx-badge');
  if (dot && badge) {
    const sync = () => { dot.hidden = !badge.classList.contains('is-warn'); };
    new MutationObserver(sync).observe(badge, { attributes: true, attributeFilter: ['class', 'hidden'] });
    sync();
  }
})();
