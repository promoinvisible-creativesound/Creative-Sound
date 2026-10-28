// Track Store ranking, in the browser (the catalogue is small, so no server cost).
//
// 1. order(beats): "Discover", a fair shuffle. Every track gets a random draw
//    weighted by how little exposure it has had and how new it is, with only a
//    small nudge (20%) for what visitors actually like. Producers are
//    interleaved so nobody shows twice in a row. The shuffle is fixed for the
//    visit (seed in sessionStorage) and changes on the next one.
// 2. forYou(beats): tracks close to the visitor's taste profile. The profile is
//    a few small tables (genre, mood, tags, tempo, key) fed by plays, saves and
//    cart adds, fading with a 30 day half-life. It lives in localStorage and,
//    for a signed-in visitor, on the account (via /api/beats/saved).
(() => {
  'use strict';
  const KEY = 'cs-taste';
  const HALF_LIFE = 30 * 864e5;
  const QUALITY = 0.2; // share of the weight that comes from engagement
  const EVENT_WEIGHT = { view: 0.5, play: 1, save: 4, cart: 6 };
  const DIMS = ['g', 'm', 't', 'b', 'k'];

  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

  /* --------------------------------- random --------------------------------- */
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const visitSeed = () => {
    try {
      let s = sessionStorage.getItem('cs-seed');
      if (!s) { s = String((Math.random() * 4294967296) >>> 0); sessionStorage.setItem('cs-seed', s); }
      return Number(s);
    } catch (e) { return 1; }
  };

  /* ---------------------------------- fair ---------------------------------- */
  // sig = [views, plays, saves, carts] over 30 days (producer tracks; none for the static ones).
  const sigOf = (b) => (Array.isArray(b.sig) ? b.sig : [0, 0, 0, 0]);
  const rateOf = (b) => { const [v, p, s, c] = sigOf(b); return (p + 3 * s + 5 * c + 2) / (v + p + 20); };
  const ageDays = (b) => { const t = new Date(b.released).getTime(); return isFinite(t) ? (Date.now() - t) / 864e5 : 365; };
  const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 1; };

  function weights(beats) {
    const med = median(beats.map(rateOf)) || 1;
    const out = new Map();
    beats.forEach((b) => {
      const [v, p] = sigOf(b);
      const age = ageDays(b);
      // Less exposure -> more weight; new uploads get an extra lift.
      const boost = 1 + 1.5 * Math.exp(-(v + p) / 30) + (age <= 14 ? 0.5 : age <= 45 ? 0.2 : 0);
      const qn = Math.max(0.5, Math.min(2, rateOf(b) / med));
      out.set(b.id, boost * ((1 - QUALITY) + QUALITY * qn));
    });
    return out;
  }

  // Each track draws u^(1/w) (a weighted random key, highest first). Producers
  // then take turns: first one track from every producer, then a second from
  // each, and so on, so a producer with fifty tracks does not crowd out one with
  // two. Inside a round the keys decide who comes first, which favours new and
  // little-seen tracks. Finally no producer shows twice within three places when
  // another one is available.
  function order(beats, seed = visitSeed()) {
    const w = weights(beats);
    const who = (b) => b.producerHandle || b.producer || b.id;
    const keyed = beats.map((b) => ({ b, k: Math.log(Math.max(1e-9, rng(seed ^ hash(b.id))())) / w.get(b.id) }));
    keyed.sort((x, y) => y.k - x.k);
    const byProducer = new Map();
    keyed.forEach((x) => { const p = who(x.b); if (!byProducer.has(p)) byProducer.set(p, []); byProducer.get(p).push(x); });
    const left = [];
    for (let round = 0; ; round++) {
      const turn = [...byProducer.entries()].map(([p, l]) => l[round] && { x: l[round], k: Math.log(Math.max(1e-9, rng(seed ^ hash(`${p}#${round}`))())) / w.get(l[round].b.id) }).filter(Boolean);
      if (!turn.length) break;
      // Order the producers with a draw of their own, so having many tracks does not win the first place.
      turn.sort((a, b) => b.k - a.k).forEach((t) => left.push(t.x.b));
    }
    const out = [];
    while (left.length) {
      const recent = out.slice(-2).map(who);
      let i = left.findIndex((b, n) => n < 15 && !recent.includes(who(b)));
      if (i < 0) i = 0;
      out.push(left.splice(i, 1)[0]);
    }
    return out;
  }

  /* --------------------------------- profile -------------------------------- */
  const empty = () => ({ v: 1, at: Date.now(), n: 0, w: { g: {}, m: {}, t: {}, b: {}, k: {} } });
  let profile = (() => {
    const p = read(KEY, null);
    return p && p.v === 1 && p.w ? p : empty();
  })();
  const listeners = [];
  const save = () => { write(KEY, profile); listeners.forEach((fn) => { try { fn(profile); } catch (e) { /* ignore */ } }); };

  const bucket = (bpm) => String(Math.round((Number(bpm) || 0) / 10) * 10);
  const add = (dim, name, amount) => { if (name) profile.w[dim][name] = (profile.w[dim][name] || 0) + amount; };
  const prune = () => {
    DIMS.forEach((d) => {
      const e = Object.entries(profile.w[d]).filter(([, v]) => v >= 0.05).sort((a, b) => b[1] - a[1]).slice(0, 24);
      profile.w[d] = Object.fromEntries(e.map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
    });
  };

  function record(beat, kind) {
    const amount = EVENT_WEIGHT[kind];
    if (!beat || !amount) return;
    const now = Date.now();
    const f = Math.pow(0.5, Math.max(0, now - profile.at) / HALF_LIFE);
    DIMS.forEach((d) => { Object.keys(profile.w[d]).forEach((k) => { profile.w[d][k] *= f; }); });
    profile.n = profile.n * f + amount;
    profile.at = now;
    add('g', beat.genre, amount);
    add('m', beat.mood, amount);
    (beat.tags || []).slice(0, 6).forEach((t) => add('t', t, amount / 2));
    const b = Number(bucket(beat.bpm));
    if (b) { add('b', String(b), amount); add('b', String(b - 10), amount / 2); add('b', String(b + 10), amount / 2); }
    add('k', String(beat.key || '').split(/\s+/)[0], amount * 0.6);
    prune();
    save();
  }

  const maxOf = (m) => Math.max(0.0001, ...Object.values(m));
  function score(b) {
    const w = profile.w;
    const mg = maxOf(w.g); const mm = maxOf(w.m); const mt = maxOf(w.t); const mb = maxOf(w.b); const mk = maxOf(w.k);
    const tags = b.tags || [];
    const t = tags.length ? tags.reduce((s, x) => s + (w.t[x] || 0), 0) / tags.length / mt : 0;
    return (3 * (w.g[b.genre] || 0) / mg + 2 * (w.m[b.mood] || 0) / mm + 1.5 * t + (w.b[bucket(b.bpm)] || 0) / mb
      + 0.5 * (w.k[String(b.key || '').split(/\s+/)[0]] || 0) / mk) / 8;
  }

  const hasProfile = () => profile.n >= 3;

  // The closest tracks to the profile: a little jitter so the row is not frozen,
  // at most two per producer and four per genre so it stays varied.
  function forYou(beats, { exclude = new Set(), n = 8, seed = visitSeed() } = {}) {
    if (!hasProfile()) return [];
    const scored = beats.filter((b) => !exclude.has(b.id)).map((b) => ({ b, s: score(b) * (0.85 + 0.3 * rng(seed ^ hash('fy' + b.id))()) }))
      .filter((x) => x.s >= 0.22).sort((x, y) => y.s - x.s);
    const per = new Map(); const gen = new Map(); const out = [];
    for (const { b } of scored) {
      const p = b.producerHandle || b.producer;
      if ((per.get(p) || 0) >= 2 || (gen.get(b.genre) || 0) >= 4) continue;
      per.set(p, (per.get(p) || 0) + 1); gen.set(b.genre, (gen.get(b.genre) || 0) + 1);
      out.push(b);
      if (out.length >= n) break;
    }
    return out.length >= 3 ? out : [];
  }

  /* ---------------------------------- sync ---------------------------------- */
  const valid = (p) => p && p.v === 1 && p.w && DIMS.every((d) => p.w[d] && typeof p.w[d] === 'object') && Number.isFinite(p.at);
  // Newer profile wins; returns true when the browser's copy is the one to upload.
  function adopt(remote) {
    if (valid(remote) && remote.at > profile.at) { profile = remote; write(KEY, profile); listeners.forEach((fn) => fn(profile)); return false; }
    return profile.n > 0 && (!valid(remote) || remote.at < profile.at);
  }

  window.CSTaste = {
    order, forYou, record, score, hasProfile, adopt,
    snapshot: () => profile,
    onChange: (fn) => listeners.push(fn),
  };
})();
