const { Resend } = require('resend');
const { sql } = require('./_lib/db');
const { getSession } = require('./_lib/auth');

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = async (req, res) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const tickets = await sql`
        SELECT id, subject, message, status, created_at FROM tickets
        WHERE email = ${session.email}
        ORDER BY created_at DESC
      `;
      res.status(200).json({ tickets });
    } catch (err) {
      console.error('tickets list error:', err);
      res.status(500).json({ error: 'Something went wrong.' });
    }
    return;
  }

  if (req.method === 'POST') {
    const subject = String((req.body && req.body.subject) || '').trim().slice(0, 200);
    const message = String((req.body && req.body.message) || '').trim().slice(0, 5000);

    if (!subject || !message) {
      res.status(400).json({ error: 'Subject and message are required.' });
      return;
    }

    try {
      const [ticket] = await sql`
        INSERT INTO tickets (email, subject, message)
        VALUES (${session.email}, ${subject}, ${message})
        RETURNING id, subject, message, status, created_at
      `;

      try {
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: 'hello@creativesound.io',
          replyTo: session.email,
          subject: `Support ticket — ${subject}`,
          html: `
            <div style="background:#080807;color:#f5f3ee;font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:32px;">
              <h1 style="color:#FFB347;font-size:18px;">New support ticket</h1>
              <p><strong>From:</strong> ${escapeHtml(session.email)}</p>
              <p><strong>Subject:</strong> ${escapeHtml(subject)}</p>
              <p><strong>Message:</strong></p>
              <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>
            </div>
          `,
        });
      } catch (err) {
        // Ticket is already saved — log for manual follow-up rather than
        // failing the request over an email hiccup.
        console.error('ticket notification email failed:', err);
      }

      res.status(200).json({ ticket });
    } catch (err) {
      console.error('ticket create error:', err);
      res.status(500).json({ error: 'Something went wrong, please try again.' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
