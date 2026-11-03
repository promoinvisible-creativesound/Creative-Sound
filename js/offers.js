/* Offers: "Make an offer" on a track page, and profile-offers.html (offers you received and made).
   API: /api/beats/offers (api/_lib/offers.js). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const euro = (c) => `€${(c / 100).toFixed(2)}`;
  const API = '/api/beats/offers';
  const toLogin = () => { location.href = `login.html?next=${encodeURIComponent(location.pathname + location.search)}`; };
  const post = async (body) => {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401) { toLogin(); throw new Error('signin'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save. Please try again.');
    return data;
  };

  /* ------------------------------ "Make an offer" dialog ---------------------------- */
  let dlg = null;
  const closeDlg = () => { if (dlg) { dlg.remove(); dlg = null; document.body.style.overflow = ''; } };
  function openDlg(btn) {
    closeDlg();
    let tiers = [];
    try { tiers = JSON.parse(btn.dataset.offerTiers || '[]'); } catch (e) { tiers = []; }
    if (!tiers.length) return;
    const beatId = btn.dataset.offerMake;
    const first = tiers[0];
    dlg = document.createElement('div');
    dlg.className = 'of-back';
    dlg.innerHTML = `
      <form class="of-dlg" role="dialog" aria-modal="true" aria-labelledby="of-t">
        <button type="button" class="of-x" aria-label="Close">×</button>
        <h2 id="of-t">Make an offer</h2>
        <p class="of-sub">${esc(btn.dataset.offerTitle || '')}. The producer can accept or decline. If they accept, the price is yours for 72 hours.</p>
        <fieldset class="of-tiers"><legend>License</legend>
          ${tiers.map((t, i) => `<label class="of-tier"><input type="radio" name="tier" value="${esc(t.id)}" data-cents="${t.cents}"${i === 0 ? ' checked' : ''}><span>${esc(t.name)}</span><b>${euro(t.cents)}</b></label>`).join('')}
        </fieldset>
        <label class="of-field"><span>Your offer (€)</span><input type="text" name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-describedby="of-hint"></label>
        <p class="of-hint" id="of-hint"></p>
        <label class="of-field"><span>Message (optional)</span><textarea name="message" rows="2" maxlength="300" placeholder="Say what you plan to do with the track"></textarea></label>
        <p class="up-error of-err" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary of-send">Send offer</button>
      </form>`;
    document.body.appendChild(dlg);
    document.body.style.overflow = 'hidden';
    const form = $('form', dlg), amount = form.elements.amount, err = $('.of-err', dlg), send = $('.of-send', dlg);
    const hint = () => {
      const cents = Number($('input[name="tier"]:checked', form).dataset.cents);
      const floor = Math.max(500, Math.ceil(cents * 0.5));
      $('#of-hint', dlg).textContent = `Between ${euro(floor)} and ${euro(cents - 1)} for this license. The producer gets 80%.`;
      amount.placeholder = ((floor + cents) / 2 / 100).toFixed(2);
    };
    hint();
    form.addEventListener('change', (e) => { if (e.target.name === 'tier') hint(); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('.of-x')) closeDlg(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true; send.disabled = true;
      try {
        await post({ do: 'make', beatId, tier: $('input[name="tier"]:checked', form).value, amount: amount.value, message: form.elements.message.value });
        form.innerHTML = `<h2>Offer sent</h2><p class="of-sub">The producer got an email. You will hear back by email, and you can follow it in your offers.</p><a class="btn btn-primary" href="profile-offers.html">See my offers</a>`;
      } catch (ex) { if (ex.message !== 'signin') { err.textContent = ex.message; err.hidden = false; } send.disabled = false; }
    });
    setTimeout(() => { if (!matchMedia('(pointer:coarse)').matches) amount.focus(); }, 50);
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-offer-make]'); if (b) { e.preventDefault(); openDlg(b); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDlg(); });

  /* --------------------------------- Offers page ------------------------------------ */
  const root = $('#of-root');
  if (!root) return;
  const LABEL = { pending: 'Waiting for an answer', accepted: 'Accepted', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled', paid: 'Bought' };
  const when = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const left = (d) => { const h = Math.max(0, Math.round((new Date(d) - Date.now()) / 36e5)); return h >= 24 ? `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? '' : 's'} left` : `${h} hour${h === 1 ? '' : 's'} left`; };
  const tierName = (t) => ({ mp3: 'MP3 Lease', wav: 'WAV Lease', trackout: 'Trackout', stems: 'Stems', project: 'Project' }[t] || t);
  let data = { made: [], received: [] };

  const card = (o, kind) => `
    <article class="of-card is-${o.status}" data-id="${o.id}">
      <div class="of-top"><b>${esc(o.title)}</b><span class="of-status">${LABEL[o.status] || o.status}</span></div>
      <p class="of-meta">${kind === 'received' ? `From ${esc(o.who)}` : `To ${esc(o.who)}`} · ${esc(tierName(o.tier))} · listed ${euro(o.listCents)} · ${when(o.createdAt)}</p>
      <p class="of-price">${euro(o.offerCents)}${kind === 'received' && o.status === 'pending' ? `<small>you earn ${euro(Math.floor(o.offerCents * 0.8))}</small>` : ''}</p>
      ${o.message ? `<p class="of-msg">“${esc(o.message)}”</p>` : ''}
      ${o.note ? `<p class="of-msg">Reply: “${esc(o.note)}”</p>` : ''}
      ${kind === 'received' && o.status === 'pending' ? `
        <input class="of-note" type="text" maxlength="300" placeholder="Note to the buyer (optional)" aria-label="Note to the buyer">
        <div class="of-actions"><button type="button" class="btn btn-ghost" data-of="decline">Decline</button><button type="button" class="btn btn-primary" data-of="accept">Accept ${euro(o.offerCents)}</button></div>` : ''}
      ${kind === 'made' && o.status === 'accepted' ? `<div class="of-actions"><button type="button" class="btn btn-ghost" data-of="cancel">Cancel</button><button type="button" class="btn btn-primary" data-of="buy">Buy for ${euro(o.offerCents)}</button></div><p class="of-left">${left(o.expiresAt)}</p>` : ''}
      ${kind === 'made' && o.status === 'pending' ? '<div class="of-actions"><button type="button" class="btn btn-ghost" data-of="cancel">Cancel offer</button></div>' : ''}
    </article>`;

  const paint = (msg) => {
    const open = data.received.filter((o) => o.status === 'pending').length;
    root.innerHTML = `
      ${data.received.length ? `<h2 class="of-h">Offers you received${open ? ` <span class="of-n">${open}</span>` : ''}</h2><div class="of-list">${data.received.map((o) => card(o, 'received')).join('')}</div>` : ''}
      <h2 class="of-h">Offers you made</h2>
      ${data.made.length ? `<div class="of-list">${data.made.map((o) => card(o, 'made')).join('')}</div>` : '<p class="pl-none">No offers yet. Open a track from a producer and press “Make an offer”.</p>'}
      <p class="pl-msg" role="status">${msg ? esc(msg) : ''}</p>`;
  };
  const load = async () => {
    const res = await fetch(API);
    if (res.status === 401) { toLogin(); return; }
    data = await res.json().catch(() => data);
    paint();
  };
  load().catch(() => { root.innerHTML = '<p class="pl-none">Could not load your offers.</p>'; });

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-of]');
    if (!b) return;
    const cardEl = b.closest('.of-card'), id = Number(cardEl.dataset.id), act = b.dataset.of;
    const offer = [...data.made, ...data.received].find((o) => o.id === id);
    if (act === 'buy') {
      // Put the offer in the cart at its price, then open the cart.
      let cart = [];
      try { cart = JSON.parse(localStorage.getItem('bt-cart') || '[]'); } catch (err) { cart = []; }
      cart = cart.filter((c) => c.id !== offer.beatId);
      cart.push({ id: offer.beatId, tier: offer.tier, offer: offer.id, price: offer.offerCents });
      try { localStorage.setItem('bt-cart', JSON.stringify(cart)); } catch (err) { /* private mode */ }
      location.href = 'beats.html?cart=1';
      return;
    }
    b.disabled = true;
    try {
      const body = act === 'cancel' ? { do: 'cancel', id } : { do: 'decide', id, accept: act === 'accept', note: $('.of-note', cardEl) ? $('.of-note', cardEl).value : '' };
      const out = await post(body);
      data = { made: out.made || data.made, received: out.received || data.received };
      if (!out.made) await load(); else paint();
    } catch (err) { if (err.message !== 'signin') { b.disabled = false; paint(err.message); } }
  });
})();
