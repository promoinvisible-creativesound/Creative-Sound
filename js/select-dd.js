// Custom dropdown for native <select> fields, same look and behaviour as the
// store filters (js/beats.js makeDropdown): trigger field + panel that grows
// from it, a highlight that glides between options, a drawn check on the
// selected one. The real <select> stays in the form (visually hidden) and
// keeps the value; a 'change' event on it repaints the trigger.
//   window.CSSelect.enhance(selectElement)
(() => {
  'use strict';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const openOnes = new Set();
  let uid = 0;
  document.addEventListener('pointerdown', (e) => { openOnes.forEach((f) => { if (!f.wrap.contains(e.target)) f.close(true); }); });

  function enhance(select) {
    if (select.dataset.dd) return;
    select.dataset.dd = '1';
    const id = `sd-${++uid}`;
    const wrap = document.createElement('div');
    wrap.className = 'sd';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sd-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', id);
    const label = select.closest('label') && select.closest('label').querySelector('span');
    if (label) btn.setAttribute('aria-label', label.textContent.trim());
    btn.innerHTML = '<span class="sd-value"></span><svg class="sd-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    const panel = document.createElement('div');
    panel.className = 'sd-panel';
    panel.id = id;
    panel.setAttribute('role', 'listbox');
    panel.tabIndex = -1;
    wrap.append(btn, panel);
    select.classList.add('sd-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.after(wrap);
    // A <label> wrapping the field would forward clicks to the native select.
    wrap.addEventListener('click', (e) => e.preventDefault());

    let opts = [];
    let active = -1;
    let typed = '';
    let typedTimer = 0;
    const build = () => {
      const items = [...select.options].filter((o) => o.value !== '');
      panel.innerHTML = '<span class="sd-glide" aria-hidden="true"></span>' + items.map((o, i) => `
        <div class="sd-opt" role="option" id="${id}-${i}" data-value="${esc(o.value)}" aria-selected="false" style="--k:${Math.min(i, 14)}">
          <svg class="sd-check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 8.4l3 3 6.6-7"/></svg>
          <span>${esc(o.textContent)}</span>
        </div>`).join('');
      opts = [...panel.querySelectorAll('.sd-opt')];
    };
    const paint = () => {
      const o = select.selectedOptions[0];
      const set = !!(o && o.value);
      btn.querySelector('.sd-value').textContent = o ? o.textContent : '';
      wrap.classList.toggle('is-empty', !set);
      opts.forEach((el) => el.setAttribute('aria-selected', String(el.dataset.value === select.value)));
    };
    const glide = () => panel.querySelector('.sd-glide');
    const setActive = (i, instant) => {
      if (!opts.length) return;
      active = Math.max(0, Math.min(opts.length - 1, i));
      opts.forEach((el, k) => el.classList.toggle('is-active', k === active));
      panel.setAttribute('aria-activedescendant', opts[active].id);
      const el = opts[active];
      const g = glide();
      if (instant) g.style.transition = 'none';
      g.style.opacity = '1';
      g.style.transform = `translateY(${el.offsetTop}px)`;
      g.style.height = `${el.offsetHeight}px`;
      if (instant) { void g.offsetWidth; g.style.transition = ''; }
      const top = el.offsetTop; const bottom = top + el.offsetHeight;
      if (top < panel.scrollTop) panel.scrollTop = top - 6;
      else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight + 6;
    };
    const api = { wrap, close: null };
    const open = () => {
      if (!opts.length || opts.length !== [...select.options].filter((o) => o.value !== '').length) build();
      paint();
      openOnes.forEach((f) => f.close(true));
      wrap.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      const sel = opts.findIndex((el) => el.dataset.value === select.value);
      panel.scrollTop = 0;
      setActive(sel < 0 ? 0 : sel, true);
      panel.focus({ preventScroll: true });
      openOnes.add(api);
    };
    const close = (silent) => {
      if (!wrap.classList.contains('is-open')) return;
      wrap.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      openOnes.delete(api);
      if (!silent) btn.focus({ preventScroll: true });
    };
    api.close = close;
    const choose = (i) => {
      const v = opts[i] && opts[i].dataset.value;
      if (v != null && v !== select.value) {
        select.value = v;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      paint();
      close();
    };
    btn.addEventListener('click', () => (wrap.classList.contains('is-open') ? close() : open()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
    panel.addEventListener('pointermove', (e) => { const el = e.target.closest('.sd-opt'); if (el) { const i = opts.indexOf(el); if (i !== active) setActive(i); } });
    panel.addEventListener('click', (e) => { const el = e.target.closest('.sd-opt'); if (el) choose(opts.indexOf(el)); });
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
      else if (e.key === 'End') { e.preventDefault(); setActive(opts.length - 1); }
      else if (e.key === 'Enter' || (e.key === ' ' && !typed)) { e.preventDefault(); choose(active); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') close(true);
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Type to jump to the first option that starts with what you typed ("deep h" -> Deep House).
        e.preventDefault();
        typed += e.key.toLowerCase();
        clearTimeout(typedTimer);
        typedTimer = setTimeout(() => { typed = ''; }, 900);
        let i = opts.findIndex((el) => el.textContent.trim().toLowerCase().startsWith(typed));
        if (i < 0 && typed.length > 1) { typed = e.key.toLowerCase(); i = opts.findIndex((el) => el.textContent.trim().toLowerCase().startsWith(typed)); }
        if (i >= 0) setActive(i);
      }
    });
    select.addEventListener('change', paint);
    build();
    paint();
    return api;
  }
  window.CSSelect = { enhance };
})();
