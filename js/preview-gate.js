// Private preview gate for the new pages (track store, home, account type,
// producer area, upload, review). Loaded in <head>: the page stays hidden
// until /api/auth/me says this account may see it (ADMIN_EMAILS on the
// server); anyone else goes to the home page. The APIs behind these pages
// check the same thing on the server, so this is only about what's shown.
// Local previews (localhost) always pass.
(() => {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const root = document.documentElement;
  if (local) { root.classList.add('is-preview'); return; }
  root.style.visibility = 'hidden';
  const leave = () => location.replace('/');
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => {
      if (me && me.preview) { root.classList.add('is-preview'); root.style.visibility = ''; } else leave();
    })
    .catch(leave);
})();
