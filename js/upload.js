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
  // Same rules as BeatStars: WAV up to 300 MB, MP3 up to 150 MB, stems as
  // a ZIP; audio 1 s to 10 min, 44.1 or 48 kHz, stereo, WAV 16-32 bit,
  // MP3 at least 320 kbps.
  const KINDS = {
    artwork: { exts: ['jpg', 'jpeg', 'png'], max: 10 * MB },
    preview: { exts: ['mp3'], max: 150 * MB, audio: 'mp3' },
    mp3: { exts: ['mp3'], max: 150 * MB, audio: 'mp3' },
    wav: { exts: ['wav'], max: 300 * MB, audio: 'wav' },
    stems: { exts: ['zip'], max: 300 * MB },
    project: { exts: ['zip'], max: 300 * MB },
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

  // Tags: standard list (data/tags.json) as chips, at least 2 of them, plus
  // up to 2 of the producer's own. The hidden 'tags' input holds the result.
  let TAG_RULES = { min: 2, maxTotal: 8, maxCustom: 2 };
  const picked = new Set();
  const ownTags = () => [...new Set(String(form.elements.tagsOwn.value || '').split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, TAG_RULES.maxCustom);
  const syncTags = () => {
    const all = [...picked, ...ownTags().filter((t) => !picked.has(t))].slice(0, TAG_RULES.maxTotal);
    form.elements.tags.value = all.join(', ');
    const n = picked.size;
    const label = $('#up-tags-count');
    label.textContent = n < TAG_RULES.min ? `Pick at least ${TAG_RULES.min} · ${n} selected` : `${n} selected`;
    label.classList.toggle('is-ok', n >= TAG_RULES.min);
    $$('#up-tags .up-tag').forEach((b) => { b.disabled = !picked.has(b.dataset.tag) && all.length >= TAG_RULES.maxTotal; });
  };
  fetch('data/tags.json').then((r) => r.json()).then((cfg) => {
    TAG_RULES = { min: cfg.min, maxTotal: cfg.maxTotal, maxCustom: cfg.maxCustom };
    $('#up-tags').innerHTML = cfg.groups.map((g) => `<div class="up-tag-group"><small>${esc(g.name)}</small><div>${g.tags.map((t) => `<button type="button" class="up-tag" data-tag="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div></div>`).join('');
    syncTags();
  }).catch(() => {});
  $('#up-tags').addEventListener('click', (e) => {
    const b = e.target.closest('.up-tag');
    if (!b) return;
    const t = b.dataset.tag;
    if (picked.has(t)) picked.delete(t); else picked.add(t);
    b.classList.toggle('is-on', picked.has(t));
    b.setAttribute('aria-pressed', String(picked.has(t)));
    syncTags();
    refresh();
  });
  form.elements.tagsOwn.addEventListener('input', syncTags);

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
      <button type="button" class="up-btn" data-pick>${ICON_UP}Choose file</button>`;
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
      return data;
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

  /* ----------------------------- Audio checks ----------------------------- */
  // Read the file's own header before uploading, so a wrong export is
  // caught in a second instead of after a long upload.
  const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SRS = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const bytesOf = async (file, n) => new Uint8Array(await file.slice(0, Math.min(file.size, n)).arrayBuffer());
  const str = (b, i, n) => String.fromCharCode(...b.subarray(i, i + n));
  const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const u16 = (b, i) => b[i] | (b[i + 1] << 8);
  const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

  async function wavInfo(file) {
    const b = await bytesOf(file, 65536);
    if (str(b, 0, 4) !== 'RIFF' || str(b, 8, 4) !== 'WAVE') return { ok: false, error: "This isn't a valid WAV file." };
    let off = 12; let fmt = null; let data = null;
    while (off + 8 <= b.length) {
      const id = str(b, off, 4); const len = u32(b, off + 4);
      if (id === 'fmt ') fmt = { format: u16(b, off + 8), channels: u16(b, off + 10), sampleRate: u32(b, off + 12), byteRate: u32(b, off + 16), bits: u16(b, off + 22) };
      if (id === 'data') { data = len; break; }
      off += 8 + len + (len % 2);
    }
    if (!fmt) return { ok: false, error: "This WAV has no format header." };
    const bytes = data && data !== 0xffffffff ? data : file.size - off - 8;
    return { ok: true, ...fmt, duration: fmt.byteRate ? Math.round(bytes / fmt.byteRate) : null };
  }
  async function mp3Info(file) {
    const b = await bytesOf(file, 262144);
    let p = str(b, 0, 3) === 'ID3' ? 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) : 0;
    const start = p;
    for (; p + 4 <= b.length; p++) {
      if (b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) continue;
      const ver = (b[p + 1] >> 3) & 3; const layer = (b[p + 1] >> 1) & 3; const bri = b[p + 2] >> 4; const sri = (b[p + 2] >> 2) & 3;
      if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) continue;
      const mono = (b[p + 3] >> 6) === 3; const sampleRate = SRS[ver][sri]; const frameKbps = (ver === 3 ? BR_V1 : BR_V2)[bri];
      const xo = p + 4 + (ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
      const tag = str(b, xo, 4);
      let duration = null; let kbps = frameKbps;
      if ((tag === 'Xing' || tag === 'Info') && xo + 12 <= b.length && (u32be(b, xo + 4) & 1)) {
        duration = (u32be(b, xo + 8) * (ver === 3 ? 1152 : 576)) / sampleRate;
        if (tag === 'Xing' && duration) kbps = Math.round(((file.size - start) * 8) / duration / 1000);
      }
      if (duration == null) duration = ((file.size - start) * 8) / (frameKbps * 1000);
      return { ok: true, kbps, sampleRate, channels: mono ? 1 : 2, duration: Math.round(duration) };
    }
    return { ok: false, error: "This isn't a valid MP3 file." };
  }
  async function audioProblem(kind, file) {
    const type = KINDS[kind].audio;
    if (!type) return null;
    const i = type === 'wav' ? await wavInfo(file) : await mp3Info(file);
    if (!i.ok) return i.error;
    const len = i.duration != null ? `${Math.floor(i.duration / 60)}:${String(i.duration % 60).padStart(2, '0')}` : '';
    if (i.duration != null && (i.duration < 1 || i.duration > 600)) return `Must be 1 second to 10 minutes long (this is ${len}).`;
    if (i.sampleRate < 44100 || i.sampleRate > 48000) return `Export at 44.1 or 48 kHz (this is ${(i.sampleRate / 1000).toFixed(1)} kHz).`;
    if (i.channels < 2) return 'Export in stereo (this file is mono).';
    if (type === 'wav' && (i.bits < 16 || i.bits > 32)) return `Export at 16 to 32-bit (this is ${i.bits}-bit).`;
    if (type === 'mp3' && i.kbps < 320) return `Export at 320 kbps (this is ${i.kbps} kbps).`;
    return null;
  }

  // Files over 150 MB go up in 4 MB pieces through our server.
  async function sendChunks(kind, file, chunkSize, onProgress) {
    let session = '';
    for (let off = 0; off < file.size; off += chunkSize) {
      const piece = file.slice(off, Math.min(file.size, off + chunkSize));
      let tries = 0;
      for (;;) {
        try {
          const res = await fetch(`/api/producer/chunk?submissionId=${submissionId}&kind=${kind}&offset=${off}&session=${encodeURIComponent(session)}`, {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: piece,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || 'Part of the upload failed.');
          session = data.session;
          break;
        } catch (err) {
          tries += 1;
          if (tries >= 3) throw err;
          await new Promise((r) => setTimeout(r, 1000 * tries));
        }
      }
      onProgress(Math.min(1, (off + piece.size) / file.size));
    }
  }

  async function upload(row, file) {
    const kind = row.dataset.kind;
    const spec = KINDS[kind];
    if (busy.has(kind)) return;
    if (!spec.exts.includes(extOf(file.name))) { paintIdle(row, `Use ${spec.exts.map((e) => `.${e}`).join(' / ')}`); return; }
    // Cover: not square, too big or too heavy -> crop it to a square first.
    if (kind === 'artwork' && window.CSCoverCrop) {
      const out = await window.CSCoverCrop.prepare(file);
      if (!out) { if (!done.artwork) paintIdle(row); return; }
      if (out.error) { paintIdle(row, out.error); return; }
      file = out.file;
    }
    if (file.size > spec.max) { paintIdle(row, `Max ${Math.round(spec.max / MB)} MB`); return; }

    const problem = await audioProblem(kind, file).catch(() => null);
    if (problem) { paintIdle(row, problem); return; }

    busy.add(kind);
    delete done[kind];
    paintBusy(row, file.name);
    if (kind === 'artwork') showArt(file);
    refresh();
    try {
      const link = await requestLink(kind, file);
      if (link.chunked) await sendChunks(kind, file, link.chunkSize, (p) => setProgress(row, p));
      else await sendFile(link.uploadUrl, file, (p) => setProgress(row, p));
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
            <small class="up-earn" data-earn="${t}"></small>
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
      details: !!(val('producerName') && val('title') && Number.isInteger(bpm) && bpm >= 40 && bpm <= 250 && val('key') && val('genre') && val('mood') && picked.size >= TAG_RULES.min),
      license: valid.length > 0 && Object.keys(prices).length === valid.length,
      agree: form.elements.agree.checked,
    };
    $$('#up-checklist li').forEach((li) => li.classList.toggle('is-ok', !!checks[li.dataset.check]));
    // Steps bar: done when every check of that step passes.
    const steps = { files: checks.artwork && checks.preview, details: checks.details, license: checks.license, agree: checks.agree };
    $$('#up-steps li').forEach((li) => li.classList.toggle('is-ok', !!steps[li.dataset.step]));

    $('#up-pv-title').textContent = val('title') || 'Untitled track';
    $('#up-pv-producer').textContent = val('producerName') || 'Your producer name';
    $('#up-pv-chips').innerHTML = [bpm ? `${bpm} BPM` : '', val('key'), val('genre')].filter(Boolean).map((c) => `<span>${esc(c)}</span>`).join('');
    // The producer keeps 80% of every sale (see the Payouts section).
    licenses && licenses.order.forEach((t) => {
      const el = $(`[data-earn="${t}"]`);
      const p = prices[t];
      if (el) el.textContent = p >= 5 ? `You earn €${(Math.floor(p * 80) / 100).toFixed(2)}` : '';
    });
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
          contactInstagram: val('contactInstagram'),
          contactEmail: val('contactEmail'),
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
  // Contact fields start from the producer's profile.
  fetch('/api/profile/me')
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const p = data && data.profile;
      if (!p) return;
      if (p.instagram && !val('contactInstagram')) form.elements.contactInstagram.value = `@${p.instagram}`;
      if (p.contactEmail && !val('contactEmail')) form.elements.contactEmail.value = p.contactEmail;
    })
    .catch(() => {});
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
