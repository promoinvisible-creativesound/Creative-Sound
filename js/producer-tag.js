// Upload page: the producer's own audio tag (saved on the profile, used on
// all their tracks). Checks length (max 8 s) in the browser, uploads straight
// to Dropbox through a one-off link from /api/profile/producer-tag.
(() => {
  'use strict';
  const box = document.getElementById('up-ptag');
  if (!box) return;
  const $ = (id) => document.getElementById(id);
  const title = $('up-ptag-title');
  const sub = $('up-ptag-sub');
  const addBtn = $('up-ptag-add');
  const removeBtn = $('up-ptag-remove');
  const playBtn = $('up-ptag-play');
  const input = $('up-ptag-file');
  const HINT = 'MP3 or WAV, up to 8 seconds. Example: "Invisible on the beat".';
  const MAX_S = 8;
  const MAX_BYTES = 3 * 1024 * 1024;
  let audio = null;
  const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>';

  const paint = (url, name) => {
    box.classList.toggle('has-tag', !!url);
    title.textContent = url ? 'Your producer tag' : 'No tag yet';
    sub.textContent = url ? `${name || 'tag'} · plays between the Creative Sound tags` : HINT;
    addBtn.textContent = url ? 'Replace' : 'Add tag';
    removeBtn.hidden = !url;
    playBtn.hidden = !url;
    if (audio) { audio.pause(); audio = null; }
    if (url) {
      audio = new Audio(url);
      audio.addEventListener('ended', () => { playBtn.innerHTML = PLAY; });
    }
    playBtn.innerHTML = PLAY;
  };
  const load = () => fetch('/api/profile/producer-tag').then((r) => (r.ok ? r.json() : null)).then((d) => paint(d && d.url, d && d.name)).catch(() => {});

  const duration = (file) => new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(a.duration); };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    a.src = url;
  });

  addBtn.addEventListener('click', () => input.click());
  playBtn.addEventListener('click', () => {
    if (!audio) return;
    if (audio.paused) { audio.currentTime = 0; audio.play().catch(() => {}); playBtn.innerHTML = PAUSE; } else { audio.pause(); playBtn.innerHTML = PLAY; }
  });
  removeBtn.addEventListener('click', async () => {
    removeBtn.disabled = true;
    await fetch('/api/profile/producer-tag', { method: 'DELETE' }).catch(() => {});
    removeBtn.disabled = false;
    paint(null);
  });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const say = (t, bad) => { sub.textContent = t; box.classList.toggle('is-bad', !!bad); };
    if (!/\.(mp3|wav)$/i.test(file.name)) { say('Use an MP3 or WAV file.', true); return; }
    if (file.size > MAX_BYTES) { say('The tag must be under 3 MB.', true); return; }
    const d = await duration(file);
    if (d != null && d > MAX_S + 0.05) { say(`Your tag is ${d.toFixed(1)} s. Keep it under ${MAX_S} seconds.`, true); return; }
    say('Uploading…');
    addBtn.disabled = true;
    try {
      const r = await fetch('/api/profile/producer-tag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: file.name, size: file.size }) });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(out.error || 'Could not upload your tag.');
      const up = await fetch(out.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      if (!up.ok) throw new Error('Upload failed, please try again.');
      box.classList.remove('is-bad');
      await load();
    } catch (err) {
      say(err.message, true);
    } finally {
      addBtn.disabled = false;
    }
  });
  load();
})();
