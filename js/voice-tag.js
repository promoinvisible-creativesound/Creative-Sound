// Voice tag for public previews (used by admin-review.js on Approve).
// Decodes the producer's preview, lays the "Creative Sound" tag over it at
// 1s and then every 30s (music ducked under the voice so it stays clear),
// and encodes the result to a 192 kbps stereo MP3 with lamejs.
// Only this tagged file is ever played in the store; buyers get clean files.
(() => {
  'use strict';
  const TAG_URL = 'assets/audio/voice-tag.wav?v=2';
  const LAME_URL = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
  const FIRST = 1;       // seconds
  const EVERY = 30;      // seconds between tags
  const DUCK = 0.45;     // music level under the voice
  const TAG_GAIN = 1.15;
  const RATE = 44100;

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

  async function tag(sourceUrl, onProgress = () => {}) {
    onProgress('Downloading the preview…');
    const [srcRes, tagRes] = await Promise.all([fetch(sourceUrl), fetch(TAG_URL)]);
    if (!srcRes.ok) throw new Error('Could not download the preview from Dropbox.');
    if (!tagRes.ok) throw new Error('Voice tag file missing.');
    const [music, voice] = await Promise.all([decode(await srcRes.arrayBuffer()), decode(await tagRes.arrayBuffer())]);

    onProgress('Mixing the voice tag…');
    const length = Math.ceil(music.duration * RATE);
    const off = new OfflineAudioContext(2, length, RATE);
    const m = off.createBufferSource();
    m.buffer = music;
    const duck = off.createGain();
    m.connect(duck).connect(off.destination);
    const times = [];
    for (let t = FIRST; t + voice.duration < music.duration; t += EVERY) times.push(t);
    duck.gain.setValueAtTime(1, 0);
    times.forEach((t) => {
      duck.gain.setValueAtTime(1, Math.max(0, t - 0.15));
      duck.gain.linearRampToValueAtTime(DUCK, t);
      duck.gain.setValueAtTime(DUCK, t + voice.duration);
      duck.gain.linearRampToValueAtTime(1, t + voice.duration + 0.25);
      const v = off.createBufferSource();
      v.buffer = voice;
      const g = off.createGain();
      g.gain.value = TAG_GAIN;
      v.connect(g).connect(off.destination);
      v.start(t);
    });
    m.start(0);
    const mixed = await off.startRendering();

    onProgress('Encoding MP3…');
    const { Mp3Encoder } = await loadLame();
    const enc = new Mp3Encoder(2, RATE, 192);
    const L = mixed.getChannelData(0);
    const R = mixed.getChannelData(1);
    const toInt = (f) => { const s = Math.max(-1, Math.min(1, f)); return s < 0 ? s * 0x8000 : s * 0x7fff; };
    const BLOCK = 1152;
    const parts = [];
    const l16 = new Int16Array(BLOCK);
    const r16 = new Int16Array(BLOCK);
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

  window.CSVoiceTag = { tag };
})();
