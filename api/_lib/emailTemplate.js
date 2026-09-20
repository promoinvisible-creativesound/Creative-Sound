// Shared look for the purchase emails: the site's dark panels and orange
// accent, set in a monospace "HUD" voice. Email clients ignore modern CSS, so
// this is plain nested tables with inline styles, explicit bgcolor fallbacks
// and no web fonts or scripts.
const C = {
  bg: '#080807',
  panel: '#0d0d0c',
  inset: '#050505',
  line: '#2a2825',
  text: '#f5f3ee',
  muted: '#8a877e',
  accent: '#e8862c',
  amber: '#ffb347',
  ink: '#0a0a09',
};
const MONO = "'SF Mono','Consolas','Menlo','DejaVu Sans Mono','Courier New',monospace";
const SANS = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function label(text) {
  return `<div style="font-family:${MONO};font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${C.accent};">[ ${esc(text)} ]</div>`;
}

function button(href, text, { primary = true } = {}) {
  const bg = primary ? C.accent : C.panel;
  const color = primary ? C.ink : C.amber;
  const border = primary ? C.accent : C.accent;
  return `<a href="${esc(href)}" style="display:inline-block;margin:0 10px 10px 0;padding:14px 22px;background:${bg};border:1px solid ${border};color:${color};font-family:${MONO};font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;text-decoration:none;">${esc(text)} &rarr;</a>`;
}

function codeBlock(title, value) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
      <tr>
        <td bgcolor="${C.accent}" width="3" style="width:3px;font-size:0;line-height:0;">&nbsp;</td>
        <td bgcolor="${C.inset}" style="padding:16px 18px;background:${C.inset};border:1px solid ${C.line};border-left:0;">
          ${label(title)}
          <div style="margin-top:10px;font-family:${MONO};font-size:14px;line-height:1.7;letter-spacing:1px;color:${C.amber};word-break:break-all;">${esc(value)}</div>
        </td>
      </tr>
    </table>`;
}

function steps(items) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;">
      ${items.map((text, i) => `
      <tr>
        <td valign="top" width="44" style="padding:8px 0;font-family:${MONO};font-size:12px;letter-spacing:2px;color:${C.accent};">0${i + 1}</td>
        <td valign="top" style="padding:8px 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${C.text};border-top:1px solid ${C.line};">${text}</td>
      </tr>`).join('')}
    </table>`;
}

function paragraph(html) {
  return `<p style="margin:16px 0 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${C.text};">${html}</p>`;
}

// content = already-built inner HTML from the helpers above.
function renderEmail({ siteUrl, preheader, kicker, title, content }) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  const link = (href, text) => `<a href="${esc(href)}" style="color:${C.amber};text-decoration:underline;">${esc(text)}</a>`;
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
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${C.bg};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.panel}" style="width:100%;max-width:600px;background:${C.panel};border:1px solid ${C.line};">
        <tr><td bgcolor="${C.accent}" height="3" style="height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:22px 32px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td valign="middle" width="40">${base ? `<img src="${esc(base)}/assets/img/apple-touch-icon.png" width="32" height="32" alt="" style="display:block;border:0;">` : ''}</td>
                <td valign="middle" style="font-family:${MONO};font-size:11px;letter-spacing:3px;text-transform:uppercase;color:${C.text};">Creative Sound</td>
                <td valign="middle" align="right" style="font-family:${MONO};font-size:10px;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">// ${esc(kicker)}</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:26px 32px 8px;">
            <h1 style="margin:0;font-family:${MONO};font-size:26px;line-height:1.25;letter-spacing:2px;text-transform:uppercase;color:${C.text};">${esc(title)}</h1>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td bgcolor="${C.accent}" width="48" height="2" style="width:48px;height:2px;font-size:0;line-height:0;">&nbsp;</td></tr></table>
            ${content}
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 30px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid ${C.line};padding-top:18px;font-family:${SANS};font-size:13px;line-height:1.7;color:${C.muted};">
                Questions? Write to ${link('mailto:hello@creativesound.io', 'hello@creativesound.io')}.<br>
                <span style="font-family:${MONO};font-size:10px;letter-spacing:2px;text-transform:uppercase;">Creative Sound // Sound tools by Invisible</span>
              </td></tr>
            </table>
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
  const base = String(siteUrl || '').replace(/\/$/, '');
  return paragraph(`Create an account with this same email at <a href="${esc(base)}/signup.html" style="color:${C.amber};text-decoration:underline;">${esc(base)}/signup.html</a> to find it again any time from your profile.`);
}

module.exports = { renderEmail, button, codeBlock, steps, paragraph, accountLine, esc };
