// Track review (admin-review.html): the owner's queue of producer
// submissions. Approve, or send back with a note; the server emails the
// producer. Only accounts in ADMIN_EMAILS get data from the API.
(() => {
  'use strict';
  const page = document.querySelector('[data-review-page]');
  if (!page) return;

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MB = 1024 * 1024;
  const size = (b) => (b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const when = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const FILE_LABELS = { artwork: 'Cover', preview: 'Preview MP3', mp3: 'Untagged MP3', wav: 'WAV', stems: 'Stems', project: 'Project' };
  const TIER_LABELS = { mp3: 'MP3 Lease', wav: 'WAV Unlimited', trackout: 'Trackout Unlimited', project: 'Project Unlimited' };
  const list = $('#rv-list');
  let status = 'pending';

  const ORDER = ['artwork', 'preview', 'mp3', 'wav', 'stems', 'project'];
  const HINTS = {
    preview: 'Store preview. The Creative Sound voice tag is added when you approve.',
    mp3: 'Must be untagged.',
    wav: 'Must be untagged. 24-bit preferred.',
    stems: 'Every track of the beat, labelled.',
    project: 'Project file plus the samples it uses.',
  };
  const ICON_DL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>';
  const playerHtml = (src, label) => `
    <div class="rv-player" data-src="${esc(src)}">
      <button type="button" class="rv-play" aria-label="Play ${esc(label)}">
        <svg class="rv-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>
        <svg class="rv-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>
      </button>
      <span class="rv-time" data-cur>0:00</span>
      <div class="rv-bar" role="slider" tabindex="0" aria-label="Seek ${esc(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <span class="rv-bar-fill"></span><span class="rv-bar-knob"></span>
      </div>
      <span class="rv-time" data-dur>–:––</span>
    </div>`;

  // One row per uploaded file: what it is, a way to check it right here
  // (player, image size, WAV format, ZIP contents) and a download link.
  function fileRow(s, kind) {
    const f = (s.files || {})[kind];
    const link = s.links && s.links[kind];
    const label = FILE_LABELS[kind];
    if (!f) return `<div class="rv-frow is-missing"><div class="rv-fhead"><b>${label}</b><span class="rv-fmeta">Not uploaded</span></div></div>`;
    const dl = link ? `<a href="${esc(link)}" class="rv-dl" target="_blank" rel="noopener" download>${ICON_DL}Download</a>` : '';
    // rev: a file re-uploaded with pending changes (checked instead of the live one).
    const rev = (s.newFiles || []).includes(kind) ? ' data-rev="1"' : '';
    let check = '';
    if (!link) check = '<p class="rv-fnote is-bad">Link unavailable. Check Dropbox.</p>';
    else if (kind === 'artwork') check = `<div class="rv-art"><a href="${esc(link)}" target="_blank" rel="noopener"><img src="${esc(link)}" alt="Cover art" loading="lazy" data-art-check></a><span class="rv-fnote" data-art-info>Checking size…</span></div>`;
    else if (['preview', 'mp3', 'wav'].includes(kind)) check = `${playerHtml(link, label)}<p class="rv-fnote" data-inspect="${kind}"${rev}>Reading format…</p>`;
    else check = `<button type="button" class="rv-peek" data-peek="${kind}"${rev}>Show what's inside</button><div class="rv-zip" hidden></div>`;
    return `
      <div class="rv-frow" data-kind="${kind}">
        <div class="rv-fhead">
          <b>${label}</b>
          <span class="rv-fmeta">${esc(f.name)} · ${size(f.size || 0)}</span>
          ${dl}
        </div>
        ${HINTS[kind] ? `<p class="rv-fhint">${HINTS[kind]}</p>` : ''}
        ${check}
      </div>`;
  }

  // Changes to an approved track: show the proposed version (new details,
  // new files where re-uploaded) plus a list of what changed.
  function proposed(s) {
    if (!s.isChange || !s.changes) return s;
    const d = s.changes.data || {};
    const newFiles = Object.keys(s.changes.files || {});
    const money = (p) => Object.entries(p || {}).map(([t, c]) => `${TIER_LABELS[t] || t} €${(c / 100).toFixed(2)}`).join(', ') || 'none';
    const rows = [
      ['Title', s.title, d.title], ['Producer', s.producerName, d.producerName], ['BPM', s.bpm, d.bpm], ['Key', s.key, d.key],
      ['Genre', s.genre, d.genre], ['Mood', s.mood, d.mood], ['Prices', money(s.prices), money(d.prices)],
      ['Tags', (s.tags || []).join(', '), (d.tags || []).join(', ')], ['Description', s.about || '', d.about || ''],
    ].filter(([, a, b]) => String(a == null ? '' : a) !== String(b == null ? '' : b));
    const links = { ...(s.links || {}) };
    newFiles.forEach((k) => { links[k] = s.links ? s.links[`rev:${k}`] : null; });
    return {
      ...s, title: d.title, producerName: d.producerName, bpm: d.bpm, key: d.key, genre: d.genre, mood: d.mood,
      tags: d.tags, typeBeat: d.typeBeat, about: d.about, prices: d.prices,
      files: { ...(s.files || {}), ...(s.changes.files || {}) }, links, diff: rows, newFiles,
    };
  }

  function card(s) {
    s = proposed(s);
    const reviewable = s.status === 'pending' || s.isChange;
    const prices = Object.entries(s.prices || {}).map(([t, c]) => `<span>${TIER_LABELS[t] || t}<b>€${(c / 100).toFixed(2)}</b></span>`).join('');
    const tags = [...(s.tags || []).map((t) => `#${t}`), ...(s.typeBeat || []).map((t) => `${t} type beat`)];
    const kinds = ORDER.filter((k) => (s.files || {})[k] || ['artwork', 'preview'].includes(k));
    return `
      <article class="up-card rv-card${s.isChange ? ' is-change' : ''}" data-id="${s.id}"${s.isChange ? ` data-change="1" data-new-preview="${(s.newFiles || []).includes('preview') ? '1' : '0'}"` : ''}>
        ${s.isChange ? `<div class="rv-changes"><b>Changes to an approved track</b><small>The store keeps the current version until you approve.</small>${s.diff.length ? `<ul>${s.diff.map(([k, a, b]) => `<li><span>${esc(k)}</span><del>${esc(a == null || a === '' ? '—' : a)}</del><ins>${esc(b == null || b === '' ? '—' : b)}</ins></li>`).join('')}</ul>` : ''}${s.newFiles.length ? `<p>New files: ${s.newFiles.map((k) => esc(FILE_LABELS[k] || k)).join(', ')}</p>` : ''}</div>` : ''}
        <div class="rv-top">
          <div class="rv-cover">${s.links && s.links.artwork ? `<img src="${esc(s.links.artwork)}" alt="">` : '<span>No cover</span>'}</div>
          <div class="rv-info">
            <span class="rv-id">#${s.id} · ${esc(when(s.submittedAt))}</span>
            <h2>${esc(s.title)}</h2>
            <p class="rv-by">${esc(s.producerName)} · <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
            <div class="rv-verify" data-user="${s.userId}">
              ${s.verifyRequested ? '<span class="rv-verify-ask">Asked for verification</span>' : ''}
              <span class="rv-verify-state ${s.producerVerified ? 'is-on' : ''}">${s.producerVerified ? 'Verified producer' : 'Not verified'}</span>
              <button type="button" class="rv-verify-btn" data-verify="${s.producerVerified ? '0' : '1'}">${s.producerVerified ? 'Remove verification' : 'Verify producer'}</button>
            </div>
            <div class="up-preview-chips rv-chips">${[`${s.bpm} BPM`, s.key, s.genre, s.mood].filter(Boolean).map((c) => `<span>${esc(c)}</span>`).join('')}</div>
            ${tags.length ? `<p class="rv-tags">${tags.map(esc).join(' · ')}</p>` : ''}
            <div class="rv-prices">${prices}</div>
          </div>
        </div>
        ${s.about ? `<p class="rv-about">${esc(s.about)}</p>` : ''}
        ${reviewable ? `
        <div class="rv-files-wrap">
          <h3>Files <span>${Object.keys(s.files || {}).length} uploaded</span></h3>
          <div class="rv-files">${kinds.map((k) => fileRow(s, k)).join('')}</div>
        </div>` : `
        <details class="rv-files-wrap rv-files-more">
          <summary><h3>Files <span>${Object.keys(s.files || {}).length} uploaded</span></h3></summary>
          <div class="rv-files">${kinds.map((k) => fileRow(s, k)).join('')}</div>
        </details>`}
        ${reviewable ? `
          <div class="rv-auto" data-auto><span class="rv-auto-dot"></span><span>Running the automatic checks…</span></div>
          <p class="rv-prep" data-prep hidden></p>
          <div class="rv-decide">
            <label class="up-field up-field-wide"><span>Note to the producer <i>Required to send back, optional to approve</i></span>
              <textarea rows="2" maxlength="1000" placeholder="E.g. the WAV still has the voice tag at 0:12."></textarea>
            </label>
            <div class="rv-actions">
              <button type="button" class="btn btn-ghost rv-reject" data-decision="reject">Send back</button>
              <button type="button" class="btn btn-primary rv-approve" data-decision="approve">${s.isChange ? 'Approve changes' : 'Approve'}</button>
            </div>
            <p class="up-error rv-card-error" role="alert" hidden></p>
          </div>`
        : `<p class="rv-result ${s.status === 'approved' ? 'is-ok' : 'is-bad'}">${s.status === 'approved' ? 'Approved' : 'Sent back'} ${esc(when(s.reviewedAt))}${s.reviewNote ? ` · “${esc(s.reviewNote)}”` : ''}${s.storeUrl ? ` · <a href="${esc(s.storeUrl)}" target="_blank" rel="noopener">View in store</a>` : ''}</p>
          <div class="rv-reopen"><button type="button" class="btn btn-ghost" data-reopen="${s.id}">Move back to review</button><small>Takes it off the store until you approve it again (new voice tag, new check).</small></div>`}
      </article>`;
  }

  // Producers tab: everyone who uploads, verification requests first.
  function producerRow(p) {
    return `
      <article class="up-card rv-producer">
        <div class="rv-producer-main">
          <b>${esc(p.name || 'No producer name yet')}</b>
          <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>
          <span class="rv-producer-stats">${p.total} sent · ${p.pending} in review · ${p.approved} approved · ${p.rejected} sent back${p.lastSubmitted ? ` · last ${esc(when(p.lastSubmitted))}` : ''}</span>
        </div>
        <div class="rv-verify" data-user="${p.userId}">
          ${p.verifyRequested ? '<span class="rv-verify-ask">Asked for verification</span>' : ''}
          <span class="rv-verify-state ${p.verified ? 'is-on' : ''}">${p.verified ? 'Verified producer' : 'Not verified'}</span>
          <button type="button" class="rv-verify-btn" data-verify="${p.verified ? '0' : '1'}">${p.verified ? 'Remove verification' : 'Verify producer'}</button>
        </div>
      </article>`;
  }
  async function loadProducers() {
    const res = await fetch('/api/review/producers');
    if (res.status === 401) { window.location.href = 'login.html'; return; }
    if (res.status === 403) { $('#rv-body').hidden = true; $('#rv-gate').hidden = false; return; }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error((data && data.error) || 'Could not load the producers.');
    const asks = data.producers.filter((p) => p.verifyRequested).length;
    $('#rv-np').textContent = asks ? String(asks) : '';
    list.innerHTML = data.producers.length ? data.producers.map(producerRow).join('') : '<p class="pa-none">No producer accounts yet.</p>';
  }

  async function load() {
    // The list is rebuilt, so stop whatever preview was playing.
    audio.pause();
    current = null;
    list.setAttribute('aria-busy', 'true');
    $('#rv-error').hidden = true;
    if (status === 'producers') {
      try { await loadProducers(); } catch (err) { list.innerHTML = ''; $('#rv-error').textContent = err.message; $('#rv-error').hidden = false; } finally { list.removeAttribute('aria-busy'); }
      return;
    }
    try {
      const res = await fetch(`/api/review/list?status=${status}`);
      if (res.status === 401) { window.location.href = 'login.html'; return; }
      if (res.status === 403) { $('#rv-body').hidden = true; $('#rv-gate').hidden = false; return; }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data && data.error) || 'Could not load the queue.');
      $('#rv-n').textContent = data.pendingCount ? String(data.pendingCount) : '';
      list.innerHTML = data.submissions.length ? data.submissions.map(card).join('')
        : `<p class="pa-none">${status === 'pending' ? 'Nothing to review. All caught up.' : 'Nothing here yet.'}</p>`;
      runChecks();
      autoPrepare();
    } catch (err) {
      list.innerHTML = '';
      $('#rv-error').textContent = err.message;
      $('#rv-error').hidden = false;
    } finally {
      list.removeAttribute('aria-busy');
    }
  }

  page.querySelector('.rv-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-status]');
    if (!btn || btn.dataset.status === status) return;
    status = btn.dataset.status;
    page.querySelectorAll('.rv-tabs button').forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    load();
  });

  // Panel in the card with a player for the tagged preview; resolves true on
  // "Confirm & publish", false on "Cancel".
  function confirmTagged(cardEl, mp3) {
    const url = URL.createObjectURL(mp3);
    const box = document.createElement('div');
    box.className = 'rv-tagcheck';
    box.innerHTML = `
      <div class="rv-tagcheck-head"><b>Check the store preview</b><small>This is what people will hear, with the voice tag every 20 seconds. Publish it?</small></div>
      <audio controls preload="auto" src="${url}"></audio>
      <div class="rv-tagcheck-actions">
        <button type="button" class="btn btn-ghost" data-tc="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-tc="ok">Confirm &amp; publish</button>
      </div>`;
    const decide = cardEl.querySelector('.rv-decide') || cardEl;
    decide.parentNode.insertBefore(box, decide.nextSibling);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return new Promise((resolve) => {
      box.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-tc]');
        if (!b) return;
        const audio = box.querySelector('audio');
        audio.pause();
        box.remove();
        URL.revokeObjectURL(url);
        resolve(b.dataset.tc === 'ok');
      });
    });
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-decision]');
    if (!btn) return;
    const cardEl = btn.closest('.rv-card');
    const note = $('textarea', cardEl).value.trim();
    const err = $('.rv-card-error', cardEl);
    err.hidden = true;
    if (btn.dataset.decision === 'reject' && !note) {
      err.textContent = 'Write a note so the producer knows what to fix.';
      err.hidden = false;
      $('textarea', cardEl).focus();
      return;
    }
    cardEl.querySelectorAll('[data-decision]').forEach((b) => { b.disabled = true; });
    const label = btn.textContent;
    try {
      // Approve: first put the "Creative Sound" voice tag on the public
      // preview (mixed here, uploaded straight to Dropbox).
      const isChange = cardEl.dataset.change === '1';
      if (btn.dataset.decision === 'approve' && (!isChange || cardEl.dataset.newPreview === '1')) {
        // Usually ready already (prepared in the background).
        btn.textContent = 'Preparing store preview…';
        const { mp3, urls } = await prepare(cardEl);
        // Listen to the tagged preview before it goes public.
        btn.textContent = label;
        const ok = await confirmTagged(cardEl, mp3);
        if (!ok) {
          cardEl.querySelectorAll('[data-decision]').forEach((b) => { b.disabled = false; });
          return;
        }
        btn.textContent = 'Uploading tagged preview…';
        const upload = (url) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: mp3 });
        let up = await upload(urls.uploadUrl);
        // Upload links expire after a few hours: get a fresh one once.
        if (!up.ok) up = await upload((await tagUrls(cardEl)).uploadUrl);
        if (!up.ok) throw new Error('Could not upload the tagged preview. Try again.');
        prepared.delete(prepKey(cardEl));
        prepState.delete(prepKey(cardEl));
        btn.textContent = 'Approving…';
      }
      const res = await fetch('/api/review/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(cardEl.dataset.id), decision: isChange ? `${btn.dataset.decision}-changes` : btn.dataset.decision, note }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the decision.');
      // Fold the card away, then refresh the counts.
      const done = () => load();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) done();
      else cardEl.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' }).finished.then(done, done);
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
      btn.textContent = label;
      cardEl.querySelectorAll('[data-decision]').forEach((b) => { b.disabled = false; });
    }
  });

  // Put an approved / sent-back track back in the review queue.
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-reopen]');
    if (!btn) return;
    if (!window.confirm('Move this track back to review? It leaves the store until you approve it again.')) return;
    btn.disabled = true;
    btn.textContent = 'Moving…';
    try {
      const res = await fetch('/api/review/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: Number(btn.dataset.reopen), decision: 'reopen' }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not move it back.');
      load();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Move back to review';
      window.alert(err.message);
    }
  });

  /* ---------------------------- Verified producer --------------------------- */
  // The badge is only ever turned on here. Every card of the same producer
  // updates together.
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-verify]');
    if (!btn) return;
    const box = btn.closest('.rv-verify');
    const userId = Number(box.dataset.user);
    const verified = btn.dataset.verify === '1';
    btn.disabled = true;
    try {
      const res = await fetch('/api/review/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, verified }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      list.querySelectorAll(`.rv-verify[data-user="${userId}"]`).forEach((el) => {
        const state = el.querySelector('.rv-verify-state');
        const b = el.querySelector('[data-verify]');
        state.classList.toggle('is-on', data.verified);
        state.textContent = data.verified ? 'Verified producer' : 'Not verified';
        b.dataset.verify = data.verified ? '0' : '1';
        b.textContent = data.verified ? 'Remove verification' : 'Verify producer';
        const ask = el.querySelector('.rv-verify-ask');
        if (ask) ask.remove();
      });
    } catch (err) {
      window.alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  /* ------------------------------- File checks ------------------------------ */
  const fmtDur = (t) => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
  const note = (el, text, bad) => { el.textContent = text; el.classList.toggle('is-bad', !!bad); el.classList.toggle('is-ok', !bad); };
  const inspect = (id, kind, rev) => fetch(`/api/review/inspect?id=${id}&kind=${kind}${rev ? '&rev=1' : ''}`).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Could not read the file.');
    return data;
  });

  // ZIP / RAR contents, read once per card and shared by the automatic
  // check and the "Show what's inside" button. Resolves to the problems found.
  const zipRead = new WeakMap();
  function readZip(btn) {
    if (zipRead.has(btn)) return zipRead.get(btn);
    const box = btn.nextElementSibling;
    const label = FILE_LABELS[btn.dataset.peek];
    box.innerHTML = '<p class="rv-fnote">Reading the archive…</p>';
    const job = inspect(btn.closest('.rv-card').dataset.id, btn.dataset.peek, btn.dataset.rev).then((d) => {
      if (d.kind === 'other') { box.innerHTML = `<p class="rv-fnote">${esc(d.note || 'This file type can only be checked after downloading.')}</p>`; return []; }
      if (!d.ok) { box.innerHTML = `<p class="rv-fnote is-bad">${esc(d.error)}</p>`; return [`${label}: ${d.error}`]; }
      box.innerHTML = `
        <p class="rv-fnote ${d.audio ? 'is-ok' : 'is-bad'}">${d.files} file${d.files === 1 ? '' : 's'}, ${d.audio} audio${d.audio ? '' : ': no audio files found'}${d.truncated ? ' (showing the first ones)' : ''}</p>
        <ul class="rv-zip-list">${d.entries.map((x) => `<li><span>${esc(x.name.replace(/\\/g, '/'))}</span><small>${size(x.size)}</small></li>`).join('')}</ul>`;
      btn.textContent = box.hidden ? `Show what's inside (${d.files} files)` : 'Hide contents';
      return d.audio ? [] : [`${label}: the archive has no audio files`];
    }).catch((err) => { box.innerHTML = `<p class="rv-fnote is-bad">${esc(err.message)}</p>`; return [`${label}: could not be read (${err.message})`]; });
    zipRead.set(btn, job);
    return job;
  }

  // Every check of a card (cover, audio formats, archives). On cards to
  // review they run at once and end in a summary; history cards check their
  // files only when opened.
  function runChecks(root = list) {
    root.querySelectorAll('.rv-card').forEach((cardEl) => {
      if (cardEl.dataset.checked) return;
      const reviewable = !!cardEl.querySelector('[data-auto]');
      const more = cardEl.querySelector('.rv-files-more');
      if (!reviewable && !(more && more.open)) return;
      cardEl.dataset.checked = '1';
      const id = cardEl.dataset.id;
      const tasks = [];
      // Cover: real pixel size, square and at least 1000 px.
      cardEl.querySelectorAll('img[data-art-check]').forEach((img) => {
        img.loading = 'eager';
        tasks.push(new Promise((resolve) => {
          const info = img.closest('.rv-art').querySelector('[data-art-info]');
          const check = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            const issues = [w !== h ? 'not square' : '', Math.min(w, h) < 1000 ? 'smaller than 1000 px' : ''].filter(Boolean);
            note(info, `${w} × ${h} px${issues.length ? `: ${issues.join(', ')}` : ', looks good'}`, issues.length > 0);
            resolve(issues.length ? [`Cover: ${w} × ${h} px, ${issues.join(' and ')}`] : []);
          };
          if (img.complete && img.naturalWidth) check(); else img.addEventListener('load', check, { once: true });
          img.addEventListener('error', () => { note(info, 'Could not open the image.', true); resolve(['Cover: the image could not be opened']); }, { once: true });
        }));
      });
      // Audio: format against the store's file rules (problems come from the server).
      cardEl.querySelectorAll('[data-inspect]').forEach((el) => {
        const label = FILE_LABELS[el.dataset.inspect];
        tasks.push(inspect(id, el.dataset.inspect, el.dataset.rev).then((d) => {
          if (!d.ok) { note(el, d.error, true); return [`${label}: ${d.error}`]; }
          const quality = d.kind === 'wav' ? (d.float ? '32-bit float' : `${d.bits}-bit`) : `${d.kbps} kbps${d.vbr ? ' VBR' : ''}`;
          const issues = d.problems || [];
          note(el, `${quality} · ${(d.sampleRate / 1000).toFixed(1)} kHz · ${d.channels === 1 ? 'mono' : d.channels === 2 ? 'stereo' : `${d.channels} channels`}${d.duration ? ` · ${fmtDur(d.duration)}` : ''}${issues.length ? ` · ${issues.join(', ')}` : ' · Meets the file rules'}`, issues.length > 0);
          return issues.length ? [`${label}: ${issues.join(', ')}`] : [];
        }).catch((err) => { note(el, err.message, true); return [`${label}: could not be read (${err.message})`]; }));
      });
      if (reviewable) {
        cardEl.querySelectorAll('[data-peek]').forEach((btn) => tasks.push(readZip(btn)));
        Promise.all(tasks).then((lists) => paintAuto(cardEl, lists.flat()));
      }
    });
  }

  // Summary of the automatic checks, with the problems ready to send back.
  function paintAuto(cardEl, problems) {
    const box = cardEl.querySelector('[data-auto]');
    if (!box) return;
    if (!problems.length) {
      box.className = 'rv-auto is-ok';
      box.innerHTML = '<span class="rv-auto-dot"></span><span><b>All automatic checks passed.</b> Cover, audio formats and archives meet the file rules. Give it a listen and approve.</span>';
      return;
    }
    box.className = 'rv-auto is-bad';
    box.dataset.note = `Please fix ${problems.length === 1 ? 'this' : 'these'} and send the track again:\n${problems.map((p) => `- ${p}`).join('\n')}`;
    box.innerHTML = `<span class="rv-auto-dot"></span><div><b>${problems.length} problem${problems.length === 1 ? '' : 's'} found</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><button type="button" class="rv-auto-note" data-use-note>Use as note to the producer</button></div>`;
  }
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-use-note]');
    if (!b) return;
    const cardEl = b.closest('.rv-card');
    const ta = $('textarea', cardEl);
    ta.value = b.closest('[data-auto]').dataset.note;
    ta.focus();
  });
  // History cards: check the files when they're opened.
  list.addEventListener('toggle', (e) => { if (e.target.matches && e.target.matches('.rv-files-more') && e.target.open) runChecks(); }, true);

  // ZIP / RAR: show or hide what's inside.
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-peek]');
    if (!btn) return;
    const box = btn.nextElementSibling;
    if (!box.hidden) { box.hidden = true; btn.textContent = "Show what's inside"; return; }
    box.hidden = false;
    btn.textContent = 'Hide contents';
    readZip(btn);
  });

  /* ------------------------- Store preview, prepared ------------------------ */
  // The voice-tagged preview is mixed in the background as soon as the queue
  // loads (one track at a time), so Approve goes straight to the final check.
  const prepared = new Map(); // "id:n" / "id:c" -> Promise<{ mp3, urls }>
  const prepState = new Map(); // same key -> { text, cls }
  let prepQueue = Promise.resolve();
  const prepKey = (cardEl) => `${cardEl.dataset.id}:${cardEl.dataset.change === '1' ? 'c' : 'n'}`;
  const needsTag = (cardEl) => !!cardEl.querySelector('[data-auto]') && (cardEl.dataset.change !== '1' || cardEl.dataset.newPreview === '1');
  const paintPrep = (key) => {
    const st = prepState.get(key);
    const [id] = key.split(':');
    const el = list.querySelector(`.rv-card[data-id="${id}"] [data-prep]`);
    if (!el || !st) return;
    el.hidden = false;
    el.textContent = st.text;
    el.className = `rv-prep ${st.cls || ''}`;
  };
  const setPrep = (key, text, cls) => { prepState.set(key, { text, cls }); paintPrep(key); };
  const tagUrls = (cardEl) => fetch('/api/review/tag', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: Number(cardEl.dataset.id), changes: cardEl.dataset.change === '1' }),
  }).then(async (r) => {
    const urls = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(urls.error || 'Could not prepare the voice tag.');
    return urls;
  });
  function prepare(cardEl) {
    const key = prepKey(cardEl);
    if (!prepared.has(key)) {
      setPrep(key, 'Store preview: waiting…');
      const job = prepQueue.then(async () => {
        if (!window.CSVoiceTag) throw new Error('Voice tag tool not loaded. Reload the page.');
        setPrep(key, 'Store preview: downloading…');
        const urls = await tagUrls(cardEl);
        const mp3 = await window.CSVoiceTag.tag(urls.sourceUrl, (msg) => setPrep(key, `Store preview: ${msg.replace(/…$/, '')}…`), { producerTagUrl: urls.producerTagUrl });
        setPrep(key, 'Store preview with the voice tag is ready.', 'is-ok');
        return { mp3, urls };
      });
      prepQueue = job.catch(() => {});
      prepared.set(key, job);
      job.catch((err) => { prepared.delete(key); setPrep(key, `Store preview: ${err.message} It will be retried when you approve.`, 'is-bad'); });
    }
    return prepared.get(key);
  }
  const autoPrepare = () => list.querySelectorAll('.rv-card').forEach((cardEl) => {
    const key = prepKey(cardEl);
    if (prepState.has(key)) paintPrep(key);
    if (needsTag(cardEl)) prepare(cardEl).catch(() => {});
  });

  /* ------------------------------ Preview player ---------------------------- */
  // One shared <audio>; each card's player drives it. Starting one stops
  // the other. The bar seeks on click/drag and with the arrow keys.
  const audio = new Audio();
  audio.preload = 'none';
  let current = null;
  const fmt = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '–:––');
  const paint = () => {
    if (!current) return;
    const p = audio.duration ? audio.currentTime / audio.duration : 0;
    current.style.setProperty('--p', p);
    current.querySelector('[data-cur]').textContent = fmt(audio.currentTime);
    current.querySelector('[data-dur]').textContent = fmt(audio.duration);
    current.querySelector('.rv-bar').setAttribute('aria-valuenow', String(Math.round(p * 100)));
  };
  const setPlaying = (on) => { if (current) current.classList.toggle('is-playing', on); };
  audio.addEventListener('timeupdate', paint);
  audio.addEventListener('loadedmetadata', paint);
  audio.addEventListener('play', () => setPlaying(true));
  audio.addEventListener('pause', () => setPlaying(false));
  audio.addEventListener('ended', () => { setPlaying(false); audio.currentTime = 0; paint(); });

  const select = (player) => {
    if (current === player) return;
    if (current) { current.classList.remove('is-playing'); current.style.setProperty('--p', 0); current.querySelector('[data-cur]').textContent = '0:00'; }
    current = player;
    audio.src = player.dataset.src;
  };
  const seekTo = (player, clientX) => {
    select(player);
    const r = player.querySelector('.rv-bar').getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const go = () => { audio.currentTime = p * audio.duration; paint(); };
    if (audio.duration) { go(); return; }
    audio.addEventListener('loadedmetadata', go, { once: true });
    audio.load();
  };

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.rv-play');
    if (!btn) return;
    const player = btn.closest('.rv-player');
    select(player);
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  });
  list.addEventListener('pointerdown', (e) => {
    const bar = e.target.closest('.rv-bar');
    if (!bar) return;
    const player = bar.closest('.rv-player');
    bar.setPointerCapture(e.pointerId);
    player.classList.add('is-seeking');
    seekTo(player, e.clientX);
    const move = (ev) => seekTo(player, ev.clientX);
    const up = () => { player.classList.remove('is-seeking'); bar.removeEventListener('pointermove', move); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up, { once: true });
  });
  list.addEventListener('keydown', (e) => {
    const bar = e.target.closest('.rv-bar');
    if (!bar || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    select(bar.closest('.rv-player'));
    if (audio.duration) { audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + (e.key === 'ArrowRight' ? 5 : -5))); paint(); }
  });

  // admin-review.html#producers (link in the verification email) opens that tab.
  if (location.hash === '#producers') {
    status = 'producers';
    page.querySelectorAll('.rv-tabs button').forEach((b) => { const on = b.dataset.status === 'producers'; b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', String(on)); });
  }
  load();
})();
