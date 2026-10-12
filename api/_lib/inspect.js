// Reads what's inside uploaded files for the review panel, fetching only
// the bytes needed: a WAV's format header, or a ZIP's central directory.
// Works on any reader(start, end) -> Buffer, so it can be tested offline.

// WAV: format chunk (bit depth, sample rate, channels) and duration.
async function wavInfo(read, size) {
  const head = await read(0, Math.min(size, 65536) - 1);
  if (head.toString('ascii', 0, 4) !== 'RIFF' || head.toString('ascii', 8, 12) !== 'WAVE') return { ok: false, error: 'Not a valid WAV file.' };
  let off = 12;
  let fmt = null;
  let dataSize = null;
  while (off + 8 <= head.length) {
    const id = head.toString('ascii', off, off + 4);
    const len = head.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 24 <= head.length) {
      fmt = {
        format: head.readUInt16LE(off + 8),
        channels: head.readUInt16LE(off + 10),
        sampleRate: head.readUInt32LE(off + 12),
        byteRate: head.readUInt32LE(off + 16),
        bits: head.readUInt16LE(off + 22),
      };
    }
    if (id === 'data') { dataSize = len; break; }
    off += 8 + len + (len % 2);
  }
  if (!fmt) return { ok: false, error: 'No format header found.' };
  const bytes = dataSize != null && dataSize > 0 && dataSize !== 0xffffffff ? dataSize : size - off - 8;
  return {
    ok: true,
    bits: fmt.bits,
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    float: fmt.format === 3,
    duration: fmt.byteRate ? Math.round(bytes / fmt.byteRate) : null,
  };
}

// ZIP: list of entries from the central directory (ZIP64 aware).
const MAX_DIR = 4 * 1024 * 1024;
async function zipInfo(read, size, limit = 400) {
  const tailLen = Math.min(size, 65557);
  const tail = await read(size - tailLen, size - 1);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, error: 'Not a ZIP file, or it is damaged.' };
  let total = tail.readUInt16LE(eocd + 10);
  let dirSize = tail.readUInt32LE(eocd + 12);
  let dirOffset = tail.readUInt32LE(eocd + 16);
  if (dirOffset === 0xffffffff || dirSize === 0xffffffff || total === 0xffff) {
    const loc = eocd - 20;
    if (loc < 0 || tail.readUInt32LE(loc) !== 0x07064b50) return { ok: false, error: 'Unsupported ZIP64 layout.' };
    const recOffset = Number(tail.readBigUInt64LE(loc + 8));
    const rec = await read(recOffset, recOffset + 55);
    if (rec.readUInt32LE(0) !== 0x06064b50) return { ok: false, error: 'Unsupported ZIP64 layout.' };
    total = Number(rec.readBigUInt64LE(32));
    dirSize = Number(rec.readBigUInt64LE(40));
    dirOffset = Number(rec.readBigUInt64LE(48));
  }
  const dir = await read(dirOffset, dirOffset + Math.min(dirSize, MAX_DIR) - 1);
  const entries = [];
  let p = 0;
  let files = 0;
  while (p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50) {
    const nameLen = dir.readUInt16LE(p + 28);
    const extraLen = dir.readUInt16LE(p + 30);
    const commentLen = dir.readUInt16LE(p + 32);
    const flags = dir.readUInt16LE(p + 8);
    const name = dir.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    let usize = dir.readUInt32LE(p + 24);
    if (usize === 0xffffffff) {
      // ZIP64 extra field: original size comes first.
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = dir.readUInt16LE(e);
        const len = dir.readUInt16LE(e + 2);
        if (id === 0x0001 && len >= 8) { usize = Number(dir.readBigUInt64LE(e + 4)); break; }
        e += 4 + len;
      }
    }
    const isDir = name.endsWith('/');
    const hidden = /(^|\/)(__MACOSX|\.DS_Store)/.test(name);
    if (!isDir && !hidden) {
      files++;
      if (entries.length < limit) entries.push({ name, size: usize });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  const audio = entries.filter((e) => /\.(wav|aiff?|mp3|flac)$/i.test(e.name)).length;
  return { ok: true, files, audio, entries, truncated: files > entries.length || dirSize > MAX_DIR, declared: total };
}

// MP3: first frame header (bitrate, sample rate, channels) and duration,
// using the Xing/Info header for VBR files.
const BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
async function mp3Info(read, size) {
  const buf = await read(0, Math.min(size, 262144) - 1);
  let p = 0;
  if (buf.toString('ascii', 0, 3) === 'ID3') {
    p = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  }
  const audioStart = p;
  for (; p + 4 <= buf.length; p++) {
    if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) continue;
    const ver = (buf[p + 1] >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (buf[p + 1] >> 1) & 3; // 1 = Layer III
    const bri = buf[p + 2] >> 4;
    const sri = (buf[p + 2] >> 2) & 3;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) continue;
    const mono = (buf[p + 3] >> 6) === 3;
    const sampleRate = SR[ver][sri];
    const frameKbps = (ver === 3 ? BR_V1 : BR_V2)[bri];
    const spf = ver === 3 ? 1152 : 576;
    const xo = p + 4 + (ver === 3 ? (mono ? 17 : 32) : (mono ? 9 : 17));
    let duration = null;
    let kbps = frameKbps;
    let vbr = false;
    const tag = buf.toString('ascii', xo, xo + 4);
    if ((tag === 'Xing' || tag === 'Info') && xo + 12 <= buf.length && (buf.readUInt32BE(xo + 4) & 1)) {
      const frames = buf.readUInt32BE(xo + 8);
      duration = (frames * spf) / sampleRate;
      vbr = tag === 'Xing';
      if (vbr && duration) kbps = Math.round(((size - audioStart) * 8) / duration / 1000);
    }
    if (duration == null) duration = ((size - audioStart) * 8) / (frameKbps * 1000);
    return { ok: true, kbps, vbr, sampleRate, channels: mono ? 1 : 2, duration: Math.round(duration) };
  }
  return { ok: false, error: 'Not a valid MP3 file.' };
}

// BeatStars' audio rules (help.beatstars.com, "What Type Of Audio Files Can
// I Upload?"): 1-600 s, 44.1-48 kHz, stereo; WAV 16-32 bit; MP3 >= 320 kbps.
const RULES = { minSec: 1, maxSec: 600, minRate: 44100, maxRate: 48000, minChannels: 2, minWavBits: 16, maxWavBits: 32, minMp3Kbps: 320 };
function audioProblems(kind, info) {
  if (!info.ok) return [info.error];
  const out = [];
  if (info.duration != null && (info.duration < RULES.minSec || info.duration > RULES.maxSec)) out.push(`length must be between 1 second and 10 minutes (it is ${Math.floor(info.duration / 60)}:${String(info.duration % 60).padStart(2, '0')})`);
  if (info.sampleRate < RULES.minRate || info.sampleRate > RULES.maxRate) out.push(`sample rate must be 44.1 or 48 kHz (it is ${(info.sampleRate / 1000).toFixed(1)} kHz)`);
  if (info.channels < RULES.minChannels) out.push('must be stereo');
  if (kind === 'wav' && (info.bits < RULES.minWavBits || info.bits > RULES.maxWavBits)) out.push(`must be 16 to 32-bit (it is ${info.bits}-bit)`);
  if (kind === 'mp3' && info.kbps < RULES.minMp3Kbps) out.push(`must be at least 320 kbps (it is ${info.kbps} kbps)`);
  return out;
}

module.exports = { wavInfo, zipInfo, mp3Info, audioProblems, RULES };
