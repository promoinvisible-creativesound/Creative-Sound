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

function configured() {
  return !!(process.env.DROPBOX_APP_KEY && process.env.DROPBOX_APP_SECRET && process.env.DROPBOX_REFRESH_TOKEN);
}

let cached = { token: null, expires: 0 };
async function accessToken() {
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.DROPBOX_REFRESH_TOKEN,
    client_id: process.env.DROPBOX_APP_KEY,
    client_secret: process.env.DROPBOX_APP_SECRET,
  });
  const res = await fetch('https://api.dropbox.com/oauth2/token', { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
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

module.exports = { MAX_UPLOAD_BYTES, configured, uploadLink, fileSize, readLink };
