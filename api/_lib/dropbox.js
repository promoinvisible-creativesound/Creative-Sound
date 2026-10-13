// Producer uploads go straight from the browser into the site owner's
// Dropbox: the server asks Dropbox for a one-off upload link for one exact
// path (files/get_temporary_upload_link), so the files never pass through a
// Vercel function (4.5 MB body limit) and no Dropbox token reaches the
// browser. Dropbox caps a single upload through such a link at 150 MB.
//
// Env: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN (an
// offline refresh token for an app with files.content.write and
// files.metadata.read). Paths are relative to the app's folder when the
// app uses "App folder" access.

const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;

// DROPBOX_APP_SECRET is optional: a refresh token made with PKCE
// (dropbox-connect.html) is refreshed with the app key alone.
function configured() {
  return !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_REFRESH_TOKEN);
}

// Values pasted into Vercel sometimes keep quotes, spaces or line breaks.
const clean = (v) => String(v || '').trim().replace(/^['"]+|['",]+$/g, '').trim();

let cached = { token: null, expires: 0 };
async function refresh(withSecret) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: clean(process.env.DROPBOX_REFRESH_TOKEN),
    client_id: clean(process.env.DROPBOX_APP_KEY),
  });
  if (withSecret) body.set('client_secret', clean(process.env.DROPBOX_APP_SECRET));
  const res = await fetch('https://api.dropboxapi.com/oauth2/token', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}
async function accessToken() {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  let { res, data } = await refresh(!!process.env.DROPBOX_APP_SECRET);
  // A PKCE token must be refreshed without the secret: retry once without it.
  if (!res.ok && process.env.DROPBOX_APP_SECRET && /invalid_client/.test(JSON.stringify(data))) ({ res, data } = await refresh(false));
  if (!res.ok || !data.access_token) throw new Error(`Dropbox token error: ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cached.token;
}

async function rpc(endpoint, args) {
  const res = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Dropbox ${endpoint} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// One-off link the browser POSTs the raw file to (valid for 1 hour).
// "overwrite" so replacing a file in the form keeps a single copy.
async function uploadLink(path) {
  const data = await rpc('files/get_temporary_upload_link', {
    commit_info: { path, mode: 'overwrite', autorename: false, mute: true },
    duration: 3600,
  });
  return data.link;
}

// Size of the file at path, or null if it isn't there.
async function fileSize(path) {
  try {
    const meta = await rpc('files/get_metadata', { path });
    return meta['.tag'] === 'file' ? meta.size : null;
  } catch (err) {
    if (err.status === 409) return null;
    throw err;
  }
}

// Short-lived (4 h) direct link to read a file, for the review panel.
async function readLink(path) {
  const data = await rpc('files/get_temporary_link', { path });
  return data.link;
}

// Bytes [start, end] (inclusive) of a file, for reading headers and the
// ZIP directory without downloading whole uploads.
async function readRange(path, start, end) {
  const res = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
      Range: `bytes=${start}-${end}`,
    },
  });
  if (!res.ok && res.status !== 206) throw new Error(`Dropbox download ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// Upload sessions for files over the 150 MB link limit: the browser sends
// 4 MB pieces to our function, which forwards them here.
async function content(endpoint, arg, body) {
  const res = await fetch(`https://content.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Dropbox-API-Arg': JSON.stringify(arg),
      'Content-Type': 'application/octet-stream',
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Dropbox ${endpoint} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  try { return JSON.parse(text); } catch (e) { return {}; }
}
const sessionStart = async (chunk) => (await content('files/upload_session/start', { close: false }, chunk)).session_id;
const sessionAppend = (id, offset, chunk) => content('files/upload_session/append_v2', { cursor: { session_id: id, offset }, close: false }, chunk);
const sessionFinish = (id, offset, chunk, path) => content('files/upload_session/finish', {
  cursor: { session_id: id, offset },
  commit: { path, mode: 'overwrite', autorename: false, mute: true },
}, chunk);

// Health check for the admin: token refresh, read (list the app folder)
// and write (a one-off upload link; nothing is uploaded).
async function check() {
  await rpc('files/list_folder', { path: '', limit: 1 });
  await uploadLink('/.healthcheck.txt');
  return true;
}

module.exports = {
  check,
  MAX_UPLOAD_BYTES, configured, uploadLink, fileSize, readLink, readRange,
  sessionStart, sessionAppend, sessionFinish,
};
