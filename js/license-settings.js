// Producer area: "Your licenses". Per license tier the producer picks the
// usage limits and their publishing share (fixed options), adds up to a few
// clauses of their own, previews the PDF and saves. The fixed legal base
// always applies (api/_lib/license-config.js); changes only affect future
// sales, every sold license keeps the text it was sold with.
(() => {
  'use strict';
  const box = document.getElementById('licenses');
  if (!box) return;
  const $ = (s) => box.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TIERS = [['mp3', 'MP3'], ['wav', 'WAV'], ['trackout', 'Trackout'], ['project', 'Project']];
  const n = (x) => Number(x).toLocaleString('en-US');
  const FIELDS = [
    ['streams', 'Audio streams', (v) => (v === null ? 'Unlimited' : `Up to ${n(v)}`)],
    ['sales', 'Sales / downloads', (v) => (v === null ? 'Unlimited' : `Up to ${n(v)}`)],
    ['videos', 'Music videos', (v) => (v === null ? 'Unlimited' : v === 0 ? 'Not included' : `${v}`)],
    ['live', 'Live performances', (v) => ({ none: 'Not included', nonprofit: 'Non-profit only', all: 'Unlimited, paid shows too' }[v])],
    ['radio', 'Radio', (v) => (v === null ? 'Unlimited stations' : v === 0 ? 'Not included' : `Up to ${v} stations`)],
    ['publishing', 'Your publishing share', (v) => (v ? `${v}% writer + ${v}% publishing` : 'None, credit only')],
  ];
  let data = null;
  let config = null;
  let tier = 'mp3';
  let dirty = false;

  const status = (t, cls = '') => { const s = $('#lc-status'); s.textContent = t; s.className = `sf-set-status ${cls}`; };
  const unlimited = (t) => t.streams === null && t.sales === null && t.videos === null && t.live === 'all' && t.radio === null;
  const val = (v) => (v === null ? 'unlimited' : String(v));
  const parse = (s) => (s === 'unlimited' ? null : /^\d+$/.test(s) ? Number(s) : s);

  const paintTabs = () => {
    $('#lc-tabs').innerHTML = TIERS.map(([id, label]) => {
      const t = config.tiers[id];
      return `<button type="button" role="tab" class="lc-tab${id === tier ? ' is-on' : ''}" data-tier="${id}" aria-selected="${id === tier}"><b>${label}</b><small>${unlimited(t) ? 'Unlimited' : 'Lease'}</small></button>`;
    }).join('');
  };
  const paintFields = () => {
    const t = config.tiers[tier];
    $('#lc-fields').innerHTML = FIELDS.map(([key, label, show]) => `
      <label class="lc-row"><span>${label}</span>
        <select data-field="${key}">${data.options[key === 'live' ? 'live' : key].map((o) => `<option value="${val(o)}"${o === t[key] ? ' selected' : ''}>${esc(show(o))}</option>`).join('')}</select>
      </label>`).join('');
  };
  const paintClauses = () => {
    $('#lc-clauses').innerHTML = config.clauses.map((c, i) => `
      <div class="lc-clause">
        <span class="lc-clause-n">${String.fromCharCode(65 + i)}</span>
        <textarea data-clause="${i}" maxlength="${data.clauseMax}" rows="2" placeholder="e.g. Send the producer a link to your release within 30 days.">${esc(c)}</textarea>
        <button type="button" class="lc-clause-x" data-remove="${i}" aria-label="Remove clause ${String.fromCharCode(65 + i)}">×</button>
      </div>`).join('') || '<p class="sf-set-none">No terms of your own yet. The standard contract applies.</p>';
    $('#lc-add').hidden = config.clauses.length >= data.maxClauses;
    $('#lc-clauses-n').textContent = `${config.clauses.length} / ${data.maxClauses}`;
  };
  const paint = () => { paintTabs(); paintFields(); paintClauses(); };
  const changed = () => { dirty = true; status('Unsaved changes'); };

  const load = () => fetch('/api/producer/license').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    data = d;
    config = JSON.parse(JSON.stringify(d.config));
    $('#lc-producer').textContent = d.producer;
    box.hidden = false;
    paint();
    if (location.hash === '#licenses') box.scrollIntoView({ block: 'start' });
  }).catch(() => {});

  box.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tier]');
    if (tab) { tier = tab.dataset.tier; paintTabs(); paintFields(); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) { config.clauses.splice(Number(rm.dataset.remove), 1); paintClauses(); changed(); }
  });
  box.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-field]');
    if (!sel) return;
    config.tiers[tier][sel.dataset.field] = parse(sel.value);
    paintTabs();
    changed();
  });
  box.addEventListener('input', (e) => {
    const ta = e.target.closest('[data-clause]');
    if (!ta) return;
    config.clauses[Number(ta.dataset.clause)] = ta.value;
    changed();
  });
  $('#lc-add').addEventListener('click', () => {
    if (config.clauses.length >= data.maxClauses) return;
    config.clauses.push('');
    paintClauses();
    const all = box.querySelectorAll('[data-clause]');
    if (all.length) all[all.length - 1].focus();
  });
  const body = () => ({ config: { tiers: config.tiers, clauses: config.clauses.map((c) => c.trim()).filter(Boolean) } });

  $('#lc-save').addEventListener('click', async () => {
    const short = config.clauses.map((c) => c.trim()).filter((c) => c && c.length < 10);
    if (short.length) { status('Each clause needs at least 10 characters.', 'is-bad'); return; }
    const btn = $('#lc-save');
    btn.disabled = true;
    status('Saving…');
    try {
      const r = await fetch('/api/producer/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      config = d.config;
      dirty = false;
      paint();
      status('Saved. New sales use these terms; past buyers keep theirs.', 'is-ok');
    } catch (err) {
      status(err.message, 'is-bad');
    } finally {
      btn.disabled = false;
    }
  });
  $('#lc-preview').addEventListener('click', async () => {
    const win = window.open('', '_blank');
    status('Building the PDF…');
    try {
      const r = await fetch('/api/producer/license', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body(), preview: tier }) });
      if (!r.ok) throw new Error('Could not build the preview.');
      const url = URL.createObjectURL(await r.blob());
      if (win) win.location.href = url; else window.open(url, '_blank');
      status(dirty ? 'Preview of your unsaved changes. Remember to save.' : '');
    } catch (err) {
      if (win) win.close();
      status(err.message, 'is-bad');
    }
  });
  $('#lc-reset').addEventListener('click', () => {
    config = JSON.parse(JSON.stringify(data.defaults));
    config.clauses = [];
    paint();
    changed();
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  load();
})();
