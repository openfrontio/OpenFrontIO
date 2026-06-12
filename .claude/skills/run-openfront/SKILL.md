---
name: run-openfront
description: Build, run, and drive OpenFront locally. Use when asked to run the game, start the dev server, take a screenshot of the UI, verify a client change in the real app, or interact with the running game (lobby, modals, map picker).
---

OpenFront is a browser game (Lit + Pixi.js client, Node game server).
Run the dev server with `npm run dev` (serves on **http://localhost:9000**,
not Vite's default 5173), then drive it with headless Chromium via
`.claude/skills/run-openfront/driver.mjs`. All paths are relative to the
repo root.

## Prerequisites (one-time per machine, no sudo)

The host (Ubuntu 26.04, headless) has no browser, and Playwright doesn't
support 26.04 yet. `setup.sh` works around both: it installs Playwright
(`--no-save`), downloads the ubuntu24.04 chromium-headless-shell via
`PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`, extracts the missing system libraries
from `.deb` packages into `~/.cache/openfront-run/` (no root needed), and
builds a local fontconfig (the host has no `/etc/fonts`; Skia FATALs
without one).

```bash
bash .claude/skills/run-openfront/setup.sh
```

Deps were installed with `npm run inst` (`npm ci --ignore-scripts`) — do
not use `npm install`.

## Run the dev server

```bash
(npm run dev > /tmp/dev.log 2>&1 &)
timeout 60 bash -c 'until curl -sf http://localhost:9000 >/dev/null 2>&1; do sleep 1; done'
```

Stop it with `pkill -f "tsx src/server/Server.ts"; pkill -f vite`.
`ECONNREFUSED "Error polling lobby"` lines in `/tmp/dev.log` are normal —
the closed-source API isn't running in dev.

## Drive it (agent path)

Smoke flow — home page, open the single-player modal, dump the map-picker
state, screenshot:

```bash
node .claude/skills/run-openfront/driver.mjs
# screenshots: /tmp/openfront-run/home.png, /tmp/openfront-run/solo-modal.png
```

For ad-hoc flows, write a script **inside the repo** (so `playwright`
resolves) importing the driver's helpers:

```js
import {
  launch,
  gotoHome,
  openSoloModal,
} from "./.claude/skills/run-openfront/driver.mjs";
const { browser, page } = await launch(); // env/libs/fonts handled here
await gotoHome(page);
await openSoloModal(page);
// Lit components use light DOM — query and read properties directly:
const s = await page.evaluate(
  () => document.querySelector("map-picker")?.selectedMap,
);
await browser.close();
```

## Run (human path)

`npm run dev`, open http://localhost:9000 in a browser. Useless headless.

## Test

```bash
npm test                                      # full suite (Vitest)
npx vitest tests/MapConsistency.test.ts --run # single file
```

## Gotchas

- **Vite serves on port 9000**, not 5173 (configured in vite.config.ts).
- **Playwright on Ubuntu 26.04**: `npx playwright install chromium` fails
  with "does not support chromium on ubuntu26.04-x64". Fix:
  `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64` (setup.sh does this).
- **Browser dies at launch / mid-load**: missing host libs
  (`libnspr4.so`, `libatk-1.0.so.0`, …) then a Skia FATAL
  (`SkFontMgr_FontConfigInterface.cpp: Not implemented`) from the absent
  fontconfig. `launch()` in driver.mjs injects `LD_LIBRARY_PATH` and
  `FONTCONFIG_FILE` pointing at `~/.cache/openfront-run/`; diagnose new
  missing libs with `DEBUG=pw:browser` and
  `ldd .../chrome-headless-shell | grep "not found"`.
- **The single-player button is labeled "SOLO!"**, and the DOM has more
  than one (responsive layouts) — use `button:visible` with
  `hasText: /solo/i`.
- **Lit + Vite HMR**: custom elements can't be re-registered, so an
  already-open tab keeps old component code after an edit. Hard-reload
  (or re-`goto`) before judging behavior.
- **`PAGEERROR: ... reading 'inSpawnPhase'`** on the home page is
  pre-existing background noise, not your breakage.
- Wait ~3s after `load` before interacting — Lit components render
  client-side (driver's `gotoHome` does this).

## Troubleshooting

- `Cannot find package 'playwright'` — your script is outside the repo;
  module resolution starts at the script's path, not cwd. Move it inside
  the repo (anywhere under the root works).
- `Target page, context or browser has been closed` immediately —
  re-run `bash .claude/skills/run-openfront/setup.sh` (the
  `~/.cache/openfront-run` lib cache is missing or was cleared).
- `EADDRINUSE` on relaunch — a previous dev server is still up:
  `pkill -f "tsx src/server/Server.ts"; pkill -f vite`.
