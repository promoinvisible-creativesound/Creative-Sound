(() => {
  'use strict';

  function showError(el, message) {
    el.textContent = message;
    el.classList.add('visible');
  }
  function hideError(el) {
    el.classList.remove('visible');
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

  /* ----------------------------------- Profile ------------------------------- */
  const profileRoot = document.getElementById('profile-root');
  if (profileRoot) {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.status === 401) {
          window.location.href = 'login.html';
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Something went wrong.');
        renderProfile(data);
      } catch (err) {
        profileRoot.innerHTML = `<p class="auth-error visible">${err.message}</p>`;
      }
    })();

    function renderProfile(data) {
      const emailEl = document.getElementById('profile-email');
      emailEl.textContent = data.email;

      const list = document.getElementById('profile-licenses');
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
        </div>
      `).join('');
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = 'index.html';
      });
    }
  }
})();
