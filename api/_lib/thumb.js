// Small cover for the store (cards, player, Top tracks): the producer's
// artwork scaled to at most 640 px and saved as a JPEG next to it in
// Dropbox, made once on first request. Covers are often 2-4 MB; this keeps
// them around 40-70 KB so phones load the store quickly.
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const { sql } = require('./db');
const dropbox = require('./dropbox');

const MAX = 640;
// Bump when MAX or the quality change: thumbs made with the old settings are redone.
const THUMB_VERSION = 2;

function decode(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  return jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 768, formatAsRGBA: true });
}

// Area-average downscale (sharp enough for a big ratio, no aliasing).
function resize(img, max) {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  if (scale === 1) return img;
  const out = Buffer.alloc(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(img.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// Two sizes: "sm" (up to 640 px, track page and big spots) and "xs" (up to
// 440 px, cards, lists, player and cart: about 25-35 KB each).
const SIZES = {
  sm: { max: MAX, quality: 76, key: 'thumb', file: 'cover-sm.jpg' },
  xs: { max: 440, quality: 74, key: 'thumbXs', file: 'cover-xs.jpg' },
};

// files: the submission's files; returns { path, size } of the thumb in
// Dropbox, or null when it cannot be made.
async function ensureThumb(submissionId, files, size = 'sm') {
  const spec = SIZES[size] || SIZES.sm;
  const art = files && files.artwork;
  if (!art || !dropbox.configured()) return null;
  const src = `${art.path}:${art.size || ''}:v${THUMB_VERSION}`;
  const have = files[spec.key];
  if (have && have.src === src) return { path: have.path, size: have.size };
  if (art.size && art.size > 20 * 1024 * 1024) return null;
  const buf = await dropbox.readRange(art.path, 0, (art.size || 20 * 1024 * 1024) - 1);
  const small = resize(decode(buf), spec.max);
  const jpg = Buffer.from(jpeg.encode({ width: small.width, height: small.height, data: small.data }, spec.quality).data);
  const path = `/submissions/${submissionId}/${spec.file}`;
  await dropbox.uploadFile(path, jpg);
  const thumb = { path, size: jpg.length, src };
  await sql`UPDATE beat_submissions SET files = jsonb_set(files, ${`{${spec.key}}`}::text[], ${JSON.stringify(thumb)}::jsonb) WHERE id = ${submissionId}`;
  return { path, size: jpg.length };
}

module.exports = { ensureThumb };
