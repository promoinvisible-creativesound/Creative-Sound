// Private messages between members (an artist writing to a producer about a
// track, and the replies). Names, handles and photos only: emails are never
// shown to the other person.
//
//   GET  /api/messages?op=unread     -> { unread }
//   GET  /api/messages               -> { threads: [{ user, last, unread }], unread }
//   GET  /api/messages?with=<uid>    -> { user, messages } (marks them read)
//   POST /api/messages               -> send { to: uid | beatId, body }
const { Resend } = require('resend');
const { sql } = require('./db');
const { getSession } = require('./auth');
const tpl = require('./emailTemplate');

const MAX_BODY = 2000;

let ready = null;
function ensureTable() {
  if (!ready) {
    ready = (async () => {
      await require('./profile').ensureColumns();
      await sql`CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        beat_id TEXT,
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at TIMESTAMPTZ
      )`;
      await sql`CREATE INDEX IF NOT EXISTS messages_recipient_idx ON messages (recipient_id, read_at)`;
      await sql`CREATE INDEX IF NOT EXISTS messages_pair_idx ON messages (LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), created_at)`;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

const photoUrl = (row) => (row.avatar_path && row.handle ? `/api/profile/photo?u=${encodeURIComponent(row.handle)}&v=${encodeURIComponent(String(row.avatar_path).split('?v=')[1] || '1')}` : null);
const nameOf = (row) => row.display_name || row.producer_name || row.handle || 'Member';
const person = (row) => ({ id: row.id, name: nameOf(row), handle: row.handle || null, photo: photoUrl(row), verified: !!row.producer_verified });

async function userById(id) {
  const [row] = await sql`SELECT id, email, handle, display_name, producer_name, avatar_path, producer_verified FROM users WHERE id = ${id}`;
  return row || null;
}

// Producer of an approved track ("t12-title" -> submission 12 -> its owner).
async function producerOfBeat(beatId) {
  const m = /^t(\d+)-/.exec(String(beatId || ''));
  if (!m) return null;
  const [row] = await sql`SELECT user_id, title FROM beat_submissions WHERE id = ${Number(m[1])} AND status = 'approved'`;
  return row ? { userId: row.user_id, title: row.title } : null;
}

async function unreadCount(uid) {
  const [r] = await sql`SELECT count(*)::int AS n FROM messages WHERE recipient_id = ${uid} AND read_at IS NULL`;
  return r.n;
}

async function threads(uid) {
  // Latest message per conversation partner, newest conversations first.
  const rows = await sql`
    SELECT DISTINCT ON (other) other, body, created_at, sender_id
    FROM (SELECT CASE WHEN sender_id = ${uid} THEN recipient_id ELSE sender_id END AS other, body, created_at, sender_id
          FROM messages WHERE sender_id = ${uid} OR recipient_id = ${uid}) t
    ORDER BY other, created_at DESC`;
  if (!rows.length) return [];
  const ids = rows.map((r) => r.other);
  const users = await sql`SELECT id, handle, display_name, producer_name, avatar_path, producer_verified FROM users WHERE id = ANY(${ids})`;
  const unread = await sql`SELECT sender_id, count(*)::int AS n FROM messages WHERE recipient_id = ${uid} AND read_at IS NULL GROUP BY sender_id`;
  const byId = new Map(users.map((u) => [u.id, u]));
  const un = new Map(unread.map((u) => [u.sender_id, u.n]));
  return rows
    .filter((r) => byId.has(r.other))
    .map((r) => ({ user: person(byId.get(r.other)), last: { body: r.body.slice(0, 140), at: r.created_at, mine: r.sender_id === uid }, unread: un.get(r.other) || 0 }))
    .sort((a, b) => new Date(b.last.at) - new Date(a.last.at));
}

async function notifyByEmail(sender, recipient, body, beatTitle) {
  // One email per unread streak: only when this is the first unread message
  // from this sender, so a long chat doesn't flood the inbox.
  const [r] = await sql`SELECT count(*)::int AS n FROM messages WHERE sender_id = ${sender.id} AND recipient_id = ${recipient.id} AND read_at IS NULL`;
  if (r.n > 1 || !recipient.email) return;
  const site = process.env.SITE_URL || 'https://creativesound.io';
  const from = nameOf(sender);
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: recipient.email,
      subject: `New message from ${from}${beatTitle ? ` about ${beatTitle}` : ''}`,
      html: tpl.renderEmail({
        siteUrl: site,
        preheader: body.slice(0, 90),
        kicker: 'New message',
        title: `${from} sent you a message`,
        content: [
          beatTitle ? tpl.paragraph(`About <b>${tpl.esc(beatTitle)}</b>:`) : '',
          tpl.note(body.length > 400 ? `${body.slice(0, 400)}…` : body),
          `<div style="margin-top:22px;">${tpl.button(`${site}/messages.html?with=${sender.id}`, 'Reply on Creative Sound')}</div>`,
        ].join(''),
      }),
    });
    if (error) console.error('message email error:', error);
  } catch (err) { console.error('message email error:', err); }
}

async function handleMessages(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: 'Please sign in.' }); return; }
  const uid = session.uid;
  try {
    await ensureTable();
    if (req.method === 'GET') {
      const q = req.query || {};
      if (q.op === 'unread') { res.status(200).json({ unread: await unreadCount(uid) }); return; }
      // ?beat=<trackId>: the conversation with that track's producer.
      if (q.beat && !q.with) {
        const p = await producerOfBeat(q.beat);
        if (!p) { res.status(404).json({ error: 'This track can not be messaged about.' }); return; }
        if (p.userId === uid) { res.status(400).json({ error: "This is your own track, you can't message yourself." }); return; }
        q.with = p.userId;
      }
      if (q.with) {
        const other = await userById(Number(q.with));
        if (!other || other.id === uid) { res.status(404).json({ error: 'Conversation not found.' }); return; }
        const rows = await sql`
          SELECT id, sender_id, body, beat_id, created_at FROM messages
          WHERE (sender_id = ${uid} AND recipient_id = ${other.id}) OR (sender_id = ${other.id} AND recipient_id = ${uid})
          ORDER BY created_at DESC LIMIT 200`;
        await sql`UPDATE messages SET read_at = now() WHERE recipient_id = ${uid} AND sender_id = ${other.id} AND read_at IS NULL`;
        res.status(200).json({
          user: person(other),
          messages: rows.reverse().map((m) => ({ id: m.id, mine: m.sender_id === uid, body: m.body, beatId: m.beat_id, at: m.created_at })),
          unread: await unreadCount(uid),
        });
        return;
      }
      res.status(200).json({ threads: await threads(uid), unread: await unreadCount(uid) });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const body = String((req.body && req.body.body) || '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!body) { res.status(400).json({ error: 'Write a message first.' }); return; }
    if (body.length > MAX_BODY) { res.status(400).json({ error: `Keep it under ${MAX_BODY} characters.` }); return; }
    let toId = Number(req.body && req.body.to) || null;
    let beatId = null;
    let beatTitle = null;
    // A message can be about a track: it goes to that track's producer, or
    // (in an existing chat) attaches a track by either of the two people.
    if (req.body && req.body.beatId) {
      const p = await producerOfBeat(req.body.beatId);
      if (!p) { res.status(404).json({ error: 'This track can not be messaged about.' }); return; }
      if (!toId) toId = p.userId;
      if (p.userId === toId || p.userId === uid) { beatId = String(req.body.beatId).slice(0, 120); beatTitle = p.title; }
    }
    if (!toId) { res.status(400).json({ error: 'Who is this message for?' }); return; }
    if (toId === uid) { res.status(400).json({ error: beatId ? "This is your own track, you can't message yourself." : "You can't message yourself." }); return; }
    const recipient = await userById(toId);
    if (!recipient) { res.status(404).json({ error: 'This member no longer exists.' }); return; }
    // Spam guard: at most 20 messages in 10 minutes.
    const [recent] = await sql`SELECT count(*)::int AS n FROM messages WHERE sender_id = ${uid} AND created_at > now() - interval '10 minutes'`;
    if (recent.n >= 20) { res.status(429).json({ error: 'Too many messages. Wait a few minutes and try again.' }); return; }

    const [row] = await sql`INSERT INTO messages (sender_id, recipient_id, beat_id, body) VALUES (${uid}, ${toId}, ${beatId}, ${body}) RETURNING id, created_at`;
    const sender = await userById(uid);
    await notifyByEmail(sender, recipient, body, beatTitle);
    res.status(200).json({ ok: true, with: toId, message: { id: row.id, mine: true, body, beatId, at: row.created_at } });
  } catch (err) {
    console.error('messages error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

module.exports = { handleMessages };
