# Upstream issue draft — OpenFrontIO

(postar em https://github.com/openfrontio/OpenFrontIO/issues/new?label= — aguardar
label `approved` antes de abrir PR, per CONTRIBUTING.md)

---

**Title:** Official Android app — WebView shell approach (proof of concept)

**Body:**

Hi! I'd love to see OpenFront on Android and I built a proof of concept to
test the waters before investing more.

## Approach

A minimal native shell (Kotlin, ~170 lines, **zero AndroidX dependencies**)
that loads the official web client in a fullscreen WebView:

- Server picker: official / staging / any self-hosted URL
- Loads the client straight from the game server, so the client always
  matches the server (no bundled assets, no CDN plumbing, no skew)
- Android back button wired to the game's history, then back to the picker
- `usesCleartextTraffic` so LAN self-hosted servers work out of the box

This follows the same pattern as the existing desktop shell: the client
already supports touch controls (PR #5166) and `BOOTSTRAP_CONFIG.serverHost`
for non-same-origin hosting, so the shell stays tiny and upstream releases
require zero porting — the server always serves a matching client.

Working APK: `android/` directory in my fork
(https://github.com/pantojinho/OpenFrontIO/tree/feat/android-app/android),
with README and build instructions (`./gradlew :app:assembleDebug`, JDK 17).

## Why this over a native rewrite

The client is TypeScript + Pixi/WebGL with mobile controls already in-tree.
A WebView shell reuses it unchanged; a rewrite would fork game logic and
diverge every release.

## Questions for maintainers

1. Is an official Android distribution something the project wants at all?
2. If yes: WebView shell as phase 1 (this PoC), evolving to a bundled client
   via `WebViewAssetLoader` + `serverHost`, or straight to bundled?
3. Any objection to shipping the app as open source under AGPL like the
   rest of the repo (assets kept CC BY-SA / proprietary-compliant)?

Happy to iterate in a PR if this gets an `approved` label. I understand the
code and can answer any design questions in review.
