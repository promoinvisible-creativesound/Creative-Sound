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
  let filter = 'all';
  const list = $('#pa-list');

  function render() {
    const rows = filter === 'all' ? all : all.filter((s) => s.status === filter);
    list.removeAttribute('aria-busy');
    $('#pa-empty').hidden = all.length > 0;
    list.hidden = all.length === 0;
    list.innerHTML = rows.length ? rows.map((s) => {
      const st = STATUS[s.status] || STATUS.pending;
      const meta = [s.bpm ? `${s.bpm} BPM` : '', s.key, s.genre].filter(Boolean).map(esc).join(' · ');
      return `
        <article class="pa-row">
          <div class="pa-row-main">
            <b class="pa-row-title">${esc(s.title || 'Untitled track')}</b>
            <span class="pa-row-meta">${meta}${minPrice(s.prices) ? ` · from ${minPrice(s.prices)}` : ''}</span>
            ${s.status === 'rejected' && s.reviewNote ? `<p class="pa-row-note"><b>What to fix:</b> ${esc(s.reviewNote)}</p>` : ''}
          </div>
          <div class="pa-row-side">
            <span class="hm-status pa-status ${st.cls}">${st.label}</span>
            <small>${s.status === 'pending' ? `Sent ${date(s.submittedAt)}` : `Reviewed ${date(s.reviewedAt || s.submittedAt)}`}</small>
          </div>
        </article>`;
    }).join('') : '<p class="pa-none">No tracks with this status.</p>';
  }

  function counts() {
    ['pending', 'approved', 'rejected'].forEach((k) => {
      $(`#pa-n-${k}`).textContent = String(all.filter((s) => s.status === k).length);
    });
  }

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

  fetch('/api/producer/submissions')
    .then(async (res) => {
      if (res.status === 401) { window.location.href = 'login.html'; return; }
      if (res.status === 403) { $('#pa-body').hidden = true; $('#pa-gate').hidden = false; $('.pa-upload').hidden = true; return; }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data && data.error) || 'Could not load your tracks.');
      all = data.submissions || [];
      if (data.producerName) $('#pa-sub').textContent = `Signed in as ${data.producerName}. Your tracks and where each one is in review.`;
      counts();
      render();
    })
    .catch((err) => {
      list.removeAttribute('aria-busy');
      list.innerHTML = '';
      $('#pa-error').textContent = err.message;
      $('#pa-error').hidden = false;
    });
})();
