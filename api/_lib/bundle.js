// Cart bundle discount: more tracks in one order, a lower price on each.
// The same table is in js/beats.js (cart display); the server is what charges.
const TIERS = [{ min: 5, pct: 15 }, { min: 3, pct: 10 }];

const bundlePct = (n) => { const t = TIERS.find((x) => n >= x.min); return t ? t.pct : 0; };
const discounted = (cents, pct) => Math.round(cents * (100 - pct) / 100);

module.exports = { TIERS, bundlePct, discounted };
