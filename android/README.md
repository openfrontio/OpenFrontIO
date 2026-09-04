# OpenFront Android (skeleton)

Native Android wrapper that runs the OpenFront web client in a fullscreen
WebView. Phase 1 loads the client **directly from the game server**, so the
client version always matches the server you connect to — no bundled assets,
no CDN plumbing, no client/server skew.

The client already ships mobile touch controls (see upstream PR #5166 and the
existing responsive UI), so the shell intentionally stays tiny:

- Server picker (official / staging / self-hosted URL)
- Fullscreen hardware-accelerated WebView
- Android back button wired to the game's history, then back to the picker
- Zero AndroidX dependencies (builds with a bare SDK install)

Later phases (not in this skeleton):

- Bundled client build served via `WebViewAssetLoader` with
  `BOOTSTRAP_CONFIG.serverHost` pointing at the chosen server (same mechanism
  the desktop shell uses), for offline lobby UI and faster cold start.
- Fullscreen immersive mode, landscape lock option, push notifications for
  lobby invites.

## Build

Requirements: JDK 17, Android SDK (platform 35, build-tools). No AndroidX /
Maven artifacts are needed.

```bash
cd android
./gradlew :app:assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

`local.properties` with `sdk.dir=` is picked up automatically if present.

## Run

Install the APK, pick a server (or type your self-hosted one), play.

`usesCleartextTraffic` is enabled so plain-HTTP self-hosted servers on LAN
work out of the box.

## Why a WebView and not a rewrite

OpenFront's client is TypeScript + Pixi.js/WebGL and already implements
touch input and responsive layouts. A native rewrite would fork the game
logic; a WebView shell reuses the real client unchanged, tracks upstream with
zero per-release porting, and still gives us a native home-screen icon,
fullscreen, and process lifecycle handling.
