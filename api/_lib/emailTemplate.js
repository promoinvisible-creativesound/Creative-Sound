// Shared look for every Creative Sound email: a calm dark card, clean sans
// type, a big title, pill buttons and simple detail rows (Apple-style).
// Email clients ignore modern CSS, so this is nested tables with inline
// styles and bgcolor fallbacks; rounded corners degrade to square in old
// Outlook, everything else still reads fine.
const C = {
  bg: '#0b0a09',
  card: '#161514',
  inset: '#0f0e0d',
  line: '#2a2826',
  text: '#f5f5f7',
  body: '#d1d1d6',
  muted: '#8e8e93',
  accent: '#e8862c',
  amber: '#f5b06a',
  ink: '#140b02',
};
const SANS = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SF Mono',Menlo,Consolas,'Courier New',monospace";

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function button(href, text, { primary = true } = {}) {
  const style = primary
    ? `background:${C.accent};color:${C.ink};border:1px solid ${C.accent};`
    : `background:${C.inset};color:${C.text};border:1px solid ${C.line};`;
  return `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 22px;border-radius:999px;${style}font-family:${SANS};font-size:14px;font-weight:600;line-height:1.2;text-decoration:none;">${esc(text)}</a>`;
}

// A value people need to copy (license key, code).
function codeBlock(title, value) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
      <tr><td bgcolor="${C.inset}" style="padding:16px 18px;background:${C.inset};border:1px solid ${C.line};border-radius:14px;">
        <div style="font-family:${SANS};font-size:12px;font-weight:600;color:${C.muted};">${esc(title)}</div>
        <div style="margin-top:6px;font-family:${MONO};font-size:15px;line-height:1.6;letter-spacing:0.5px;color:${C.amber};word-break:break-all;">${esc(value)}</div>
      </td></tr>
    </table>`;
}

// Numbered steps with small round numbers.
function steps(items) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
      ${items.map((text, i) => `
      <tr>
        <td valign="top" width="36" style="padding:7px 0;">
          <div style="width:24px;height:24px;border-radius:12px;background:#2a1d10;color:${C.amber};font-family:${SANS};font-size:12px;font-weight:700;line-height:24px;text-align:center;">${i + 1}</div>
        </td>
        <td valign="top" style="padding:9px 0;font-family:${SANS};font-size:15px;line-height:1.55;color:${C.body};">${text}</td>
      </tr>`).join('')}
    </table>`;
}

function paragraph(html) {
  return `<p style="margin:14px 0 0;font-family:${SANS};font-size:15.5px;line-height:1.6;color:${C.body};">${html}</p>`;
}

// Label / value rows (track, price, status...). Values are escaped unless
// passed as { html }.
function details(rows) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px;background:${C.inset};border:1px solid ${C.line};border-radius:14px;" bgcolor="${C.inset}">
      ${rows.filter(Boolean).map(([k, v], i) => `
      <tr>
        <td style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${SANS};font-size:14px;color:${C.muted};">${esc(k)}</td>
        <td align="right" style="padding:12px 16px;${i ? `border-top:1px solid ${C.line};` : ''}font-family:${SANS};font-size:14px;font-weight:600;color:${C.text};">${v && v.html ? v.html : esc(v)}</td>
      </tr>`).join('')}
    </table>`;
}

// Highlighted note (review feedback, warnings).
function note(text, { tone = 'neutral' } = {}) {
  const bar = tone === 'bad' ? '#ff7b6b' : tone === 'ok' ? '#4cc97a' : C.accent;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 4px;">
      <tr>
        <td width="3" bgcolor="${bar}" style="width:3px;background:${bar};border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
        <td bgcolor="${C.inset}" style="padding:14px 16px;background:${C.inset};border-radius:0 12px 12px 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.text};white-space:pre-wrap;">${esc(text)}</td>
      </tr>
    </table>`;
}

// content = already-built inner HTML from the helpers above.
function renderEmail({ siteUrl, preheader, kicker, title, content }) {
  const base = String(siteUrl || 'https://creativesound.io').replace(/\/$/, '');
  const link = (href, text) => `<a href="${esc(href)}" style="color:${C.amber};text-decoration:none;">${esc(text)}</a>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${C.bg};">${esc(preheader || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
  <tr>
    <td align="center" style="padding:36px 14px;">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">
        <tr>
          <td style="padding:0 6px 18px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle" style="padding-right:10px;"><img src="${esc(base)}/assets/img/apple-touch-icon.png" width="28" height="28" alt="" style="display:block;border:0;border-radius:7px;"></td>
              <td valign="middle" style="font-family:${SANS};font-size:15px;font-weight:600;color:${C.text};">Creative Sound</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:22px;padding:34px 32px 30px;">
            ${kicker ? `<div style="display:inline-block;padding:5px 11px;border-radius:999px;background:#2a1d10;color:${C.amber};font-family:${SANS};font-size:12.5px;font-weight:600;">${esc(kicker)}</div>` : ''}
            <h1 style="margin:${kicker ? '16px' : '0'} 0 0;font-family:${SANS};font-size:27px;line-height:1.2;font-weight:700;letter-spacing:-0.4px;color:${C.text};">${esc(title)}</h1>
            ${content}
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 16px 0;font-family:${SANS};font-size:12.5px;line-height:1.7;color:${C.muted};">
            Questions? Write to ${link('mailto:hello@creativesound.io', 'hello@creativesound.io')}<br>
            Creative Sound · ${link(base, base.replace(/^https?:\/\//, ''))}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function accountLine(siteUrl) {
  const base = String(siteUrl || 'https://creativesound.io').replace(/\/$/, '');
  return paragraph(`Create an account with this same email at <a href="${esc(base)}/signup.html" style="color:${C.amber};text-decoration:none;">creativesound.io/signup</a> to find it again any time from your profile.`);
}

module.exports = { renderEmail, button, codeBlock, steps, paragraph, details, note, accountLine, esc };
