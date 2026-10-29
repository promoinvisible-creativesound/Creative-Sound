// Voice tag for public previews (used by admin-review.js on Approve).
// Decodes the producer's preview, lays the "Creative Sound" tag over it at
// 1s and then every 35s (music ducked under the voice so it stays clear),
// and encodes the result to a 192 kbps stereo MP3 with lamejs.
// Headroom: the whole mix is lowered 1.5 dB and a look-ahead limiter keeps every peak under
// -2 dBFS, because MP3 coding adds up to about 1.5 dB of overshoot (more on drum-heavy
// material) that a browser would otherwise clip (distortion on loud masters).
// Only this tagged file is ever played in the store; buyers get clean files.
(() => {
  'use strict';
  const TAG_URL = 'assets/audio/voice-tag.wav?v=2';
  const LAME_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
  const FIRST = 1;       // seconds
  const EVERY = 35;      // seconds between tags
  const DUCK = 0.45;     // music level under the voice
  const TAG_GAIN = 1.15;
  const RATE = 44100;
  const HEADROOM = Math.pow(10, -1.5 / 20);   // whole mix, before the limiter
  const CEILING = Math.pow(10, -2 / 20);      // limiter ceiling (sample peak)
  const LOOKAHEAD = 0.005;                    // seconds: the gain starts falling this early
  const RELEASE = 0.08;                       // seconds: how fast it recovers

  // Look-ahead peak limiter, stereo linked, in place. The gain falls smoothly over LOOKAHEAD
  // before a peak (so nothing is hard-clipped) and recovers over about RELEASE. Returns the
  // largest reduction in dB. Nothing changes where the signal stays under the ceiling.
  const limit = (L, R, ceiling, rate) => {
    const n = L.length;
    const la = Math.max(1, Math.round(rate * LOOKAHEAD));
    const need = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const p = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      if (p > ceiling) { need[i] = ceiling / p; any = true; } else need[i] = 1;
    }
    if (!any) return 0;
    // 1. the lowest gain needed in the next la samples (sliding minimum, circular deque)
    const mn = new Float32Array(n);
    const cap = la + 2;
    const dq = new Int32Array(cap);
    let head = 0; let len = 0;
    for (let j = n - 1; j >= 0; j--) {
      while (len && need[dq[(head + len - 1) % cap]] >= need[j]) len--;
      dq[(head + len) % cap] = j; len++;
      while (dq[head] > j + la) { head = (head + 1) % cap; len--; }
      mn[j] = need[dq[head]];
    }
    // 2. average over the last la+1 samples: a linear ramp down that is complete at the peak
    let sum = la + 1; // as if the signal had been silent (gain 1) before the start
    for (let i = 0; i < n; i++) {
      sum -= i - la - 1 >= 0 ? mn[i - la - 1] : 1;
      sum += mn[i];
      need[i] = sum / (la + 1);
    }
    // 3. recover slowly, never above what step 2 allows
    const rel = 1 - Math.exp(-1 / (RELEASE * rate));
    let g = 1; let worst = 1;
    for (let i = 0; i < n; i++) {
      g = Math.min(need[i], g + (1 - g) * rel);
      if (g < worst) worst = g;
      L[i] *= g; R[i] *= g;
    }
    return -20 * Math.log10(worst);
  };

  let lame = null;
  const loadLame = () => lame || (lame = new Promise((resolve, reject) => {
    if (window.lamejs) { resolve(window.lamejs); return; }
    const s = document.createElement('script');
    s.src = LAME_URL;
    s.onload = () => (window.lamejs ? resolve(window.lamejs) : reject(new Error('MP3 encoder failed to load.')));
    s.onerror = () => reject(new Error('MP3 encoder failed to load.'));
    document.head.appendChild(s);
  }));

  const decode = async (buf) => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try { return await ctx.decodeAudioData(buf); } finally { ctx.close(); }
  };
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));

  const SAFE_PEAK = 0.97; // about -0.26 dBFS, measured on the decoded MP3

  // 192 kbps stereo MP3 from float channels (clamped, so nothing can wrap around).
  async function encodeMp3(L, R, onProgress) {
    const { Mp3Encoder } = await loadLame();
    const enc = new Mp3Encoder(2, RATE, 192);
    const toInt = (f) => { const s = Math.max(-1, Math.min(1, f)); return s < 0 ? s * 0x8000 : s * 0x7fff; };
    const BLOCK = 1152;
    const parts = [];
    const l16 = new Int16Array(BLOCK);
    const r16 = new Int16Array(BLOCK);
    onProgress('Encoding MP3…');
    for (let i = 0, n = 0; i < L.length; i += BLOCK, n++) {
      const end = Math.min(BLOCK, L.length - i);
      for (let k = 0; k < end; k++) { l16[k] = toInt(L[i + k]); r16[k] = toInt(R[i + k]); }
      const out = enc.encodeBuffer(l16.subarray(0, end), r16.subarray(0, end));
      if (out.length) parts.push(new Uint8Array(out));
      if (n % 400 === 0) { onProgress(`Encoding MP3… ${Math.round((i / L.length) * 100)}%`); await nextFrame(); }
    }
    const tail = enc.flush();
    if (tail.length) parts.push(new Uint8Array(tail));
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  // Highest sample of the decoded MP3 (at 44.1 kHz, as the player gets it). If decoding is not
  // possible here the check is skipped (0).
  async function decodedPeak(blob) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx({ sampleRate: RATE });
      try {
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        let peak = 0;
        for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; } }
        return peak;
      } finally { ctx.close(); }
    } catch (e) { return 0; }
  }

  // opts.producerTagUrl: the producer's own tag; it plays halfway between
  // the Creative Sound tags (1s, 36s, … ours; 18.5s, 53.5s, … theirs).
  async function tag(sourceUrl, onProgress = () => {}, opts = {}) {
    onProgress('Downloading the preview…');
    const [srcRes, tagRes, ptagRes] = await Promise.all([
      fetch(sourceUrl), fetch(TAG_URL),
      opts.producerTagUrl ? fetch(opts.producerTagUrl).catch(() => null) : Promise.resolve(null),
    ]);
    if (!srcRes.ok) throw new Error('Could not download the preview from Dropbox.');
    if (!tagRes.ok) throw new Error('Voice tag file missing.');
    const [music, voice, ptag] = await Promise.all([
      decode(await srcRes.arrayBuffer()), decode(await tagRes.arrayBuffer()),
      ptagRes && ptagRes.ok ? ptagRes.arrayBuffer().then(decode).catch(() => null) : Promise.resolve(null),
    ]);

    onProgress('Mixing the voice tag…');
    const length = Math.ceil(music.duration * RATE);
    const off = new OfflineAudioContext(2, length, RATE);
    const m = off.createBufferSource();
    m.buffer = music;
    const duck = off.createGain();
    const master = off.createGain();
    master.gain.value = HEADROOM;
    master.connect(off.destination);
    m.connect(duck).connect(master);
    const marks = [];
    for (let t = FIRST; t + voice.duration < music.duration; t += EVERY) marks.push({ t, buf: voice });
    if (ptag && ptag.duration <= 10) {
      for (let t = FIRST + EVERY / 2; t + ptag.duration < music.duration; t += EVERY) marks.push({ t, buf: ptag });
      marks.sort((a, b) => a.t - b.t);
    }
    duck.gain.setValueAtTime(1, 0);
    marks.forEach(({ t, buf }) => {
      duck.gain.setValueAtTime(1, Math.max(0, t - 0.15));
      duck.gain.linearRampToValueAtTime(DUCK, t);
      duck.gain.setValueAtTime(DUCK, t + buf.duration);
      duck.gain.linearRampToValueAtTime(1, t + buf.duration + 0.25);
      const v = off.createBufferSource();
      v.buffer = buf;
      const g = off.createGain();
      g.gain.value = TAG_GAIN;
      v.connect(g).connect(master);
      v.start(t);
    });
    m.start(0);
    const mixed = await off.startRendering();

    const L = mixed.getChannelData(0);
    const R = mixed.getChannelData(1);
    onProgress('Limiting peaks…');
    await nextFrame();
    limit(L, R, CEILING, RATE);

    // Encode, then listen to what comes out: decode the MP3 the way a browser will and look at
    // its peaks. MP3 coding can overshoot more than usual (distorted or drum-heavy material);
    // if a peak would pass SAFE_PEAK the mix is turned down a little and encoded again.
    let blob = await encodeMp3(L, R, onProgress);
    for (let pass = 0; pass < 6; pass++) {
      onProgress('Checking the peaks…');
      const peak = await decodedPeak(blob);
      if (!(peak > SAFE_PEAK)) break;
      // A decoder may report overs as exactly 1.0 (clipped): then the real overshoot is unknown, so step down 1 dB at a time.
      const g = peak >= 0.999 ? 0.89 : (SAFE_PEAK * 0.985) / peak;
      for (let i = 0; i < L.length; i++) { L[i] *= g; R[i] *= g; }
      onProgress('Encoding MP3 again…');
      blob = await encodeMp3(L, R, onProgress);
    }
    return blob;
  }

  window.CSVoiceTag = { tag, limit, CEILING, HEADROOM };
})();
