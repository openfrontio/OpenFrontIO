// In-game driver for OpenFront: start a singleplayer game headless, spawn,
// attack, and read ground-truth simulation state from the page.
//
// Run the smoke flow from the repo root (dev server must be up):
//   node .claude/skills/run-openfront/game.mjs
// or import the helpers in an ad-hoc script inside the repo.
//
// Ground-truth access — no repo changes needed: src/client/hud/GameRenderer.ts
// assigns the GameView and TransformHandler onto the <build-menu> Lit element
// (light DOM), so page JS can reach them via
//   document.querySelector("build-menu").game / .transformHandler
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";

// ---------- game lifecycle ----------

// From an open single-player modal: tweak options and click Start, then wait
// until the game is fully loaded (renderer mounted, sim ticking).
// opts: { bots, instantBuild, infiniteGold, infiniteTroops, map, difficulty }
export async function startSoloGame(page, opts = {}) {
  if (Object.keys(opts).length > 0) {
    await page.evaluate((o) => {
      const modal = document.querySelector("single-player-modal");
      if (o.bots !== undefined) modal.bots = o.bots;
      if (o.instantBuild !== undefined) modal.instantBuild = o.instantBuild;
      if (o.infiniteGold !== undefined) modal.infiniteGold = o.infiniteGold;
      if (o.infiniteTroops !== undefined)
        modal.infiniteTroops = o.infiniteTroops;
      if (o.map !== undefined) modal.selectedMap = o.map;
      if (o.difficulty !== undefined) modal.selectedDifficulty = o.difficulty;
    }, opts);
    await page.waitForTimeout(300); // let Lit re-render
  }
  await page
    .locator('o-button[translationKey="single_modal.start"] button:visible')
    .first()
    .click();
  await waitForGameReady(page);
}

// Game is "ready" when the HUD has its GameView and the sim has ticked.
export async function waitForGameReady(page, timeout = 180_000) {
  await page.waitForFunction(
    () => {
      const bm = document.querySelector("build-menu");
      return bm?.game !== undefined && bm.game.ticks() > 0;
    },
    undefined,
    { timeout, polling: 500 },
  );
}

// Snapshot of ground-truth sim state (everything serializable happens
// in-page; live objects can't cross the evaluate boundary).
export async function gameState(page) {
  return await page.evaluate(() => {
    const g = document.querySelector("build-menu")?.game;
    if (!g) return null;
    const me = g.myPlayer();
    const players = g.players();
    return {
      ticks: g.ticks(),
      inSpawnPhase: g.inSpawnPhase(),
      mapSize: { width: g.width(), height: g.height() },
      numPlayers: players.length,
      numAlive: players.filter((p) => p.isAlive()).length,
      myPlayer:
        me === null
          ? null
          : {
              name: me.name(),
              isAlive: me.isAlive(),
              troops: me.troops(),
              gold: String(me.gold()),
              tilesOwned: me.numTilesOwned(),
            },
    };
  });
}

// ---------- coordinates & clicking ----------

// World (tile) coords -> screen px, or null if off-viewport.
// worldToScreenCoordinates only reads cell.x/.y, so a plain object works.
export async function worldToScreen(page, x, y) {
  return await page.evaluate(
    ([wx, wy]) => {
      const t = document.querySelector("build-menu")?.transformHandler;
      const s = t.worldToScreenCoordinates({ x: wx, y: wy });
      if (
        s.x < 0 ||
        s.y < 0 ||
        s.x > window.innerWidth ||
        s.y > window.innerHeight
      )
        return null;
      return s;
    },
    [x, y],
  );
}

// Click a world tile on the canvas (left button = spawn during spawn phase,
// attack/expand after it). If the tile is off-screen (e.g. the camera is
// still animating to the player after spawn), recenter on my player and wait.
export async function clickWorld(page, x, y, button = "left") {
  // Stop any in-flight camera animation (e.g. the post-spawn go-to-player),
  // otherwise the transform changes between computing coords and clicking.
  await page.evaluate(() => {
    document.querySelector("build-menu").transformHandler.clearTarget();
  });
  // Aim at the tile center: world coords address the tile's top-left corner
  // and screenToWorld floors, so a corner click can land on the neighbor.
  const [cx, cy] = [x + 0.5, y + 0.5];
  const clickable = async () => {
    const s = await worldToScreen(page, cx, cy);
    if (s === null) return null;
    // HUD elements (leaderboard, control panel, modals) sit above the input
    // overlay and swallow pointer events — only click if the overlay is hit.
    const hit = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.id ?? "",
      [s.x, s.y],
    );
    return hit === "game-input-overlay" ? s : null;
  };
  let s = await clickable();
  if (s === null) {
    await panTo(page, x, y); // viewport center is clear of HUD chrome
    s = await clickable();
  }
  if (s === null)
    throw new Error(`world tile (${x},${y}) is off-screen or covered by HUD`);
  await page.mouse.click(s.x, s.y, { button });
  return s;
}

// Snap the camera so world point (x,y) is at the viewport center.
// screenCenter() returns world coords and offsetX/Y are in world units,
// so the pan is a plain delta — no animation to wait on.
export async function panTo(page, x, y) {
  await page.evaluate(
    ([wx, wy]) => {
      const t = document.querySelector("build-menu").transformHandler;
      const c = t.screenCenter();
      t.offsetX += wx - c.screenX;
      t.offsetY += wy - c.screenY;
    },
    [x, y],
  );
  await page.waitForTimeout(300); // let the frame loop redraw
}

// ---------- spawn ----------

// Find a spawnable tile (land, unowned, on-screen, away from HUD edges).
export async function findSpawnTile(page, margin = 200) {
  return await page.evaluate((m) => {
    const bm = document.querySelector("build-menu");
    const g = bm.game;
    const t = bm.transformHandler;
    const w = g.width();
    const h = g.height();
    // Deterministic grid sweep, center-out, so we don't need randomness.
    const cells = [];
    for (let i = 0; i < 4000; i++) {
      const gx = Math.floor((i * 79) % w);
      const gy = Math.floor((i * 131) % h);
      cells.push([gx, gy]);
    }
    for (const [x, y] of cells) {
      if (!g.isValidCoord(x, y)) continue;
      const ref = g.ref(x, y);
      if (!g.isLand(ref) || g.hasOwner(ref)) continue;
      const s = t.worldToScreenCoordinates({ x, y });
      if (
        s.x < m ||
        s.y < m ||
        s.x > window.innerWidth - m ||
        s.y > window.innerHeight - m
      )
        continue;
      return { x, y, screen: s };
    }
    return null;
  }, margin);
}

// Click a spawn point and wait until the player exists and owns tiles.
// Returns the spawn tile. In singleplayer the spawn phase ends as soon as
// the human spawns (SpawnExecution).
export async function spawn(page, tile = null) {
  tile = tile ?? (await findSpawnTile(page));
  if (tile === null) throw new Error("no spawnable tile found on screen");
  await clickWorld(page, tile.x, tile.y);
  await page.waitForFunction(
    () => {
      const g = document.querySelector("build-menu")?.game;
      const me = g?.myPlayer();
      return me !== null && me !== undefined && me.numTilesOwned() > 0;
    },
    undefined,
    { timeout: 30_000, polling: 250 },
  );
  return tile;
}

export async function waitForSpawnPhaseEnd(page, timeout = 60_000) {
  await page.waitForFunction(
    () => {
      const g = document.querySelector("build-menu")?.game;
      return g !== undefined && !g.inSpawnPhase();
    },
    undefined,
    { timeout, polling: 500 },
  );
}

// ---------- actions ----------

// Set the troop fraction used per attack (0.01–1).
export async function setAttackRatio(page, ratio) {
  await page.evaluate((r) => {
    document.querySelector("control-panel").uiState.attackRatio = r;
  }, ratio);
}

// Attack/expand toward a world tile: a plain left click outside spawn phase
// triggers ClientGameRunner.inputEvent -> SendAttackIntentEvent if attackable.
export async function attack(page, x, y) {
  await clickWorld(page, x, y);
}

// Find an unowned land tile near (and outside) my territory border — the
// natural "expand" click target right after spawning. `near` is a {x,y}
// fallback (e.g. the spawn tile): nameLocation() can still be (0,0) in the
// first ticks after spawning, before name render data is computed.
export async function findExpansionTile(page, near = null) {
  return await page.evaluate((fallback) => {
    const bm = document.querySelector("build-menu");
    const g = bm.game;
    const me = g.myPlayer();
    if (!me) return null;
    const loc = me.nameLocation();
    const origin = loc && loc.size > 0 ? loc : fallback;
    if (!origin) return null;
    const cx = Math.round(origin.x);
    const cy = Math.round(origin.y);
    for (let r = 2; r < 100; r += 2) {
      for (const [dx, dy] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
        [r, r],
        [-r, -r],
      ]) {
        const x = cx + dx;
        const y = cy + dy;
        if (!g.isValidCoord(x, y)) continue;
        const ref = g.ref(x, y);
        if (g.isLand(ref) && !g.hasOwner(ref)) return { x, y };
      }
    }
    return null;
  }, near);
}

// Open the radial (build) menu with a right click on my territory.
// Returns true if the radial menu became visible (it's a DOM/SVG overlay).
// `at` falls back to my nameLocation when omitted.
export async function openRadialMenu(page, at = null) {
  at ??= await page.evaluate(() => {
    const g = document.querySelector("build-menu").game;
    const me = g.myPlayer();
    if (!me) return null;
    const loc = me.nameLocation();
    if (!loc || loc.size <= 0) return null;
    return { x: Math.round(loc.x), y: Math.round(loc.y) };
  });
  if (at === null) throw new Error("no territory location — spawn first");
  await clickWorld(page, at.x, at.y, "right");
  await page.waitForTimeout(800);
  // The container div always exists (created hidden at startup) — visibility
  // is the actual open/closed signal.
  return await page.evaluate(() => {
    const el = document.querySelector(".radial-menu-container");
    return el !== null && el.style.display !== "none";
  });
}

// ---------- waiting / verification ----------

// Wait until the sim reaches a given tick (game ticks are 100ms).
export async function waitForTick(page, tick, timeout = 120_000) {
  await page.waitForFunction(
    (target) => {
      const g = document.querySelector("build-menu")?.game;
      return g !== undefined && g.ticks() >= target;
    },
    tick,
    { timeout, polling: 500 },
  );
}

// ---------- smoke flow ----------

const isMain =
  process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const out = "/tmp/openfront-run";
  fs.mkdirSync(out, { recursive: true });
  const shot = (page, name) =>
    page.screenshot({ path: `${out}/${name}.png` }).then(() => {
      const kb = Math.round(fs.statSync(`${out}/${name}.png`).size / 1024);
      console.log(`screenshot ${out}/${name}.png (${kb} KB)`);
    });

  // rAF throttle is what makes in-game testing viable: SwiftShader frames
  // cost seconds of CPU and an unthrottled frame loop starves the sim.
  const { browser, page } = await launch({ rafIntervalMs: 3000 });
  page.on("console", (m) => {
    if (/clicked cell/.test(m.text())) console.log("   PAGE:", m.text());
  });
  try {
    console.log("1. home + solo modal");
    await gotoHome(page);
    await openSoloModal(page);

    console.log("2. starting solo game (50 bots)…");
    await startSoloGame(page, { bots: 50 });
    console.log("   game ready:", JSON.stringify(await gameState(page)));
    await shot(page, "game-spawn-phase");

    console.log("3. spawning…");
    const tile = await spawn(page, await findSpawnTile(page));
    console.log(`   spawned at (${tile.x},${tile.y})`);
    await waitForSpawnPhaseEnd(page);
    console.log("   spawn phase over:", JSON.stringify(await gameState(page)));
    await shot(page, "game-spawned");

    console.log("4. expanding (attack unowned land)…");
    const before = await gameState(page);
    const target = await findExpansionTile(page, tile);
    if (target === null) throw new Error("no expansion tile found");
    await attack(page, target.x, target.y);
    await waitForTick(page, before.ticks + 50); // let 5s of sim run
    const after = await gameState(page);
    console.log("   after:", JSON.stringify(after));
    if (after.myPlayer.tilesOwned <= before.myPlayer.tilesOwned) {
      throw new Error("territory did not grow after attack");
    }
    console.log(
      `   territory grew ${before.myPlayer.tilesOwned} -> ${after.myPlayer.tilesOwned} ✓`,
    );
    await shot(page, "game-expanded");

    console.log("5. radial menu (right click)…");
    const radialOpen = await openRadialMenu(page, tile);
    console.log(`   radial menu visible: ${radialOpen}`);
    await shot(page, "game-radial-menu");

    console.log("SMOKE OK");
  } finally {
    await browser.close();
  }
}
