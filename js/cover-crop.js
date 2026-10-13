// Cover art cropper for the upload page. prepare(file) resolves to
// { file } (ready to upload), { error } or null (cancelled).
// Square images within limits pass straight through; anything else opens a
// crop window: drag to move, slider or wheel to zoom, export a square JPEG
// between 1000 and 3000 px.
(() => {
  'use strict';
  const MIN = 1000;
  const MAX = 3000;
  const MAX_BYTES = 10 * 1024 * 1024;

  const loadImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image could not be opened. Use a JPG or PNG.')); };
    img.src = url;
  });

  let dialog = null;
  function build() {
    dialog = document.createElement('dialog');
    dialog.className = 'cc-modal';
    dialog.setAttribute('aria-labelledby', 'cc-title');
    dialog.innerHTML = `
      <div class="cc-head">
        <h2 id="cc-title">Crop your cover</h2>
        <p>Drag to move, zoom to frame it. Covers are square.</p>
      </div>
      <div class="cc-stage" tabindex="0" aria-label="Crop area. Use arrow keys to move, plus and minus to zoom.">
        <img alt="" draggable="false">
        <span class="cc-grid" aria-hidden="true"></span>
      </div>
      <label class="cc-zoom">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8.5 11h5"/></svg>
        <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5M8.5 11h5M11 8.5v5"/></svg>
      </label>
      <p class="cc-note" role="status" aria-live="polite"></p>
      <div class="cc-actions">
        <button type="button" class="btn btn-ghost" data-cc="cancel">Cancel</button>
        <button type="button" class="btn btn-primary" data-cc="ok">Use cover</button>
      </div>`;
    document.body.appendChild(dialog);
  }

  function crop(img) {
    if (!dialog) build();
    const stage = dialog.querySelector('.cc-stage');
    const view = stage.querySelector('img');
    const zoom = dialog.querySelector('.cc-zoom input');
    const note = dialog.querySelector('.cc-note');
    const ok = dialog.querySelector('[data-cc="ok"]');
    view.src = img.src;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    let S = 0; let base = 1; let z = 1; let x = 0; let y = 0;

    const clamp = () => {
      const sc = base * z;
      x = Math.min(0, Math.max(S - W * sc, x));
      y = Math.min(0, Math.max(S - H * sc, y));
    };
    const paint = () => {
      const sc = base * z;
      view.style.width = `${W * sc}px`;
      view.style.height = `${H * sc}px`;
      view.style.transform = `translate(${x}px, ${y}px)`;
      const side = Math.round(S / sc);
      const out = Math.min(MAX, side);
      ok.disabled = side < MIN;
      note.textContent = side < MIN ? `Zoomed in too far: the cover would be ${side} px. Zoom out a little (min ${MIN} px).` : `Cover: ${out} × ${out} px`;
      note.classList.toggle('is-bad', side < MIN);
    };
    const setZoom = (nz, cx = S / 2, cy = S / 2) => {
      const old = base * z;
      z = Math.min(4, Math.max(1, nz));
      const sc = base * z;
      // Keep the point under the cursor (or the centre) in place.
      x = cx - ((cx - x) / old) * sc;
      y = cy - ((cy - y) / old) * sc;
      clamp(); paint();
      zoom.value = String(z);
    };
    const layout = () => {
      S = stage.clientWidth;
      base = S / Math.min(W, H);
      x = (S - W * base * z) / 2;
      y = (S - H * base * z) / 2;
      clamp(); paint();
    };

    let drag = null;
    const onDown = (e) => { drag = { px: e.clientX, py: e.clientY, x, y }; stage.setPointerCapture(e.pointerId); stage.classList.add('is-drag'); };
    const onMove = (e) => { if (!drag) return; x = drag.x + e.clientX - drag.px; y = drag.y + e.clientY - drag.py; clamp(); paint(); };
    const onUp = () => { drag = null; stage.classList.remove('is-drag'); };
    const onWheel = (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); setZoom(z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top); };
    const onKey = (e) => {
      const step = 12;
      if (e.key === 'ArrowLeft') x += step; else if (e.key === 'ArrowRight') x -= step;
      else if (e.key === 'ArrowUp') y += step; else if (e.key === 'ArrowDown') y -= step;
      else if (e.key === '+' || e.key === '=') { setZoom(z * 1.1); return; } else if (e.key === '-') { setZoom(z / 1.1); return; } else return;
      e.preventDefault(); clamp(); paint();
    };
    const onZoom = () => setZoom(Number(zoom.value));

    return new Promise((resolve) => {
      const cleanup = (result) => {
        stage.removeEventListener('pointerdown', onDown);
        stage.removeEventListener('pointermove', onMove);
        stage.removeEventListener('pointerup', onUp);
        stage.removeEventListener('pointercancel', onUp);
        stage.removeEventListener('wheel', onWheel);
        stage.removeEventListener('keydown', onKey);
        zoom.removeEventListener('input', onZoom);
        window.removeEventListener('resize', layout);
        dialog.onclick = null;
        dialog.oncancel = null;
        if (dialog.open) dialog.close();
        resolve(result);
      };
      stage.addEventListener('pointerdown', onDown);
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerup', onUp);
      stage.addEventListener('pointercancel', onUp);
      stage.addEventListener('wheel', onWheel, { passive: false });
      stage.addEventListener('keydown', onKey);
      zoom.addEventListener('input', onZoom);
      window.addEventListener('resize', layout);
      dialog.oncancel = (e) => { e.preventDefault(); cleanup(null); };
      dialog.onclick = (e) => {
        const b = e.target.closest('[data-cc]');
        if (!b) return;
        if (b.dataset.cc === 'cancel') { cleanup(null); return; }
        const sc = base * z;
        const side = S / sc;
        const out = Math.min(MAX, Math.round(side));
        const canvas = document.createElement('canvas');
        canvas.width = out;
        canvas.height = out;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, -x / sc, -y / sc, side, side, 0, 0, out, out);
        canvas.toBlob((blob) => cleanup(blob ? { blob, size: out } : null), 'image/jpeg', 0.92);
      };
      z = 1; zoom.value = '1';
      dialog.showModal();
      requestAnimationFrame(() => { layout(); stage.focus({ preventScroll: true }); });
    });
  }

  async function prepare(file) {
    let loaded;
    try { loaded = await loadImage(file); } catch (err) { return { error: err.message }; }
    const { img, url } = loaded;
    try {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (Math.min(w, h) < MIN) return { error: `The image is ${w} × ${h}. Covers need at least ${MIN} × ${MIN} px.` };
      // Already square and within limits: upload as it is.
      if (w === h && w <= MAX && file.size <= MAX_BYTES) return { file };
      const res = await crop(img);
      if (!res) return null;
      const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
      return { file: new File([res.blob], name, { type: 'image/jpeg' }) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.CSCoverCrop = { prepare };
})();
