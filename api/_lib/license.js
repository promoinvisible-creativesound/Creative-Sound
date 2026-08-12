// Ed25519 license-key signing for Creative Dist.
//
// Mirrors licensing/generate_license.py in the plugin repo (see there for
// the offline-verification rationale) so keys minted here actually validate
// in Source/DSP/LicenseVerifier.cpp: Base32( [10 random bytes license_id] +
// [64-byte Ed25519 signature over license_id] ), grouped in 6-char blocks
// behind a "CDIST-" prefix. The previous version of this file generated a
// plain random string with no signature at all — it looked like a license
// key but the plugin always rejected it.
const crypto = require('crypto');

// Public half of the keypair — safe to embed (it can only verify, never
// sign). Must match the `publicKey` array in Source/DSP/LicenseVerifier.h.
const PUBLIC_KEY_HEX = '9ab7682d6ff7ca962a57e1da26d6eb6107ab37a3e4c0b5fb2010882c929ccc7b';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function loadPrivateKey() {
  const seedHex = process.env.CREATIVEDIST_PRIVATE_KEY;
  if (!seedHex) {
    throw new Error('CREATIVEDIST_PRIVATE_KEY is not set — cannot sign license keys.');
  }
  // Node's Ed25519 JWK import wants both halves of the keypair; only `d`
  // (the private seed) is secret, `x` is the same public key above.
  const jwk = {
    kty: 'OKP',
    crv: 'Ed25519',
    d: Buffer.from(seedHex.trim(), 'hex').toString('base64url'),
    x: Buffer.from(PUBLIC_KEY_HEX, 'hex').toString('base64url'),
  };
  return crypto.createPrivateKey({ key: jwk, format: 'jwk' });
}

function generateLicenseKey() {
  const licenseId = crypto.randomBytes(10);
  const signature = crypto.sign(null, licenseId, loadPrivateKey());
  const raw = base32Encode(Buffer.concat([licenseId, signature]));
  const groups = [];
  for (let i = 0; i < raw.length; i += 6) groups.push(raw.slice(i, i + 6));
  return `CDIST-${groups.join('-')}`;
}

module.exports = { generateLicenseKey };
