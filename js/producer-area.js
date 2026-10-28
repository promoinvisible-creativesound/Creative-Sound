// Producer area (profile-producer.html): the producer's submitted tracks
// with their review status, counts per status and a status filter.
(() => {
  'use strict';
  const page = document.querySelector('[data-producer-area]');
  if (!page) return;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STATUS = {
    pending: { label: 'In review', cls: 'is-pending' },
    approved: { label: 'Approved', cls: 'is-ok' },
    rejected: { label: 'Needs changes', cls: 'is-bad' },
  };
  const date = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const minPrice = (prices) => {
    const v = Object.values(prices || {}).filter((p) => p > 0);
    return v.length ? `€${(Math.min(...v) / 100).toFixed(2)}` : '';
  };

  let all = [];
  let stats = {};
  const open = new Set();
  const num = (n) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n || 0));
  const SRC = { direct: 'Direct', youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', google: 'Google', facebook: 'Facebook', x: 'X', reddit: 'Reddit', bing: 'Bing', duckduckgo: 'DuckDuckGo' };
  const STATS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>';

  // Per-track stats: last 30 days in the tiles (all time underneath),
  // a 30-day plays chart and where listeners came from.
  function statsPanel(id) {
    const t = stats[id] || { all: {}, d30: {}, daily: {}, sources: {}, sales: { n: 0, n30: 0, cents: 0 } };
    const tile = (label, v30, vAll) => `<div class="pa-st-tile"><b>${num(v30)}</b><span>${label}</span><small>${num(vAll)} all time</small></div>`;
    const days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5);
      days.push({ d, n: t.daily[d.toISOString().slice(0, 10)] || 0 });
    }
    const max = Math.max(1, ...days.map((x) => x.n));
    const bars = days.map((x) => `<i style="--h:${Math.round((x.n / max) * 100)}%" title="${x.d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${x.n} play${x.n === 1 ? '' : 's'}"></i>`).join('');
    const src = Object.entries(t.sources).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const srcTotal = src.reduce((a, [, n]) => a + n, 0) || 1;
    const plays = t.d30.play || 0;
    const conv = plays ? `${(((t.d30.cart || 0) / plays) * 100).toFixed(1)}%` : '–';
    return `
      <div class="pa-st" id="pa-st-${id}">
        <div class="pa-st-tiles">
          ${tile('Page views', t.d30.view, t.all.view)}
          ${tile('Plays', t.d30.play, t.all.play)}
          ${tile('Saves', t.d30.save, t.all.save)}
          ${tile('Added to cart', t.d30.cart, t.all.cart)}
          ${tile('Sales', t.sales.n30, t.sales.n)}
          <div class="pa-st-tile is-money"><b>€${(t.sales.cents / 100).toFixed(2)}</b><span>Revenue</span><small>all time, before fees</small></div>
        </div>
        <div class="pa-st-grid">
          <div class="pa-st-box">
            <div class="pa-st-head"><b>Plays, last 30 days</b><span>Play to cart ${conv}</span></div>
            <div class="pa-st-chart" role="img" aria-label="${plays} plays in the last 30 days">${bars}</div>
            <div class="pa-st-axis"><span>${days[0].d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><span>Today</span></div>
          </div>
          <div class="pa-st-box">
            <div class="pa-st-head"><b>Where listeners come from</b><span>90 days</span></div>
            ${src.length ? `<ul class="pa-st-src">${src.map(([k, n]) => `<li><span>${esc(SRC[k] || k)}</span><i style="--w:${Math.max(3, Math.round((n / srcTotal) * 100))}%"></i><b>${Math.round((n / srcTotal) * 100)}%</b></li>`).join('')}</ul>` : '<p class="pa-st-none">No visits yet. Share your track link to see where listeners come from.</p>'}
          </div>
        </div>
        <p class="pa-st-tip">Tip: add <code>?utm_source=youtube</code> (or instagram, tiktok…) to the links you share, so every visit is counted to the right place.</p>
      </div>`;
  }
  let filter = 'all';
  const list = $('#pa-list');

  function render() {
    const rows = filter === 'all' ? all : all.filter((s) => s.status === filter);
    list.removeAttribute('aria-busy');
    $('#pa-empty').hidden = all.length > 0;
    list.hidden = all.length === 0;
    list.innerHTML = rows.length ? rows.map((s) => {
      const st = s.sold ? { label: 'Sold', cls: 'is-ok' } : (STATUS[s.status] || STATUS.pending);
      const meta = [s.bpm ? `${s.bpm} BPM` : '', s.key, s.genre].filter(Boolean).map(esc).join(' · ');
      return `
        <article class="pa-row">
          <div class="pa-row-main">
            <b class="pa-row-title">${esc(s.title || 'Untitled track')}</b>
            <span class="pa-row-meta">${meta}${minPrice(s.prices) ? ` · from ${minPrice(s.prices)}` : ''}</span>
            ${s.sold ? '<p class="pa-row-note">Sold with a license that leaves all rights with the buyer, so it is off the store.</p>' : ''}
            ${s.status === 'rejected' && s.reviewNote ? `<p class="pa-row-note"><b>What to fix:</b> ${esc(s.reviewNote)}</p>` : ''}
          </div>
          <div class="pa-row-side">
            <span class="hm-status pa-status ${st.cls}">${st.label}</span>
            <small>${s.status === 'pending' ? `Sent ${date(s.submittedAt)}` : `Reviewed ${date(s.reviewedAt || s.submittedAt)}`}</small>
            ${s.storeUrl ? `<a class="pa-store-link" href="${esc(s.storeUrl)}">View in store</a>` : ''}
            ${s.status === 'approved' && !s.sold ? `<a class="pa-edit-link" href="upload-beat.html?edit=${s.id}">Edit</a>` : ''}
            ${s.status === 'approved' ? `<button type="button" class="pa-st-btn${open.has(s.id) ? ' is-open' : ''}" data-stats="${s.id}" aria-expanded="${open.has(s.id)}" aria-controls="pa-st-${s.id}">${STATS_ICON}<span>${num((stats[s.id] && stats[s.id].d30.play) || 0)} plays</span></button>` : ''}
            ${s.changesStatus === 'pending' ? '<span class="pa-change is-pending">Changes in review</span>' : s.changesStatus === 'rejected' ? `<span class="pa-change is-bad" title="${esc(s.changesNote || '')}">Changes not approved</span>` : ''}
          </div>
        </article>${s.status === 'approved' && open.has(s.id) ? statsPanel(s.id) : ''}`;
    }).join('') : '<p class="pa-none">No tracks with this status.</p>';
  }

  function counts() {
    ['pending', 'approved', 'rejected'].forEach((k) => {
      $(`#pa-n-${k}`).textContent = String(all.filter((s) => s.status === k).length);
    });
  }

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stats]');
    if (!btn) return;
    const id = Number(btn.dataset.stats);
    if (open.has(id)) open.delete(id); else open.add(id);
    render();
  });
  const loadStats = () => fetch('/api/producer/stats').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !d.tracks) return;
    stats = d.tracks;
    render();
  }).catch(() => {});

  page.querySelector('.pa-filter').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    filter = btn.dataset.filter;
    page.querySelectorAll('.pa-filter button').forEach((b) => {
      const on = b === btn;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    render();
  });

  // Verified badge: producers ask, the Creative Sound team decides.
  function paintVerify(data) {
    const box = $('#pa-verify');
    if (!box) return;
    if (data.producerVerified) {
      box.hidden = false;
      box.className = 'pa-verify is-done';
      box.innerHTML = '<b>You are a verified producer</b><span>The blue badge shows next to your name in the store.</span>';
      return;
    }
    box.hidden = false;
    box.className = 'pa-verify';
    const asked = data.verifyRequestedAt;
    box.innerHTML = `
      <div><b>Get the verified badge</b><span>${asked ? `Request sent on ${date(asked)}. We'll look at your profile and tracks and email you.` : 'We check your profile and tracks, then add the blue badge next to your name in the store.'}</span></div>
      <button type="button" class="btn ${asked ? 'btn-ghost' : 'btn-primary'}" id="pa-verify-btn" ${asked ? 'disabled' : ''}>${asked ? 'Requested' : 'Request verification'}</button>`;
    const btn = $('#pa-verify-btn');
    if (asked) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Sending…';
      try {
        const res = await fetch('/api/producer/verify-request', { method: 'POST' });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Could not send the request.');
        paintVerify({ producerVerified: !!out.verified, verifyRequestedAt: out.requestedAt || new Date().toISOString() });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Request verification';
        $('#pa-error').textContent = err.message;
        $('#pa-error').hidden = false;
      }
    });
  }

  fetch('/api/producer/submissions')
    .then(async (res) => {
      if (res.status === 401) { window.location.href = 'login.html'; return; }
      if (res.status === 403) { $('#pa-body').hidden = true; $('#pa-gate').hidden = false; $('.pa-upload').hidden = true; return; }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data && data.error) || 'Could not load your tracks.');
      all = data.submissions || [];
      if (data.producerName) {
        // The verified badge is granted by the Creative Sound team, not
        // self-selected; show where this producer stands.
        $('#pa-sub').innerHTML = `Signed in as <b>${esc(data.producerName)}</b><span class="pa-verified ${data.producerVerified ? 'is-on' : ''}">${data.producerVerified ? 'Verified' : 'Not verified yet'}</span>. Your tracks and where each one is in review.`;
      }
      paintVerify(data);
      counts();
      render();
      if (all.some((x) => x.status === 'approved')) loadStats();
    })
    .catch((err) => {
      list.removeAttribute('aria-busy');
      list.innerHTML = '';
      $('#pa-error').textContent = err.message;
      $('#pa-error').hidden = false;
    });

  /* --------------------------------- Payouts -------------------------------- */
  // 80% of each sale; Stripe (bank account) or PayPal, paid every Monday.
  const po = $('#payouts');
  const euro = (c) => `€${((c || 0) / 100).toFixed(2)}`;
  const poSay = (t, bad) => { const el = $('#po-status'); el.textContent = t || ''; el.classList.toggle('is-bad', !!bad); };
  const COUNTRY = { AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus', CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France', DE: 'Germany', GR: 'Greece', HU: 'Hungary', IE: 'Ireland', IT: 'Italy', LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta', NL: 'Netherlands', PL: 'Poland', PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia', ES: 'Spain', SE: 'Sweden', NO: 'Norway', IS: 'Iceland', LI: 'Liechtenstein', GB: 'United Kingdom', CH: 'Switzerland' };
  const PO_ST = { pending: ['On hold', 'is-pending'], available: ['Available', 'is-ok'], paid: ['Paid', 'is-ok'], refunded: ['Refunded', 'is-bad'], processing: ['Sending', 'is-pending'] };

  function paintPayouts(d) {
    $('#po-available').textContent = euro(d.totals.available);
    $('#po-pending').textContent = euro(d.totals.pending);
    $('#po-paid').textContent = euro(d.totals.paid);
    $('#po-note').textContent = `Each sale is on hold for ${d.holdDays} days (refund window), then paid out on the next Monday once your balance reaches ${euro(d.minPayout)}.`;
    po.querySelectorAll('.po-method').forEach((m) => m.classList.toggle('is-on', m.dataset.method === d.method));
    // Stripe
    const sb = $('#po-stripe-badge');
    const body = $('#po-stripe-body');
    sb.hidden = !d.stripe.connected;
    sb.textContent = d.stripe.ready ? (d.method === 'stripe' ? 'In use' : 'Connected') : 'Setup not finished';
    sb.classList.toggle('is-warn', d.stripe.connected && !d.stripe.ready);
    if (!d.stripe.available) {
      body.innerHTML = '<small class="po-muted">Coming soon. Use PayPal for now.</small>';
    } else if (!d.stripe.connected) {
      body.innerHTML = `<select id="po-country" aria-label="Country of your bank account">${d.stripe.countries.map((c) => `<option value="${c}" ${c === 'IT' ? 'selected' : ''}>${COUNTRY[c] || c}</option>`).join('')}</select>
        <button type="button" class="btn btn-primary" data-po="stripe">Connect with Stripe</button>`;
    } else if (!d.stripe.ready) {
      body.innerHTML = '<button type="button" class="btn btn-primary" data-po="stripe">Finish Stripe setup</button>';
    } else {
      body.innerHTML = `${d.method !== 'stripe' ? '<button type="button" class="btn btn-primary" data-po="use-stripe">Use bank account</button>' : ''}<button type="button" class="btn btn-ghost" data-po="stripe-dashboard">Open Stripe dashboard</button>`;
    }
    // PayPal
    const pb = $('#po-paypal-badge');
    pb.hidden = !d.paypal.email;
    pb.textContent = d.method === 'paypal' ? 'In use' : 'Saved';
    const input = $('#po-paypal-email');
    if (document.activeElement !== input) input.value = d.paypal.email;
    // Sales
    $('#po-list').innerHTML = d.earnings.length ? d.earnings.map((r) => {
      const st = PO_ST[r.status] || PO_ST.pending;
      return `<div class="po-row">
        <div class="po-row-main"><b>${esc(r.title)}</b><small>${esc((r.tier || '').toUpperCase())} · ${date(r.date)} · sold for ${euro(r.gross)}</small></div>
        <div class="po-row-side"><b>${euro(r.share)}</b><span class="hm-status pa-status ${st[1]}">${st[0]}</span></div>
      </div>`;
    }).join('') : '<p class="po-none">No sales yet. When someone buys one of your tracks it shows here with your 80%.</p>';
  }

  async function payouts(body) {
    const res = await fetch('/api/producer/payouts', body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(d.error || 'Could not load payouts.'), { status: res.status });
    return d;
  }

  if (po) {
    payouts().then(paintPayouts).catch((err) => { if (err.status === 403 || err.status === 401) po.hidden = true; else poSay(err.message, true); });
    if (/[?&]stripe=done/.test(location.search)) poSay('Stripe setup saved. It can take a minute for Stripe to confirm your account.');
    po.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-po]');
      if (!btn) return;
      btn.disabled = true;
      poSay('');
      try {
        const kind = btn.dataset.po;
        const d = await payouts(kind === 'stripe' ? { method: 'stripe', country: ($('#po-country') || {}).value } : { method: kind });
        if (d.url) { window.location.href = d.url; return; }
        paintPayouts(d);
        poSay('Saved. Payouts now go to your bank account.');
      } catch (err) {
        poSay(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
    $('#po-paypal-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      try {
        paintPayouts(await payouts({ method: 'paypal', email: $('#po-paypal-email').value }));
        poSay('Saved. Payouts now go to your PayPal.');
      } catch (err) {
        poSay(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });
  }
})();
