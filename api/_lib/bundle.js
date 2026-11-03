// Cart discounts: bundle (more tracks in one order), the team's general sale and a discount code.
// They multiply, capped at MAX_OFF percent in total, and lower the price on every line.
// The same table and formula are in js/beats.js (cart display); the server is what charges.
const TIERS = [{ min: 5, pct: 15 }, { min: 3, pct: 10 }];
const MAX_OFF = 70;

const bundlePct = (n) => { const t = TIERS.find((x) => n >= x.min); return t ? t.pct : 0; };
const discounted = (cents, pct) => Math.max(50, Math.round(cents * (100 - pct) / 100));
// Several percents -> one total percent off.
const combine = (...pcts) => Math.min(MAX_OFF, Math.round(100 - pcts.reduce((k, p) => k * (100 - (p || 0)) / 100, 100)));

module.exports = { TIERS, MAX_OFF, bundlePct, discounted, combine };
