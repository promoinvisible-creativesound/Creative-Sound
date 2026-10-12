// Upload a beat (upload-beat.html). Producers only.
//
// Each file goes straight from the browser into the site owner's Dropbox:
// /api/producer/file returns a one-off upload link (and creates the draft
// on the first file), then the file is POSTed to that link with progress.
// Submitting sends the details; the server checks the files are really in
// Dropbox and puts the beat in the review queue.
(() => {
  'use strict';
  const page = document.querySelector('[data-upload-page]');
  if (!page) return;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const form = $('#up-form');
  const MB = 1024 * 1024;

  // Mirrors api/_lib/producer.js (the server re-checks everything).
  const KINDS = {
    artwork: { exts: ['jpg', 'jpeg', 'png', 'webp'], max: 10 * MB },
    preview: { exts: ['mp3'], max: 30 * MB },
    mp3: { exts: ['mp3'], max: 50 * MB },
    wav: { exts: ['wav'], max: 150 * MB },
    stems: { exts: ['zip', 'rar', '7z'], max: 150 * MB },
    project: { exts: ['zip', 'rar', '7z', 'flp'], max: 150 * MB },
  };
  const TIER_NEEDS = { mp3: ['mp3'], wav: ['mp3', 'wav'], trackout: ['mp3', 'wav', 'stems'], project: ['mp3', 'wav', 'stems', 'project'] };
  const FILE_NAMES = { mp3: 'untagged MP3', wav: 'WAV', stems: 'stems', project: 'project file' };
  const PRICE_HINTS = { mp3: '29.99', wav: '49.99', trackout: '99.99', project: '199.99' };
  const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const GENRES = ['Trap', 'Drill', 'Hip Hop', 'R&B', 'Afrobeat', 'Boom Bap', 'Pop', 'Hyperpop', 'Reggaeton', 'Dancehall', 'Lo-fi', 'House', 'Rock', 'Other'];
  const MOODS = ['Dark', 'Chill', 'Aggressive', 'Sad', 'Happy', 'Energetic', 'Romantic', 'Dreamy', 'Epic', 'Bouncy'];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtSize = (b) => (b >= MB ? `${(b / MB).toFixed(b >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

  let submissionId = null;
  const done = {}; // kind -> { name, size }
  const busy = new Set();
  let licenses = null;

  /* ------------------------------- Selects -------------------------------- */
  const fill = (name, values, placeholder) => {
    form.elements[name].innerHTML = `<option value="">${placeholder}</option>${values.map((v) => `<option>${esc(v)}</option>`).join('')}`;
  };
  fill('key', NOTES.flatMap((n) => [`${n} min`, `${n} maj`]), 'Choose key');
  fill('genre', GENRES, 'Choose genre');
  fill('mood', MOODS, 'Choose mood');

  /* -------------------------------- Files --------------------------------- */
  const ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>';
  const ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  const rows = $$('.up-file');
  rows.forEach((row) => {
    const kind = row.dataset.kind;
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    input.accept = KINDS[kind].exts.map((e) => `.${e}`).join(',');
    row.appendChild(input);
    paintIdle(row);
    row.addEventListener('click', (e) => { if (e.target.closest('[data-pick]')) input.click(); });
    input.addEventListener('change', () => { if (input.files[0]) upload(row, input.files[0]); input.value = ''; });
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('is-drag'); });
    row.addEventListener('dragleave', (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove('is-drag'); });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('is-drag');
      const file = e.dataTransfer.files[0];
      if (file) upload(row, file);
    });
  });
  // Dropping a file anywhere else must not open it in the tab.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  function paintIdle(row, error) {
    $('.up-file-ctrl', row).innerHTML = `
      ${error ? `<span class="up-file-err">${esc(error)}</span>` : ''}
      <button type="button" class="up-btn" data-pick>${ICON_UP}Upload</button>`;
    row.classList.remove('is-busy', 'is-done');
    row.classList.toggle('is-error', !!error);
  }
  function paintBusy(row, name) {
    $('.up-file-ctrl', row).innerHTML = `
      <div class="up-progress" role="progressbar" aria-label="Uploading ${esc(name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span class="up-progress-name">${esc(name)}</span>
        <span class="up-progress-track"><span class="up-progress-fill"></span></span>
        <span class="up-progress-pct">0%</span>
      </div>`;
    row.classList.add('is-busy');
    row.classList.remove('is-done', 'is-error');
  }
  function paintDone(row, file) {
    $('.up-file-ctrl', row).innerHTML = `
      <span class="up-file-done">${ICON_OK}<span><b>${esc(file.name)}</b><small>${fmtSize(file.size)}</small></span></span>
      <button type="button" class="up-btn up-btn-ghost" data-pick>Replace</button>`;
    row.classList.remove('is-busy', 'is-error');
    row.classList.add('is-done');
  }
  function setProgress(row, p) {
    const bar = $('.up-progress', row);
    if (!bar) return;
    const pct = Math.round(p * 100);
    bar.setAttribute('aria-valuenow', String(pct));
    $('.up-progress-fill', row).style.transform = `scaleX(${p})`;
    $('.up-progress-pct', row).textContent = `${pct}%`;
  }

  // Link requests run one at a time: the first one creates the draft and
  // every later one must reuse its id. The uploads themselves run in parallel.
  let linkQueue = Promise.resolve();
  const requestLink = (kind, file) => {
    const run = async () => {
      const res = await fetch('/api/producer/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, kind, name: file.name, size: file.size }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not start the upload.');
      submissionId = data.submissionId;
      return data.uploadUrl;
    };
    const p = linkQueue.then(run);
    linkQueue = p.catch(() => {});
    return p;
  };

  const sendFile = (url, file, onProgress) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('The upload failed. Please try again.')));
    xhr.onerror = () => reject(new Error('Connection lost. Please try again.'));
    xhr.send(file);
  });

  async function upload(row, file) {
    const kind = row.dataset.kind;
    const spec = KINDS[kind];
    if (busy.has(kind)) return;
    if (!spec.exts.includes(extOf(file.name))) { paintIdle(row, `Use ${spec.exts.map((e) => `.${e}`).join(' / ')}`); return; }
    if (file.size > spec.max) { paintIdle(row, `Max ${Math.round(spec.max / MB)} MB`); return; }

    busy.add(kind);
    delete done[kind];
    paintBusy(row, file.name);
    if (kind === 'artwork') showArt(file);
    refresh();
    try {
      const url = await requestLink(kind, file);
      await sendFile(url, file, (p) => setProgress(row, p));
      done[kind] = { name: file.name, size: file.size };
      paintDone(row, file);
    } catch (err) {
      paintIdle(row, err.message);
      if (kind === 'artwork') showArt(null);
    } finally {
      busy.delete(kind);
      refresh();
    }
  }

  let artUrl = null;
  function showArt(file) {
    if (artUrl) URL.revokeObjectURL(artUrl);
    artUrl = file ? URL.createObjectURL(file) : null;
    $$('.up-art-thumb img, .up-preview-cover img').forEach((img) => {
      img.hidden = !artUrl;
      if (artUrl) img.src = artUrl; else img.removeAttribute('src');
    });
    $('.up-preview-cover').classList.toggle('has-art', !!artUrl);
  }

  /* ------------------------------- Licenses ------------------------------- */
  function renderTiers() {
    $('#up-tiers').innerHTML = licenses.order.map((t) => {
      const tier = licenses.tiers[t];
      return `
        <div class="up-tier" data-tier="${t}">
          <label class="up-switch">
            <input type="checkbox" name="tier-${t}">
            <span class="up-switch-ui" aria-hidden="true"></span>
            <span class="up-tier-text">
              <b>${esc(tier.name)}${tier.unlimited ? ' <em>Unlimited</em>' : ''}</b>
              <small class="up-tier-files">${esc(tier.highlights[0])}</small>
              <small class="up-tier-lock" hidden></small>
            </span>
          </label>
          <label class="up-price">
            <span class="sr-only">${esc(tier.name)} price in euros</span>
            <span class="up-price-cur" aria-hidden="true">€</span>
            <input type="number" name="price-${t}" inputmode="decimal" min="5" max="10000" step="0.01" placeholder="${PRICE_HINTS[t]}" disabled>
          </label>
        </div>`;
    }).join('');
  }
  // A tier needs its files uploaded first; the switch stays locked until then.
  function syncTiers() {
    if (!licenses) return;
    licenses.order.forEach((t) => {
      const el = $(`.up-tier[data-tier="${t}"]`);
      const sw = form.elements[`tier-${t}`];
      const price = form.elements[`price-${t}`];
      const missing = TIER_NEEDS[t].filter((k) => !done[k]);
      const lock = $('.up-tier-lock', el);
      sw.disabled = missing.length > 0;
      if (sw.disabled) sw.checked = false;
      lock.hidden = !missing.length;
      lock.textContent = missing.length ? `Upload the ${missing.map((k) => FILE_NAMES[k]).join(', ')} to offer this` : '';
      price.disabled = !sw.checked;
      el.classList.toggle('is-on', sw.checked);
      el.classList.toggle('is-locked', sw.disabled);
    });
  }

  /* --------------------------- Preview + checklist ------------------------ */
  const val = (n) => String(form.elements[n].value || '').trim();
  function pricesInEuros() {
    const out = {};
    if (!licenses) return out;
    licenses.order.forEach((t) => {
      if (form.elements[`tier-${t}`].checked) {
        const v = val(`price-${t}`);
        if (v !== '') out[t] = Number(v);
      }
    });
    return out;
  }
  function refresh() {
    syncTiers();
    const prices = pricesInEuros();
    const valid = Object.values(prices).filter((p) => p >= 5 && p <= 10000);
    const bpm = Number(val('bpm'));
    const checks = {
      artwork: !!done.artwork,
      preview: !!done.preview,
      details: !!(val('producerName') && val('title') && Number.isInteger(bpm) && bpm >= 40 && bpm <= 250 && val('key') && val('genre') && val('mood')),
      license: valid.length > 0 && Object.keys(prices).length === valid.length,
      agree: form.elements.agree.checked,
    };
    $$('#up-checklist li').forEach((li) => li.classList.toggle('is-ok', !!checks[li.dataset.check]));

    $('#up-pv-title').textContent = val('title') || 'Untitled beat';
    $('#up-pv-producer').textContent = val('producerName') || 'Your producer name';
    $('#up-pv-chips').innerHTML = [bpm ? `${bpm} BPM` : '', val('key'), val('genre')].filter(Boolean).map((c) => `<span>${esc(c)}</span>`).join('');
    $('#up-pv-price').textContent = valid.length ? `€${Math.min(...valid).toFixed(2)}` : '—';

    $('.up-submit').disabled = !Object.values(checks).every(Boolean) || busy.size > 0;
  }
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);

  /* -------------------------------- Submit -------------------------------- */
  const errorEl = $('#up-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('.up-submit');
    errorEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Submitting…';
    try {
      const res = await fetch('/api/producer/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          submissionId,
          producerName: val('producerName'),
          title: val('title'),
          bpm: Number(val('bpm')),
          key: val('key'),
          genre: val('genre'),
          mood: val('mood'),
          tags: val('tags'),
          typeBeat: val('typeBeat'),
          about: form.elements.about.value,
          prices: pricesInEuros(),
          agree: form.elements.agree.checked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong, please try again.');
      $('#up-done-title').textContent = val('title');
      form.hidden = true;
      $('#up-done').hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      btn.textContent = 'Submit for review';
      refresh();
    }
  });

  /* --------------------------------- Boot --------------------------------- */
  // Signed out -> sign in; not a producer -> explain how to become one.
  fetch('/api/auth/me')
    .then((res) => {
      if (res.status === 401) { window.location.href = 'login.html'; return null; }
      return res.ok ? res.json() : null;
    })
    .then((me) => {
      if (me && me.role !== 'producer') { form.hidden = true; $('#up-gate').hidden = false; }
    })
    .catch(() => {});
  fetch('/api/producer/submissions')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && data.producerName && !val('producerName')) { form.elements.producerName.value = data.producerName; refresh(); }
    })
    .catch(() => {});
  fetch('/data/beat-licenses.json')
    .then((res) => res.json())
    .then((data) => { licenses = data; renderTiers(); refresh(); })
    .catch(() => {});
  refresh();
})();
