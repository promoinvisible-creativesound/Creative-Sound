// Producer area: storefront settings (creativesound.io/@handle).
// Banner (cropped to 3:1 and resized in the browser before upload), colour,
// one-line headline and up to 3 pinned tracks.
(() => {
  'use strict';
  const box = document.getElementById('storefront');
  if (!box) return;
  const $ = (s) => box.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_PIN = 3;
  let state = null;
  let accent = null;
  let pinned = [];

  const status = (t, cls = '') => { const s = $('#sf-status'); s.textContent = t; s.className = `sf-set-status ${cls}`; };

  const paintBanner = () => {
    const prev = $('#sf-banner-prev');
    prev.style.backgroundImage = state.store.banner ? `url("${state.store.banner}")` : '';
    prev.classList.toggle('has-img', !!state.store.banner);
    $('#sf-banner-remove').hidden = !state.store.banner;
    $('#sf-banner-add').textContent = state.store.banner ? 'Replace banner' : 'Add banner';
  };
  const paintAccents = () => {
    $('#sf-accents').innerHTML = [`<button type="button" class="sf-sw is-default${!accent ? ' is-on' : ''}" data-accent="" aria-pressed="${!accent}" title="Creative Sound orange" style="--sw:#e8862c"></button>`]
      .concat(state.accents.filter((c) => c !== '#e8862c').map((c) => `<button type="button" class="sf-sw${accent === c ? ' is-on' : ''}" data-accent="${c}" aria-pressed="${accent === c}" title="${c}" style="--sw:${c}"></button>`)).join('');
    $('#sf-banner-prev').style.setProperty('--sw', accent || '#e8862c');
  };
  const paintPins = () => {
    $('#sf-pins-count').textContent = `${pinned.length} / ${MAX_PIN}`;
    $('#sf-pins').innerHTML = state.tracks.length ? state.tracks.map((t) => {
      const on = pinned.includes(t.id);
      return `<button type="button" class="sf-pinpick${on ? ' is-on' : ''}" data-pin="${esc(t.id)}" aria-pressed="${on}"${!on && pinned.length >= MAX_PIN ? ' disabled' : ''}>
        <span class="sf-pinpick-art"${t.cover ? ` style="background-image:url('${esc(t.cover)}')"` : ''}></span>
        <span class="sf-pinpick-text"><b>${esc(t.title)}</b><small>${esc(t.genre || '')}</small></span>
        ${on ? `<em>${pinned.indexOf(t.id) + 1}</em>` : ''}
      </button>`;
    }).join('') : '<p class="sf-set-none">Your approved tracks will show here.</p>';
  };
  const paint = () => {
    const link = state.handle ? `${location.origin}/@${state.handle}` : '';
    $('#sf-link').textContent = state.handle ? `creativesound.io/@${state.handle}` : 'Set a username in your public profile first';
    $('#sf-open').hidden = !state.handle;
    $('#sf-copy').hidden = !state.handle;
    $('#sf-open').href = link;
    $('#sf-headline').value = state.store.headline || '';
    paintBanner(); paintAccents(); paintPins();
  };

  const load = () => fetch('/api/profile/store').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d) return;
    state = d;
    accent = d.store.accent;
    pinned = d.store.pinned.filter((id) => d.tracks.some((t) => t.id === id));
    box.hidden = false;
    paint();
    if (location.hash === '#storefront') box.scrollIntoView({ block: 'start' });
  }).catch(() => {});

  box.addEventListener('click', (e) => {
    const sw = e.target.closest('[data-accent]');
    if (sw) { accent = sw.dataset.accent || null; paintAccents(); return; }
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      const id = pin.dataset.pin;
      pinned = pinned.includes(id) ? pinned.filter((x) => x !== id) : pinned.concat(id).slice(0, MAX_PIN);
      paintPins();
    }
  });
  $('#sf-copy').addEventListener('click', () => {
    const link = `${location.origin}/@${state.handle}`;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => {
      $('#sf-copy').textContent = 'Copied';
      setTimeout(() => { $('#sf-copy').textContent = 'Copy link'; }, 1600);
    }).catch(() => window.prompt('Copy your link', link));
  });
  $('#sf-save').addEventListener('click', async () => {
    const btn = $('#sf-save');
    btn.disabled = true;
    status('Saving…');
    try {
      const r = await fetch('/api/profile/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accent, headline: $('#sf-headline').value, pinned }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save.');
      state.store = d.store;
      status('Saved. Your storefront is up to date.', 'is-ok');
    } catch (err) {
      status(err.message, 'is-bad');
    } finally {
      btn.disabled = false;
    }
  });

  // Banner: centre-crop to 3:1, at most 2400 px wide, JPEG.
  const toBanner = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const W = img.naturalWidth; const H = img.naturalHeight;
      if (W < 900) { reject(new Error(`The image is ${W} px wide. Use at least 1200 px.`)); return; }
      let sw = W; let sh = Math.round(W / 3);
      if (sh > H) { sh = H; sw = H * 3; }
      const out = Math.min(2400, sw);
      const c = document.createElement('canvas');
      c.width = out; c.height = Math.round(out / 3);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the image.'))), 'image/jpeg', 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be opened. Use a JPG or PNG.')); };
    img.src = url;
  });
  $('#sf-banner-add').addEventListener('click', () => $('#sf-banner-file').click());
  $('#sf-banner-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const btn = $('#sf-banner-add');
    btn.disabled = true;
    status('Uploading the banner…');
    try {
      const blob = await toBanner(file);
      const r = await fetch('/api/profile/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ banner: { name: 'banner.jpg', size: blob.size } }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not upload the banner.');
      const up = await fetch(d.uploadUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
      if (!up.ok) throw new Error('Upload failed, please try again.');
      const fresh = await fetch('/api/profile/store').then((x) => x.json());
      state.store.banner = fresh.store.banner;
      paintBanner();
      status('Banner updated.', 'is-ok');
    } catch (err) {
      status(err.message, 'is-bad');
    } finally {
      btn.disabled = false;
    }
  });
  $('#sf-banner-remove').addEventListener('click', async () => {
    await fetch('/api/profile/store', { method: 'DELETE' }).catch(() => {});
    state.store.banner = null;
    paintBanner();
    status('Banner removed.', 'is-ok');
  });

  load();
})();
