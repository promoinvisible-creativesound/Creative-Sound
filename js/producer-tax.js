// Producer area: tax details form and monthly statements.
// GET/POST /api/producer/tax, GET /api/producer/statement (see _lib/producer-tax.js).
(() => {
  'use strict';
  const form = document.getElementById('tx-form');
  if (!form) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const card = document.getElementById('tax');
  const statements = document.getElementById('statements');
  const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
  const CODES = 'AF AL DZ AD AO AR AM AU AT AZ BH BD BY BE BO BA BR BG CA CL CN CO CR HR CU CY CZ DK DO EC EG SV EE ET FI FR GE DE GH GR GT HN HK HU IS IN ID IR IQ IE IL IT JM JP JO KZ KE KW LV LB LT LU MY MT MX MD MA NL NZ NG NO OM PK PA PY PE PH PL PT QA RO RU SA RS SG SK SI ZA KR ES LK SE CH TW TH TN TR UA AE GB US UY UZ VE VN'.split(' ');
  const names = (() => { try { const d = new Intl.DisplayNames(['en'], { type: 'region' }); return (c) => d.of(c) || c; } catch (e) { return (c) => c; } })();

  // Country list: Italy first, then everyone alphabetically.
  const country = $('#tx-country');
  const sorted = CODES.filter((c) => c !== 'IT').sort((a, b) => names(a).localeCompare(names(b)));
  country.innerHTML = '<option value="" disabled selected>Choose…</option>' + ['IT', ...sorted].map((c) => `<option value="${c}">${esc(names(c))}</option>`).join('');

  const say = (t, kind) => { const el = $('#tx-status'); el.textContent = t || ''; el.className = `tx-status${kind ? ` is-${kind}` : ''}`; };
  const badge = $('#tx-badge');

  // Labels follow the type of earner and the country.
  const adapt = () => {
    const type = form.entityType.value;
    const c = country.value;
    const business = type === 'business';
    $('#tx-name-label').textContent = business ? 'Registered business name' : 'Full legal name';
    $('#tx-taxid-label').textContent = c === 'IT' ? (business ? 'Partita IVA or codice fiscale' : 'Codice fiscale') : 'Tax ID';
    $('#tx-birth-wrap').hidden = business;
    const needVat = business && EU.has(c);
    $('#tx-vat-hint').textContent = needVat ? 'Required' : 'Optional';
    form.vatNumber.required = needVat;
  };
  form.addEventListener('change', adapt);

  const paint = (d) => {
    const t = d.tax;
    $('#tx-declaration').textContent = d.declaration;
    if (t) {
      form.entityType.value = t.entityType;
      form.legalName.value = t.legalName;
      country.value = t.country;
      form.taxId.value = t.taxId;
      form.vatNumber.value = t.vatNumber;
      form.birthDate.value = t.birthDate;
      form.address.value = t.address;
      form.city.value = t.city;
      form.postalCode.value = t.postalCode;
    }
    adapt();
    badge.hidden = false;
    badge.textContent = d.complete ? 'Confirmed' : (t ? 'Please confirm again' : 'Needed for payouts');
    badge.className = `po-badge tx-badge ${d.complete ? 'is-ok' : 'is-warn'}`;
    form.declared.checked = false;
    $('#tx-save').textContent = d.complete ? 'Update tax details' : 'Save tax details';
  };

  const load = () => fetch('/api/producer/tax').then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) { card.hidden = true; statements.hidden = true; return null; }
    if (!r.ok) throw new Error(d.error || 'Could not load your tax details.');
    return d;
  }).then((d) => { if (d) paint(d); }).catch((e) => say(e.message, 'bad'));
  load();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#tx-save');
    btn.disabled = true;
    say('Saving…');
    try {
      const body = Object.fromEntries(new FormData(form).entries());
      body.declared = form.declared.checked;
      const r = await fetch('/api/producer/tax', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not save your tax details.');
      paint(d);
      say('Saved. Your payouts are no longer waiting for this.', 'ok');
      const warn = document.getElementById('po-tax-warn');
      if (warn) warn.hidden = true;
    } catch (err) {
      say(err.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  /* -------------------------------- Statements ------------------------------- */
  const euro = (c) => `€${((c || 0) / 100).toFixed(2)}`;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const label = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  fetch('/api/producer/statement').then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (!d || !d.months || !d.months.length) return;
    $('#st-body').innerHTML = d.months.map((m) => `
      <div class="tx-st-row">
        <div><b>${esc(label(m.month))}</b><small>${m.sales} sale${m.sales === 1 ? '' : 's'} · ${euro(m.gross)} sold · ${euro(m.net)} to you</small></div>
        <div class="tx-st-links">
          <a href="/api/producer/statement?month=${m.month}&format=pdf&view=1" target="_blank" rel="noopener">View PDF</a>
          <a href="/api/producer/statement?month=${m.month}&format=csv" download>CSV</a>
        </div>
      </div>`).join('');
  }).catch(() => {});
})();
