// Accent colour of a cover image (JPG or PNG), computed on the server for
// tracks that don't have one yet (e.g. uploaded before the upload page
// picked it). Same idea as js/upload.js: the most common vivid colour,
// dark / near-white / grey pixels skipped, nudged to read well on black.
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

function decode(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  return jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512, formatAsRGBA: true });
}

function accentFromImage(buf) {
  const { width, height, data } = decode(buf);
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000))); // ~4000 samples
  const buckets = new Map();
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      const l = (max + min) / 510;
      const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
      if (l < 0.12 || l > 0.92 || s < 0.25) continue;
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      const k = buckets.get(key) || { w: 0, r: 0, g: 0, b: 0 };
      const w = 0.5 + s;
      k.w += w; k.r += r * w; k.g += g * w; k.b += b * w;
      buckets.set(key, k);
    }
  }
  let best = null;
  buckets.forEach((k) => { if (!best || k.w > best.w) best = k; });
  if (!best) return null;
  let r = best.r / best.w / 255; let g = best.g / best.w / 255; let b = best.b / best.w / 255;
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  const sat = 0.68; const lig = 0.58;
  const C = (1 - Math.abs(2 * lig - 1)) * sat; const X = C * (1 - Math.abs(((h / 60) % 2) - 1)); const m = lig - C / 2;
  [r, g, b] = h < 60 ? [C, X, 0] : h < 120 ? [X, C, 0] : h < 180 ? [0, C, X] : h < 240 ? [0, X, C] : h < 300 ? [X, 0, C] : [C, 0, X];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

module.exports = { accentFromImage };
