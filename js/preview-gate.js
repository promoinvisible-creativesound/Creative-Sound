// Private preview gate for the new pages (track store, home, account type,
// producer area, upload, review). The features are open to everyone, so
// pages show straight away. Only if the server is put back in private
// preview (PREVIEW_LOCK=1 on Vercel) does /api/auth/me answer
// preview:false, and then other accounts are sent to the home page.
(() => {
  const root = document.documentElement;
  root.classList.add('is-preview');
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : null))
    .then((me) => { if (me && me.preview === false) location.replace('/'); })
    .catch(() => {});
})();
