// Support (profile-tickets.html): topic chips fill the subject so requests
// arrive labelled; the form itself is handled by js/auth.js.
(() => {
  'use strict';
  const form = document.getElementById('ticket-form');
  if (!form) return;
  const subject = document.getElementById('ticket-subject');
  const chips = [...form.querySelectorAll('.sp-topic')];
  form.querySelector('.sp-topics').addEventListener('click', (e) => {
    const chip = e.target.closest('.sp-topic');
    if (!chip) return;
    const on = !chip.classList.contains('is-on');
    chips.forEach((c) => { c.classList.toggle('is-on', c === chip && on); c.setAttribute('aria-pressed', String(c === chip && on)); });
    // Replace a previous "[Topic] " prefix, keep what the user typed after it.
    const rest = subject.value.replace(/^\[[^\]]+\]\s*/, '');
    subject.value = on ? `[${chip.dataset.topic}] ${rest}` : rest;
    subject.focus();
  });
  chips.forEach((c) => c.setAttribute('aria-pressed', 'false'));
  form.addEventListener('submit', () => setTimeout(() => {
    if (!subject.value) chips.forEach((c) => { c.classList.remove('is-on'); c.setAttribute('aria-pressed', 'false'); });
  }, 1500));
})();
