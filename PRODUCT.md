# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: electronic music producers and sound designers looking for character and creative distortion, not transparent processing. They often arrive from social media (Instagram, TikTok, YouTube) and decide within seconds, mostly by hearing the plugin and seeing the GUI.

Secondary: Serum users downloading the free preset packs, who may later discover the plugin.

## Product Purpose

The site sells Creative Sound's products. For the coming months its main job is converting visitors on **Creative Dist 2.0** (€25 one-time, shown as €50 → €25; the €50 was the real price in the prior 30 days, confirmed by the owner) and its free demo. Free preset packs, tutorials and support exist around that. Success means a visitor hears the plugin, understands what it does differently, and buys or downloads the demo.

## Positioning

Creative Sound is a one-person studio ("Sound tools by Invisible": one person handling design, DSP and code) building plugins that add character on purpose instead of getting out of the way.

Creative Dist 2.0 is a modular distortion engine with **4 assignable, reorderable slots**: Saturation (18 modes), Noise (procedural, transient-triggered 1-Shot), Bode Shifter (frequency shifting with Key Follow) and Flux (new in 2.0: morphs continuously between two of nine algorithms). Plus an always-present Equalizer (Low Cut, 3 bells, High Cut = 5 bands; Pre/Post, Linear Phase, oversampling) and an Output stage with Auto Gain. The claim is "reorder, reshape and break the signal on your own terms", not "another warm saturator".

## Operating Context

- Formats: VST3 + AU on macOS, VST3 on Windows 11+. Mac builds are not Apple-notarized; the FAQ has a one-command fix.
- Purchase: Stripe Payment Link; license key delivered by email (Resend webhook) and in the account area. License keys always use the long signed format. One license = up to 3 devices.
- Demo and full version are the same binary: without a license key it runs as a demo (30 min per session, no free updates). Public download links are therefore intentional.
- Free preset packs are delivered through €0 Stripe checkouts.
- Account area: signup/login, orders, license, settings, support tickets.
- Static HTML/CSS/JS pages deployed on Vercel from `main`, serverless functions in `api/` (Neon Postgres, Stripe, Resend). No front-end framework.

## Capabilities and Constraints

- Live products: Creative Dist 2.0; free Serum packs "Creative Presets" (150 presets + 70 VIP guest presets) and "Creative Presets Vol. 2" (82 presets).
- Sample packs and further plugins are "Coming soon"; nothing else announced.
- Undecided: future plugin names, release dates, pricing.

## Brand Commitments

- Name: Creative Sound, tagline "Sound tools by Invisible". Logo: `assets/img/logo.svg`.
- **Binding:** the site and the plugin must feel like one object. The site's look is lifted from the Creative Dist GUI (obsidian black, amber neon, Orbitron display type). It can be refined, never replaced by an unrelated visual world.
- Voice: direct, a bit irreverent, confident; English copy.
- Legal: P.IVA 17024071007 in the footer; privacy and refund policy pages exist.

## Evidence on Hand

- Artists section on the home page: 8 named producers with roles/labels and Instagram links (`assets/img/artists/`). Community videos section.
- VIP preset contributors named on the pack pages.
- Real GUI captures per module: `assets/img/module-*.png`, `assets/img/gui-*`.
- **Absent, must not be fabricated:** written testimonials/quotes, ratings, press, sales numbers.

## Product Principles

1. Let people hear and see it first: audio, video and the real GUI beat adjectives.
2. One object: site and plugin share the same identity; the site is the plugin's showroom.
3. Character over neutrality: copy and design should feel opinionated, like the product.
4. Honest small-studio scale: real artists only, no invented social proof.
5. Fast path to buy or try: price, demo and Buy are never far away.
