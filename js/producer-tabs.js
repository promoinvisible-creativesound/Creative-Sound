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

  const fromHash = () => {
    const h = decodeURIComponent(location.hash.replace('#', ''));
    const name = alias[h] || h;
    return names.has(name) ? name : 'tracks';
  };
  const show = (name, { scroll } = {}) => {
    body.dataset.active = name;
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('is-on', on);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    if (scroll && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: 'start', behavior: 'auto' });
    const on = tabs.find((t) => t.dataset.tab === name);
    if (on && on.scrollIntoView && bar.scrollWidth > bar.clientWidth) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'auto' });
  };

  bar.addEventListener('click', (e) => {
    const a = e.target.closest('[data-tab]');
    if (!a) return;
    e.preventDefault();
    history.replaceState(null, '', `#${a.dataset.tab}`);
    show(a.dataset.tab, { scroll: true });
  });
  window.addEventListener('hashchange', () => show(fromHash(), { scroll: true }));
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
