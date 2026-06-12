---
name: run-openfront
description: Build, run, and drive OpenFront locally — including full in-game WebGL testing. Use when asked to run the game, start the dev server, take a screenshot of the UI, verify a client change in the real app, or interact with the running game (lobby, modals, map picker, starting a singleplayer game, spawning, attacking, build menu, reading live sim state).
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

## Drive a full game (WebGL, in-game interaction)

`game.mjs` drives an actual singleplayer game end-to-end: start, spawn,
attack/expand, open the radial menu, and read **ground-truth sim state**.
WebGL works headless via SwiftShader (no extra flags needed), and the
screenshots show the real rendered map.

Smoke flow (≈2 min: starts a 50-bot game, spawns, expands, opens the
radial menu, asserts territory growth):

```bash
node .claude/skills/run-openfront/game.mjs
# screenshots: /tmp/openfront-run/game-{spawn-phase,spawned,expanded,radial-menu}.png
```

For ad-hoc in-game flows, import the helpers (script must live inside the
repo):

```js
import {
  launch,
  gotoHome,
  openSoloModal,
} from "./.claude/skills/run-openfront/driver.mjs";
import {
  startSoloGame, // set modal options ({bots, map, difficulty, instantBuild, …}), click Start, wait for sim
  gameState, // {ticks, inSpawnPhase, numPlayers, myPlayer: {troops, gold, tilesOwned, isAlive}, …}
  findSpawnTile,
  spawn, // pick land + click it; waits until myPlayer owns tiles
  waitForSpawnPhaseEnd,
  waitForTick,
  findExpansionTile,
  attack,
  clickWorld,
  panTo,
  setAttackRatio,
  openRadialMenu, // right-click on own territory; returns true if the menu opened
} from "./.claude/skills/run-openfront/game.mjs";

const { browser, page } = await launch({ rafIntervalMs: 3000 }); // throttle is REQUIRED in-game, see below
await gotoHome(page);
await openSoloModal(page);
await startSoloGame(page, { bots: 50 });
const tile = await spawn(page);
await waitForSpawnPhaseEnd(page);
const target = await findExpansionTile(page, tile);
await attack(page, target.x, target.y);
await browser.close();
```

### How it works / in-game gotchas

- **Ground-truth state without any repo changes**: `hud/GameRenderer.ts`
  assigns the `GameView` and `TransformHandler` onto the `<build-menu>`
  Lit element (light DOM). From page JS:
  `document.querySelector("build-menu").game` / `.transformHandler`.
  GameView has `ticks()`, `inSpawnPhase()`, `myPlayer()`, `players()`,
  `ref(x,y)`, `isLand()`, `hasOwner()`; PlayerView has `troops()`,
  `numTilesOwned()`, `gold()`, `isAlive()`, `outgoingAttacks()`.
- **`launch({ rafIntervalMs: 3000 })` is mandatory for in-game work.**
  SwiftShader needs seconds of CPU per frame; an unthrottled rAF loop
  starves the main thread (0.8 fps, 100 ms timers firing every ~4 s) and
  the singleplayer turn loop crawls at ~0.3 ticks/s instead of 10/s. The
  throttle stubs `requestAnimationFrame` to one frame per interval —
  sim runs near full speed, frames still render for screenshots.
- **Solo modal options are settable as element properties** before
  clicking Start: `document.querySelector("single-player-modal").bots = 50`
  (`@state` fields are TS-private only). `startSoloGame` does this.
- **Click tile centers, not corners.** World coords address a tile's
  top-left corner and `screenToWorldCoordinates` floors — a corner click
  can land on the neighboring tile (and clicking your own tile is a
  silent no-op). `clickWorld` aims at `+0.5,+0.5`.
- **HUD elements swallow canvas clicks.** The leaderboard / control panel
  / modals sit above the `#game-input-overlay`. `clickWorld` verifies
  `document.elementFromPoint` hits the overlay and recenters the camera
  (`panTo`) if not — never click raw screen coords yourself.
- **The camera animates on its own** (post-spawn go-to-player), so screen
  coords computed before the click go stale. `clickWorld` calls
  `transformHandler.clearTarget()` first to freeze it.
- **Spawning**: during the spawn phase a left click on unowned land sends
  the spawn intent; in singleplayer the spawn phase ends as soon as the
  human spawns. `nameLocation()` can still be `{0,0}` for the first ticks
  after spawning — pass the spawn tile as fallback origin (helpers do).
- **Attacking**: a left click outside the spawn phase attacks/expands if
  `canAttack` (unowned land must be connected to your border through
  unowned land). Troops drop and `outgoingAttacks()` becomes non-empty on
  success. The radial menu (right click) is a DOM/SVG overlay —
  `.radial-menu-container` exists from startup; check
  `style.display !== "none"` for "open".
- Verify rendering visually by reading the screenshots — a blank WebGL
  canvas means SwiftShader broke (check `webgl2` context creation and
  `LD_LIBRARY_PATH`/fontconfig from setup.sh).

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
