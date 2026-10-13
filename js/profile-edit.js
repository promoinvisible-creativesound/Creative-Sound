// "Your public profile" (profile-public.html): photo, name, @username,
// bio, Instagram / TikTok and genres. Producers pick the genres they
// produce, everyone else the genres they like.
(() => {
  'use strict';
  const form = document.getElementById('pe-form');
  if (!form) return;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const status = $('#pe-status');
  const say = (text, kind) => { status.textContent = text; status.className = `pe-status${kind ? ` is-${kind}` : ''}`; };
  let profile = null;

  const paintAvatar = () => {
    const box = $('#pe-avatar');
    const name = form.displayName.value || (profile && profile.handle) || '';
    const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
    box.innerHTML = profile && profile.photo ? `<img src="${esc(profile.photo)}" alt="">` : esc(initials);
  };
  const paintLink = () => {
    const h = form.handle.value.trim().toLowerCase().replace(/^@/, '');
    const a = $('#pe-view');
    $('#pe-url').textContent = h ? `creativesound.io/artist.html?u=${h}` : 'Pick a username to get your page';
    a.hidden = !(profile && profile.handle);
    if (profile && profile.handle) a.href = `artist.html?u=${encodeURIComponent(profile.handle)}`;
  };

  fetch('/api/profile/me')
    .then((r) => {
      if (r.status === 401) { window.location.href = 'login.html'; return null; }
      return r.ok ? r.json() : Promise.reject(new Error('Could not load your profile.'));
    })
    .then((data) => {
      if (!data) return;
      profile = data.profile;
      form.displayName.value = profile.displayName;
      form.handle.value = profile.handle;
      form.bio.value = profile.bio;
      form.instagram.value = profile.instagram ? `@${profile.instagram}` : '';
      form.tiktok.value = profile.tiktok ? `@${profile.tiktok}` : '';
      $('#pe-genres-label').textContent = profile.role === 'producer' ? 'Genres you produce' : 'Genres you like';
      $('#pe-genres').innerHTML = data.genres.map((g) => `
        <label class="pe-chip"><input type="checkbox" name="genres" value="${esc(g)}" ${profile.genres.includes(g) ? 'checked' : ''}><span>${esc(g)}</span></label>`).join('');
      paintAvatar();
      paintLink();
      $('#pe-bio-count').textContent = `${form.bio.value.length}/400`;
    })
    .catch((err) => say(err.message, 'bad'));

  form.addEventListener('input', (e) => {
    if (e.target.name === 'handle' || e.target.name === 'displayName') { paintLink(); paintAvatar(); }
    if (e.target.name === 'bio') $('#pe-bio-count').textContent = `${form.bio.value.length}/400`;
  });
  // Up to 6 genres
  form.addEventListener('change', (e) => {
    if (e.target.name !== 'genres') return;
    const on = [...form.querySelectorAll('input[name="genres"]:checked')];
    if (on.length > 6) { e.target.checked = false; say('Pick up to 6 genres.', 'bad'); }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#pe-save');
    btn.disabled = true;
    say('Saving…');
    try {
      const res = await fetch('/api/profile/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: form.displayName.value,
          handle: form.handle.value,
          bio: form.bio.value,
          instagram: form.instagram.value,
          tiktok: form.tiktok.value,
          genres: [...form.querySelectorAll('input[name="genres"]:checked')].map((i) => i.value),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      profile = data.profile;
      paintLink();
      say('Saved. Your public page is up to date.', 'ok');
    } catch (err) {
      say(err.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  // Photo: straight to Dropbox through a one-off link, then shown here.
  const input = $('#pe-photo-input');
  $('#pe-photo-btn').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file) return;
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) { say('Use a JPG, PNG or WebP image.', 'bad'); return; }
    if (file.size > 5 * 1024 * 1024) { say('The photo must be under 5 MB.', 'bad'); return; }
    say('Uploading photo…');
    try {
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, size: file.size }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not upload the photo.');
      const up = await fetch(data.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      if (!up.ok) throw new Error('The upload failed. Please try again.');
      // Show it straight away from the file itself.
      $('#pe-avatar').innerHTML = `<img src="${URL.createObjectURL(file)}" alt="">`;
      say('Photo updated.', 'ok');
    } catch (err) {
      say(err.message, 'bad');
    }
  });
})();
