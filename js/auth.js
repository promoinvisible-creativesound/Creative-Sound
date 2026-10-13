(() => {
  'use strict';

  function showError(el, message) {
    el.textContent = message;
    el.classList.add('visible');
  }
  function hideError(el) {
    el.classList.remove('visible');
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // Where to send someone once they're signed in. Only ever a Stripe
  // checkout URL (set by the Buy-link gate in main.js when it sends someone
  // here to create an account first) or the default profile page — never an
  // arbitrary redirect target, so a crafted ?next= can't be used to phish.
  function getNextUrl() {
    const next = new URLSearchParams(location.search).get('next');
    if (next && /^https:\/\/buy\.stripe\.com\//.test(next)) return next;
    return 'profile.html';
  }
  // New accounts pick producer / artist / listener first; any pending
  // checkout (?next=) rides along and is honoured once they've chosen.
  function welcomeUrl() {
    return `welcome.html${location.search}`;
  }
  // Private preview: only allowed accounts see the account-type step.
  function goAfterSignup() {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((me) => { window.location.href = me && me.preview && !me.role ? welcomeUrl() : getNextUrl(); });
  }

  // Carry a pending checkout across to the other form if someone lands on
  // signup but already has an account (or vice versa), so switching between
  // "Sign in" / "Create one" doesn't drop them back into guest checkout.
  const rawNext = new URLSearchParams(location.search).get('next');
  if (rawNext) {
    const switchLink = document.querySelector('.auth-alt-btn, .auth-switch a');
    if (switchLink) {
      const url = new URL(switchLink.href, location.href);
      url.searchParams.set('next', rawNext);
      switchLink.href = url.toString();
    }
  }

  /* --------------------------- Show / hide password -------------------------- */
  // Every password field in an account form gets an eye button.
  document.querySelectorAll('.auth-field input[type="password"], .st-pass input[type="password"]').forEach((input) => {
    const wrap = document.createElement('div');
    wrap.className = 'auth-pass';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'auth-eye';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Show password');
    btn.innerHTML = '<svg class="eye-on" viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>'
      + '<svg class="eye-off" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 6a9.7 9.7 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-3 3.7M6.6 6.7C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus({ preventScroll: true });
    });
    wrap.appendChild(btn);
  });

  /* --------------------------------- Signup form --------------------------- */
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    const errorEl = document.getElementById('auth-error');
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);

      const email = document.getElementById('signup-email').value.trim();
      const password = document.getElementById('signup-password').value;
      const confirm = document.getElementById('signup-confirm').value;

      if (password !== confirm) {
        showError(errorEl, "Passwords don't match.");
        return;
      }

      const btn = signupForm.querySelector('button[type="submit"]');
      const originalLabel = btn.textContent;
      btn.textContent = 'Creating account…';
      btn.disabled = true;

      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');

        const signupStep = document.getElementById('signup-step');
        const verifyStep = document.getElementById('verify-step');
        if (data.needsVerification && verifyStep) {
          document.getElementById('verify-email-display').textContent = data.email;
          signupStep.style.display = 'none';
          verifyStep.style.display = 'block';
          document.getElementById('verify-code').focus();
        } else {
          goAfterSignup();
        }
      } catch (err) {
        showError(errorEl, err.message);
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });
  }

  /* ------------------------------- Verify email form ------------------------- */
  const verifyForm = document.getElementById('verify-form');
  if (verifyForm) {
    const errorEl = document.getElementById('verify-error');
    const successEl = document.getElementById('verify-success');
    const resendBtn = document.getElementById('resend-code-btn');

    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);
      successEl.classList.remove('visible');

      const code = document.getElementById('verify-code').value.trim();
      const btn = verifyForm.querySelector('button[type="submit"]');
      const originalLabel = btn.textContent;
      btn.textContent = 'Confirming…';
      btn.disabled = true;

      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        goAfterSignup();
      } catch (err) {
        showError(errorEl, err.message);
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });

    if (resendBtn) {
      resendBtn.addEventListener('click', async () => {
        hideError(errorEl);
        successEl.classList.remove('visible');
        resendBtn.disabled = true;
        const originalLabel = resendBtn.textContent;
        resendBtn.textContent = 'Sending…';

        try {
          const res = await fetch('/api/auth/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ resend: true }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Something went wrong.');
          successEl.textContent = 'New code sent — check your inbox.';
          successEl.classList.add('visible');
        } catch (err) {
          showError(errorEl, err.message);
        } finally {
          resendBtn.textContent = originalLabel;
          setTimeout(() => { resendBtn.disabled = false; }, 20000);
        }
      });
    }
  }

  /* ---------------------------------- Login form ---------------------------- */
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    const errorEl = document.getElementById('auth-error');
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);

      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      const btn = loginForm.querySelector('button[type="submit"]');
      const originalLabel = btn.textContent;
      btn.textContent = 'Signing in…';
      btn.disabled = true;

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        // Accounts from before account types existed choose one first.
        window.location.href = data.preview && !data.role ? welcomeUrl() : getNextUrl();
      } catch (err) {
        showError(errorEl, err.message);
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });
  }

  /* ------------------------------ Forgot password form ----------------------- */
  const forgotForm = document.getElementById('forgot-form');
  if (forgotForm) {
    const errorEl = document.getElementById('auth-error');
    const successEl = document.getElementById('auth-success');
    forgotForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);
      successEl.classList.remove('visible');

      const email = document.getElementById('forgot-email').value.trim();
      const btn = forgotForm.querySelector('button[type="submit"]');
      const originalLabel = btn.textContent;
      btn.textContent = 'Sending…';
      btn.disabled = true;

      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        successEl.textContent = "If there's an account with that email, a reset link is on its way.";
        successEl.classList.add('visible');
        forgotForm.reset();
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });
  }

  /* ------------------------------- Reset password form ------------------------ */
  const resetForm = document.getElementById('reset-form');
  if (resetForm) {
    const errorEl = document.getElementById('auth-error');
    const token = new URLSearchParams(location.search).get('token');
    if (!token) {
      showError(errorEl, 'This reset link is missing its token — request a new one from the forgot password page.');
      resetForm.querySelector('button[type="submit"]').disabled = true;
    }

    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);

      const password = document.getElementById('reset-password').value;
      const confirm = document.getElementById('reset-confirm').value;
      if (password !== confirm) {
        showError(errorEl, "Passwords don't match.");
        return;
      }

      const btn = resetForm.querySelector('button[type="submit"]');
      const originalLabel = btn.textContent;
      btn.textContent = 'Saving…';
      btn.disabled = true;

      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        window.location.href = 'profile.html';
      } catch (err) {
        showError(errorEl, err.message);
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });
  }

  /* ----------------------------------- Profile ------------------------------- */
  function formatAmount(cents, currency) {
    if (!cents) return '—';
    const symbol = (currency || 'eur').toLowerCase() === 'eur' ? '€' : `${(currency || '').toUpperCase()} `;
    return `${symbol}${(cents / 100).toFixed(2)}`;
  }

  function renderLicenses(data) {
    const list = document.getElementById('profile-licenses');
    if (!list) return;
    if (!data.licenses.length) {
      list.innerHTML = '<p class="profile-empty">No Creative Dist license on this account yet — buy it from the <a href="creative-dist-2">product page</a>, using this same email.</p>';
      return;
    }
    list.innerHTML = data.licenses.map((lic) => `
      <div class="profile-license">
        <div class="profile-license-key">${lic.license_key}</div>
        <div class="profile-license-date">Issued ${new Date(lic.created_at).toLocaleDateString()}</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
          <a href="assets/downloads/Creative-Dist-Mac.zip" download class="btn btn-primary">Download for macOS</a>
          <a href="assets/downloads/Creative-Dist-Windows.zip" download class="btn btn-primary">Download for Windows</a>
        </div>
      </div>
    `).join('');
  }

  function renderPacks(data) {
    const list = document.getElementById('profile-packs');
    if (!list) return;
    const packs = data.packs || [];
    // One card per pack, however many times it was checked out.
    const seen = new Set();
    const unique = packs.filter((p) => (seen.has(p.pack_id) ? false : seen.add(p.pack_id)));
    if (!unique.length) {
      list.innerHTML = '<p class="profile-empty">No packs on this account yet — grab one from the <a href="packs.html">packs page</a>, using this same email.</p>';
      return;
    }
    list.innerHTML = unique.map((p) => `
      <div class="profile-license">
        <div class="profile-pack-name">${escapeHtml(p.name)}</div>
        <div class="profile-license-date">Added ${new Date(p.created_at).toLocaleDateString()}</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
          ${p.download_url
            ? `<a href="${escapeHtml(p.download_url)}" class="btn btn-primary">Download</a>`
            : '<span class="profile-empty" style="padding:0;">The download is being set up. Contact support if it does not appear soon.</span>'}
        </div>
      </div>
    `).join('');
  }

  function renderBeats(data) {
    const list = document.getElementById('profile-beats');
    if (!list) return;
    const beats = data.beats || [];
    if (!beats.length) {
      list.innerHTML = '<p class="profile-empty">No beats on this account yet — browse the <a href="beats.html">beat store</a>.</p>';
      return;
    }
    list.innerHTML = beats.map((b) => `
      <div class="profile-license">
        <div class="profile-pack-name">${escapeHtml(b.title)} <span style="color:var(--text-muted); font-weight:400;">· ${escapeHtml(b.tier_name)}</span></div>
        <div class="profile-license-date">prod. ${escapeHtml(b.producer)} · License ${escapeHtml(b.license_id)} · ${new Date(b.created_at).toLocaleDateString()}</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
          ${b.files.length
            ? b.files.map((f) => `<a href="${escapeHtml(f.url)}" class="btn ${f.type === 'wav' ? 'btn-primary' : 'btn-ghost'}">${escapeHtml(f.label)}</a>`).join('')
            : '<span class="profile-empty" style="padding:0;">Your files are being prepared. Contact support if they do not appear soon.</span>'}
        </div>
      </div>
    `).join('');
  }

  function renderOrders(data) {
    const orders = document.getElementById('profile-orders');
    if (!orders) return;
    const rows = data.orders.map((o) => ({ created_at: o.created_at, name: 'Creative Dist', amount: formatAmount(o.amount_total, o.currency) }))
      .concat((data.packs || []).map((p) => ({ created_at: p.created_at, name: p.name, amount: p.amount_total ? formatAmount(p.amount_total, p.currency) : 'Free' })))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (!rows.length) {
      orders.innerHTML = '<p class="profile-empty">No orders yet.</p>';
      return;
    }
    orders.innerHTML = rows.map((o) => `
      <div class="order-row">
        <span class="order-row-date">${new Date(o.created_at).toLocaleDateString()}</span>
        <span class="order-row-name">${escapeHtml(o.name)}</span>
        <span class="order-row-amount">${o.amount}</span>
      </div>
    `).join('');
  }

  function renderTickets(tickets) {
    const list = document.getElementById('ticket-list');
    if (!list) return;
    if (!tickets.length) {
      list.innerHTML = '<p class="profile-empty">No support tickets yet.</p>';
      return;
    }
    list.innerHTML = tickets.map((t) => `
      <div class="ticket-row">
        <div class="ticket-row-top">
          <span class="ticket-row-subject">${escapeHtml(t.subject)}</span>
          <span class="ticket-status ticket-status-${escapeHtml(t.status)}">${escapeHtml(t.status)}</span>
        </div>
        <p class="ticket-row-message">${escapeHtml(t.message)}</p>
        <span class="ticket-row-date">${new Date(t.created_at).toLocaleDateString()}</span>
      </div>
    `).join('');
  }

  /* Account hub (profile.html) — card counts */
  const accountHub = document.getElementById('account-hub');
  if (accountHub) {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) {
          window.location.href = 'login.html';
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        const packCount = new Set((data.packs || []).map((p) => p.pack_id)).size;
        const licenseParts = [];
        if (data.licenses.length) licenseParts.push(`${data.licenses.length} license${data.licenses.length > 1 ? 's' : ''}`);
        if (packCount) licenseParts.push(`${packCount} pack${packCount > 1 ? 's' : ''}`);
        const beatCount = (data.beats || []).length;
        if (beatCount) licenseParts.push(`${beatCount} track${beatCount > 1 ? 's' : ''}`);
        const savedEl = document.getElementById('hub-saved-sub');
        if (savedEl) {
          const n = (data.savedBeats || []).length;
          savedEl.textContent = n ? `${n} saved track${n > 1 ? 's' : ''}` : 'Nothing saved yet';
        }
        // Producers get their area first; accounts without a type are asked once.
        const producerCard = document.getElementById('hub-producer');
        if (producerCard) producerCard.hidden = !(data.preview && data.role === 'producer');
        const reviewCard = document.getElementById('hub-review');
        if (reviewCard) reviewCard.hidden = !data.isAdmin;
        const roleCard = document.getElementById('hub-role');
        if (roleCard) roleCard.hidden = !data.preview || !!data.role;
        document.getElementById('hub-license-sub').textContent = licenseParts.length ? licenseParts.join(' · ') : 'No license yet';
        const orderCount = data.orders.length + (data.packs || []).length;
        document.getElementById('hub-orders-sub').textContent = orderCount
          ? `${orderCount} order${orderCount > 1 ? 's' : ''}`
          : 'No orders yet';
      } catch (err) {
        // Cards still work as plain navigation even if the counts fail to load.
      }
    })();

    (async () => {
      try {
        const res = await fetch('/api/tickets');
        const data = await res.json();
        if (!res.ok) return;
        const openCount = data.tickets.filter((t) => t.status === 'open').length;
        document.getElementById('hub-tickets-sub').textContent = data.tickets.length
          ? `${openCount} open · ${data.tickets.length} total`
          : 'No tickets yet';
      } catch (err) {
        // Non-critical.
      }
    })();
  }

  /* License & Download page */
  const licenseRoot = document.getElementById('license-root');
  if (licenseRoot) {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) {
          window.location.href = 'login.html';
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        document.getElementById('profile-email').textContent = data.email;
        renderLicenses(data);
        renderPacks(data);
        renderBeats(data);
      } catch (err) {
        licenseRoot.innerHTML = `<p class="auth-error visible">${err.message}</p>`;
      }
    })();
  }

  /* Order history page */
  const ordersRoot = document.getElementById('orders-root');
  if (ordersRoot) {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) {
          window.location.href = 'login.html';
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        renderOrders(data);
      } catch (err) {
        ordersRoot.innerHTML = `<p class="auth-error visible">${err.message}</p>`;
      }
    })();
  }

  /* Support / tickets page */
  const ticketsRoot = document.getElementById('tickets-root');
  if (ticketsRoot) {
    (async () => {
      try {
        const res = await fetch('/api/tickets');
        if (res.status === 401) {
          window.location.href = 'login.html';
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        renderTickets(data.tickets);
      } catch (err) {
        // The ticket-list stays empty — the form below still works.
      }
    })();
  }

  /* Settings page */
  const settingsRoot = document.getElementById('settings-root');
  if (settingsRoot) {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) {
          window.location.href = 'login.html';
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        document.getElementById('profile-first-name').value = data.firstName || '';
        document.getElementById('profile-last-name').value = data.lastName || '';
      } catch (err) {
        settingsRoot.innerHTML = `<p class="auth-error visible">${err.message}</p>`;
      }
    })();
  }

  const ticketForm = document.getElementById('ticket-form');
    if (ticketForm) {
      const errorEl = document.getElementById('ticket-error');
      const successEl = document.getElementById('ticket-success');
      ticketForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(errorEl);
        successEl.classList.remove('visible');

        const subject = document.getElementById('ticket-subject').value.trim();
        const message = document.getElementById('ticket-message').value.trim();
        const btn = ticketForm.querySelector('button[type="submit"]');
        const originalLabel = btn.textContent;
        btn.textContent = 'Sending…';
        btn.disabled = true;

        try {
          const res = await fetch('/api/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subject, message }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Something went wrong.');
          successEl.textContent = "Ticket sent — we'll reply by email.";
          successEl.classList.add('visible');
          ticketForm.reset();
          const listRes = await fetch('/api/tickets');
          const listData = await listRes.json();
          if (listRes.ok) renderTickets(listData.tickets);
        } catch (err) {
          showError(errorEl, err.message);
        } finally {
          btn.textContent = originalLabel;
          btn.disabled = false;
        }
      });
    }

    const profileForm = document.getElementById('profile-form');
    if (profileForm) {
      const errorEl = document.getElementById('profile-error');
      const successEl = document.getElementById('profile-success');
      profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(errorEl);
        successEl.classList.remove('visible');

        const firstName = document.getElementById('profile-first-name').value.trim();
        const lastName = document.getElementById('profile-last-name').value.trim();
        const btn = profileForm.querySelector('button[type="submit"]');
        const originalLabel = btn.textContent;
        btn.textContent = 'Saving…';
        btn.disabled = true;

        try {
          const res = await fetch('/api/auth/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Something went wrong.');
          successEl.textContent = 'Saved.';
          successEl.classList.add('visible');
        } catch (err) {
          showError(errorEl, err.message);
        } finally {
          btn.textContent = originalLabel;
          btn.disabled = false;
        }
      });
    }

    const passwordForm = document.getElementById('password-form');
    if (passwordForm) {
      const errorEl = document.getElementById('password-error');
      const successEl = document.getElementById('password-success');
      passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError(errorEl);
        successEl.classList.remove('visible');

        const currentPassword = document.getElementById('password-current').value;
        const newPassword = document.getElementById('password-new').value;
        const btn = passwordForm.querySelector('button[type="submit"]');
        const originalLabel = btn.textContent;
        btn.textContent = 'Saving…';
        btn.disabled = true;

        try {
          const res = await fetch('/api/auth/update-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Something went wrong.');
          successEl.textContent = 'Password changed.';
          successEl.classList.add('visible');
          passwordForm.reset();
        } catch (err) {
          showError(errorEl, err.message);
        } finally {
          btn.textContent = originalLabel;
          btn.disabled = false;
        }
      });
    }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/';
    });
  }

  /* -------------------------------- Apply form -------------------------------- */
  const applyForm = document.getElementById('apply-form');
  if (applyForm) {
    const errorEl = document.getElementById('apply-error');
    const successEl = document.getElementById('apply-success');
    const cvInput = document.getElementById('apply-cv');
    const MAX_CV_BYTES = 5 * 1024 * 1024;

    applyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError(errorEl);
      successEl.classList.remove('visible');

      if (cvInput.files[0] && cvInput.files[0].size > MAX_CV_BYTES) {
        showError(errorEl, 'Your CV is over 5MB — try a smaller file.');
        return;
      }

      const btn = applyForm.querySelector('button[type="submit"]');
      const originalLabel = btn.textContent;
      btn.textContent = 'Sending…';
      btn.disabled = true;

      try {
        const res = await fetch('/api/apply', {
          method: 'POST',
          body: new FormData(applyForm),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        successEl.textContent = "Thanks — your note is in. We'll reach out if it's a fit.";
        successEl.classList.add('visible');
        applyForm.reset();
      } catch (err) {
        showError(errorEl, err.message);
      } finally {
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });
  }

  /* ------------------------- Account type in Settings ----------------------- */
  // Saves as soon as another option is picked; goes back on failure.
  const roleSettings = document.getElementById('role-settings');
  if (roleSettings) {
    const status = document.getElementById('role-settings-status');
    const LABELS = { producer: 'Producer', artist: 'Artist', listener: 'Just exploring' };
    let saved = null;
    const select = (role) => {
      const input = roleSettings.querySelector(`input[value="${role}"]`);
      if (input) input.checked = true;
    };
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data && data.role) { saved = data.role; select(saved); } })
      .catch(() => {});
    roleSettings.addEventListener('change', async (e) => {
      const role = e.target.value;
      status.textContent = '';
      try {
        const res = await fetch('/api/account/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not save, please try again.');
        saved = role;
        status.textContent = '';
      } catch (err) {
        status.textContent = err.message;
        if (saved) select(saved); else e.target.checked = false;
      }
    });
  }

  /* ------------------------------ Account type ------------------------------ */
  // welcome.html: producer / artist / listener. Signed-out visitors go to
  // sign in; an existing choice is preselected so this page also works for
  // changing it.
  const roleForm = document.getElementById('role-form');
  if (roleForm) {
    const errorEl = document.getElementById('role-error');
    const submit = roleForm.querySelector('.role-submit');
    const chosen = () => roleForm.querySelector('.role-input:checked');

    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((res) => {
        if (res.status === 401) { window.location.href = `login.html${location.search}`; return null; }
        return res.ok ? res.json() : null;
      })
      .then((data) => {
        // A saved choice wins; otherwise ?role= (e.g. from "Start selling")
        // preselects a card.
        const wanted = (data && data.role) || new URLSearchParams(location.search).get('role');
        if (!wanted) return;
        const input = roleForm.querySelector(`.role-input[value="${CSS.escape(wanted)}"]`);
        if (input) { input.checked = true; submit.disabled = false; }
      })
      .catch(() => {});

    roleForm.addEventListener('change', () => { submit.disabled = !chosen(); hideError(errorEl); });

    roleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = chosen();
      if (!input) return;
      hideError(errorEl);
      const originalLabel = submit.textContent;
      submit.textContent = 'Saving…';
      submit.disabled = true;
      try {
        const res = await fetch('/api/account/role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: input.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        // A pending checkout wins; otherwise the account page, which opens
        // on the producer area for producers.
        const next = getNextUrl();
        window.location.href = next !== 'profile.html' ? next : (data.role === 'producer' ? 'profile-producer.html' : 'profile.html');
      } catch (err) {
        showError(errorEl, err.message);
        submit.textContent = originalLabel;
        submit.disabled = false;
      }
    });
  }
})();
