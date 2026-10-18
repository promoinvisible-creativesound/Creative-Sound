const { Resend } = require('resend');
const { sql } = require('./_lib/db');
const { getSession } = require('./_lib/auth');
const { handleNotify } = require('./_lib/notify');
const { handleCheckout: handleBeatsCheckout, handleSaved: handleBeatsSaved, handleLicense: handleBeatsLicense } = require('./_lib/beats');
const { handleRole } = require('./_lib/account');
const { handleCatalogue, handleMedia, handleBoughtFile } = require('./_lib/catalogue');
const profile = require('./_lib/profile');
const payouts = require('./_lib/payouts');
const { handleMessages } = require('./_lib/messages');
const extras = require('./_lib/extras');
const {
  handleFile: handleProducerFile,
  handleChunk: handleProducerChunk,
  handleSubmit: handleProducerSubmit,
  handleSubmissions: handleProducerSubmissions,
  handleAdminList: handleReviewList,
  handleAdminReview: handleReviewDecide,
  handleAdminInspect: handleReviewInspect,
  handleAdminVerify: handleReviewVerify,
  handleAdminProducers: handleReviewProducers,
  handleVerifyRequest,
  handleAdminTag: handleReviewTag,
} = require('./_lib/producer');

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = async (req, res) => {
  // Public "notify me" sign-ups share this function (see _lib/notify.js).
  if (req.query && req.query.action === 'notify') {
    await handleNotify(req, res);
    return;
  }
  // Beat store checkout shares this function too (see _lib/beats.js).
  if (req.query && req.query.action === 'beats-checkout') {
    await handleBeatsCheckout(req, res);
    return;
  }
  // Live catalogue, producer track media and bought files (_lib/catalogue.js).
  const catalogueRoutes = {
    'beats-catalogue': handleCatalogue,
    'beats-media': handleMedia,
    'beats-file': handleBoughtFile,
    'beats-license': handleBeatsLicense,
    // Public profiles (_lib/profile.js)
    'profile-me': profile.handleMe,
    'profile-avatar': profile.handleAvatar,
    'profile-photo': profile.handlePhoto,
    'profile-producer-tag': profile.handleProducerTag,
    'profile-public': profile.handlePublic,
    'profile-store': profile.handleStore,
    // Producer payouts (_lib/payouts.js)
    'producer-payouts': payouts.handlePayouts,
    'payouts-run': payouts.handleRun,
    'payouts-check': payouts.handleCheck,
    // Private messages between members (_lib/messages.js)
    messages: handleMessages,
    // Listening extras: free tagged download, waveform, lyrics (_lib/extras.js)
    'beats-free': extras.handleFree,
    'beats-peaks': extras.handlePeaks,
    'beats-lyrics': extras.handleLyrics,
    'beats-event': extras.handleEvent,
    'producer-stats': extras.handleStats,
  };
  if (req.query && catalogueRoutes[req.query.action]) {
    await catalogueRoutes[req.query.action](req, res);
    return;
  }
  if (req.query && req.query.action === 'beats-saved') {
    await handleBeatsSaved(req, res);
    return;
  }
  // Account type (producer / artist / listener), see _lib/account.js.
  if (req.query && req.query.action === 'account-role') {
    await handleRole(req, res);
    return;
  }
  // Producer uploads and review queue, see _lib/producer.js.
  const producerRoutes = {
    'producer-file': handleProducerFile,
    'producer-chunk': handleProducerChunk,
    'producer-submit': handleProducerSubmit,
    'producer-submissions': handleProducerSubmissions,
    'review-list': handleReviewList,
    'review-decide': handleReviewDecide,
    'review-inspect': handleReviewInspect,
    'review-verify': handleReviewVerify,
    'review-producers': handleReviewProducers,
    'review-tag': handleReviewTag,
    'producer-verify-request': handleVerifyRequest,
  };
  if (req.query && producerRoutes[req.query.action]) {
    await producerRoutes[req.query.action](req, res);
    return;
  }

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
        { const { error: sendError } = await resend.emails.send({
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
        }); if (sendError) console.error('tickets email rejected by Resend:', sendError); }
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
