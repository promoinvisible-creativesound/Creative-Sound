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

  function card(s) {
    const files = Object.entries(s.files || {}).map(([k, f]) => {
      const link = s.links && s.links[k];
      const label = `${FILE_LABELS[k] || k} <small>${esc(f.name)} · ${size(f.size || 0)}</small>`;
      return link ? `<a href="${esc(link)}" target="_blank" rel="noopener" class="rv-file">${label}</a>` : `<span class="rv-file is-off">${label}</span>`;
    }).join('');
    const prices = Object.entries(s.prices || {}).map(([t, c]) => `<span>${TIER_LABELS[t] || t}<b>€${(c / 100).toFixed(2)}</b></span>`).join('');
    const tags = [...(s.tags || []).map((t) => `#${t}`), ...(s.typeBeat || []).map((t) => `${t} type beat`)];
    return `
      <article class="up-card rv-card" data-id="${s.id}">
        <div class="rv-top">
          <div class="rv-cover">${s.links && s.links.artwork ? `<img src="${esc(s.links.artwork)}" alt="">` : '<span>No cover</span>'}</div>
          <div class="rv-info">
            <span class="rv-id">#${s.id} · ${esc(when(s.submittedAt))}</span>
            <h2>${esc(s.title)}</h2>
            <p class="rv-by">${esc(s.producerName)} · <a href="mailto:${esc(s.email)}">${esc(s.email)}</a></p>
            <div class="up-preview-chips rv-chips">${[`${s.bpm} BPM`, s.key, s.genre, s.mood].filter(Boolean).map((c) => `<span>${esc(c)}</span>`).join('')}</div>
            ${tags.length ? `<p class="rv-tags">${tags.map(esc).join(' · ')}</p>` : ''}
            ${s.links && s.links.preview ? `
            <div class="rv-player" data-src="${esc(s.links.preview)}">
              <button type="button" class="rv-play" aria-label="Play preview of ${esc(s.title)}">
                <svg class="rv-ic-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>
                <svg class="rv-ic-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>
              </button>
              <span class="rv-time" data-cur>0:00</span>
              <div class="rv-bar" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                <span class="rv-bar-fill"></span><span class="rv-bar-knob"></span>
              </div>
              <span class="rv-time" data-dur>–:––</span>
            </div>` : ''}
          </div>
        </div>
        ${s.about ? `<p class="rv-about">${esc(s.about)}</p>` : ''}
        <div class="rv-grid">
          <div><h3>Licenses</h3><div class="rv-prices">${prices}</div></div>
          <div><h3>Files</h3><div class="rv-files">${files}</div></div>
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

  async function load() {
    // The list is rebuilt, so stop whatever preview was playing.
    audio.pause();
    current = null;
    list.setAttribute('aria-busy', 'true');
    $('#rv-error').hidden = true;
    try {
      const res = await fetch(`/api/review/list?status=${status}`);
      if (res.status === 401) { window.location.href = 'login.html'; return; }
      if (res.status === 403) { $('#rv-body').hidden = true; $('#rv-gate').hidden = false; return; }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data && data.error) || 'Could not load the queue.');
      $('#rv-n').textContent = data.pendingCount ? String(data.pendingCount) : '';
      list.innerHTML = data.submissions.length ? data.submissions.map(card).join('')
        : `<p class="pa-none">${status === 'pending' ? 'Nothing to review. All caught up.' : 'Nothing here yet.'}</p>`;
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

  load();
})();
