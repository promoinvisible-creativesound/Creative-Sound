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
    preview: 'Should have the voice tag.',
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
    let check = '';
    if (!link) check = '<p class="rv-fnote is-bad">Link unavailable. Check Dropbox.</p>';
    else if (kind === 'artwork') check = `<div class="rv-art"><a href="${esc(link)}" target="_blank" rel="noopener"><img src="${esc(link)}" alt="Cover art" data-art-check></a><span class="rv-fnote" data-art-info>Checking size…</span></div>`;
    else if (['preview', 'mp3', 'wav'].includes(kind)) check = `${playerHtml(link, label)}<p class="rv-fnote" data-inspect="${kind}">Reading format…</p>`;
    else check = `<button type="button" class="rv-peek" data-peek="${kind}">Show what's inside</button><div class="rv-zip" hidden></div>`;
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

  function card(s) {
    const prices = Object.entries(s.prices || {}).map(([t, c]) => `<span>${TIER_LABELS[t] || t}<b>€${(c / 100).toFixed(2)}</b></span>`).join('');
    const tags = [...(s.tags || []).map((t) => `#${t}`), ...(s.typeBeat || []).map((t) => `${t} type beat`)];
    const kinds = ORDER.filter((k) => (s.files || {})[k] || ['artwork', 'preview'].includes(k));
    return `
      <article class="up-card rv-card" data-id="${s.id}">
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
        <div class="rv-files-wrap">
          <h3>Files <span>${Object.keys(s.files || {}).length} uploaded</span></h3>
          <div class="rv-files">${kinds.map((k) => fileRow(s, k)).join('')}</div>
        </div>
        ${s.status === 'pending' ? `
          <div class="rv-decide">
            <label class="up-field up-field-wide"><span>Note to the producer <i>Required to send back, optional to approve</i></span>
              <textarea rows="2" maxlength="1000" placeholder="E.g. the WAV still has the voice tag at 0:12."></textarea>
            </label>
            <div class="rv-actions">
              <button type="button" class="btn btn-ghost rv-reject" data-decision="reject">Send back</button>
              <button type="button" class="btn btn-primary rv-approve" data-decision="approve">Approve</button>
            </div>
            <p class="up-error rv-card-error" role="alert" hidden></p>
          </div>`
        : `<p class="rv-result ${s.status === 'approved' ? 'is-ok' : 'is-bad'}">${s.status === 'approved' ? 'Approved' : 'Sent back'} ${esc(when(s.reviewedAt))}${s.reviewNote ? ` · “${esc(s.reviewNote)}”` : ''}</p>`}
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
    try {
      const res = await fetch('/api/review/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: Number(cardEl.dataset.id), decision: btn.dataset.decision, note }),
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
      cardEl.querySelectorAll('[data-decision]').forEach((b) => { b.disabled = false; });
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
  const inspect = (id, kind) => fetch(`/api/review/inspect?id=${id}&kind=${kind}`).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Could not read the file.');
    return data;
  });

  function runChecks() {
    // Cover: real pixel size, square and at least 1000 px.
    list.querySelectorAll('img[data-art-check]').forEach((img) => {
      const info = img.closest('.rv-art').querySelector('[data-art-info]');
      const check = () => {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const issues = [w !== h ? 'not square' : '', Math.min(w, h) < 1000 ? 'smaller than 1000 px' : ''].filter(Boolean);
        note(info, `${w} × ${h} px${issues.length ? `: ${issues.join(', ')}` : ', looks good'}`, issues.length > 0);
      };
      if (img.complete && img.naturalWidth) check(); else img.addEventListener('load', check, { once: true });
      img.addEventListener('error', () => note(info, 'Could not open the image.', true), { once: true });
    });
    // WAV: bit depth, sample rate, channels, length.
    // Audio: format against BeatStars' rules (problems come from the server).
    list.querySelectorAll('[data-inspect]').forEach((el) => {
      const id = el.closest('.rv-card').dataset.id;
      inspect(id, el.dataset.inspect).then((d) => {
        if (!d.ok) { note(el, d.error, true); return; }
        const quality = d.kind === 'wav' ? (d.float ? '32-bit float' : `${d.bits}-bit`) : `${d.kbps} kbps${d.vbr ? ' VBR' : ''}`;
        const issues = d.problems || [];
        note(el, `${quality} · ${(d.sampleRate / 1000).toFixed(1)} kHz · ${d.channels === 1 ? 'mono' : d.channels === 2 ? 'stereo' : `${d.channels} channels`}${d.duration ? ` · ${fmtDur(d.duration)}` : ''}${issues.length ? ` · ${issues.join(', ')}` : ' · OK for BeatStars rules'}`, issues.length > 0);
      }).catch((err) => note(el, err.message, true));
    });
  }

  // ZIP / RAR: list what's inside on demand.
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-peek]');
    if (!btn) return;
    const box = btn.nextElementSibling;
    if (!box.hidden) { box.hidden = true; btn.textContent = "Show what's inside"; return; }
    box.hidden = false;
    btn.textContent = 'Hide contents';
    if (box.dataset.loaded) return;
    box.innerHTML = '<p class="rv-fnote">Reading the archive…</p>';
    inspect(btn.closest('.rv-card').dataset.id, btn.dataset.peek).then((d) => {
      box.dataset.loaded = '1';
      if (d.kind === 'other') { box.innerHTML = `<p class="rv-fnote">${esc(d.note || 'This file type can only be checked after downloading.')}</p>`; return; }
      if (!d.ok) { box.innerHTML = `<p class="rv-fnote is-bad">${esc(d.error)}</p>`; return; }
      box.innerHTML = `
        <p class="rv-fnote ${d.audio ? 'is-ok' : 'is-bad'}">${d.files} file${d.files === 1 ? '' : 's'}, ${d.audio} audio${d.audio ? '' : ': no audio files found'}${d.truncated ? ' (showing the first ones)' : ''}</p>
        <ul class="rv-zip-list">${d.entries.map((x) => `<li><span>${esc(x.name.replace(/\\/g, '/'))}</span><small>${size(x.size)}</small></li>`).join('')}</ul>`;
    }).catch((err) => { box.innerHTML = `<p class="rv-fnote is-bad">${esc(err.message)}</p>`; });
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
