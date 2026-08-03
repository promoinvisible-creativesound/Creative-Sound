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
        window.location.href = 'profile.html';
      } catch (err) {
        showError(errorEl, err.message);
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });
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
        window.location.href = 'profile.html';
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
      list.innerHTML = '<p class="profile-empty">No Creative Dist license on this account yet — buy it from the <a href="creative-dist.html">product page</a>, using this same email.</p>';
      return;
    }
    list.innerHTML = data.licenses.map((lic) => `
      <div class="profile-license">
        <div class="profile-license-key">${lic.license_key}</div>
        <div class="profile-license-date">Issued ${new Date(lic.created_at).toLocaleDateString()}</div>
        ${data.downloadUrl
          ? `<a href="${data.downloadUrl}" class="btn btn-primary" style="margin-top:14px;">Download Creative Dist</a>`
          : '<p class="profile-license-date" style="margin-top:10px;">Download link coming soon — we\'ll email you when the build is ready.</p>'}
        ${data.latestVersion
          ? `<a href="${data.latestVersion.url}" class="btn btn-ghost" style="margin-top:10px;">Download ${data.latestVersion.label}</a>`
          : ''}
      </div>
    `).join('');
  }

  function renderOrders(data) {
    const orders = document.getElementById('profile-orders');
    if (!orders) return;
    if (!data.orders.length) {
      orders.innerHTML = '<p class="profile-empty">No orders yet.</p>';
      return;
    }
    orders.innerHTML = data.orders.map((o) => `
      <div class="order-row">
        <span class="order-row-date">${new Date(o.created_at).toLocaleDateString()}</span>
        <span class="order-row-name">Creative Dist</span>
        <span class="order-row-amount">${formatAmount(o.amount_total, o.currency)}</span>
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
        document.getElementById('hub-license-sub').textContent = data.licenses.length
          ? `${data.licenses.length} license${data.licenses.length > 1 ? 's' : ''}`
          : 'No license yet';
        document.getElementById('hub-orders-sub').textContent = data.orders.length
          ? `${data.orders.length} order${data.orders.length > 1 ? 's' : ''}`
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
          const res = await fetch('/api/auth/change-password', {
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
      window.location.href = 'index.html';
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
})();
