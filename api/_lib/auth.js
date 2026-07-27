const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'cd_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: MAX_AGE_SECONDS });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

function setSessionCookie(res, token) {
  const secure = process.env.VERCEL_ENV ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = process.env.VERCEL_ENV ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secure}`);
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  return verifyToken(token);
}

module.exports = {
  COOKIE_NAME,
  signToken,
  verifyToken,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  getSession,
};
