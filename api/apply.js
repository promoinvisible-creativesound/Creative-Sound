const fs = require('fs');
const { Resend } = require('resend');
const formidable = require('formidable');

const resend = new Resend(process.env.RESEND_API_KEY);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx'];

// Vercel's default bodyParser doesn't handle multipart/form-data — let
// formidable read the raw request stream itself.
module.exports.config = { api: { bodyParser: false } };

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const form = formidable({ maxFileSize: MAX_FILE_SIZE, keepExtensions: true });

  let fields;
  let files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    console.error('apply form parse error:', err);
    res.status(400).json({ error: 'Upload failed — check that your CV is under 5MB.' });
    return;
  }

  const get = (obj, key) => {
    const v = obj[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const name = (get(fields, 'name') || '').trim();
  const email = (get(fields, 'email') || '').trim();
  const role = (get(fields, 'role') || '').trim();
  const message = (get(fields, 'message') || '').trim();

  if (!name || !email || !message) {
    res.status(400).json({ error: 'Name, email and a message are required.' });
    return;
  }

  const attachments = [];
  const cvFile = get(files, 'cv');
  if (cvFile && cvFile.size > 0) {
    const ext = (cvFile.originalFilename || '').toLowerCase().slice(-4);
    if (!ALLOWED_EXTENSIONS.some((e) => ext.endsWith(e))) {
      res.status(400).json({ error: 'CV must be a PDF or Word document.' });
      return;
    }
    attachments.push({
      filename: cvFile.originalFilename || 'cv',
      content: fs.readFileSync(cvFile.filepath),
    });
  }

  try {
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: 'hello@creativesound.io',
      replyTo: email,
      subject: `Work with us — ${name}${role ? ` (${role})` : ''}`,
      html: `
        <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;">
          <h1 style="color:#FFB347;font-size:18px;">New application</h1>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          ${role ? `<p><strong>Area of interest:</strong> ${escapeHtml(role)}</p>` : ''}
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>
          ${attachments.length ? '<p style="color:#8a877e;font-size:13px;">CV attached.</p>' : ''}
        </div>
      `,
      attachments,
    });
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('apply send error:', err);
    res.status(500).json({ error: 'Something went wrong sending your application — please try again.' });
  }
};
