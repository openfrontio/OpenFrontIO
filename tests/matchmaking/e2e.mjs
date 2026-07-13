// End-to-end matchmaking integration test. Requires the REAL stack:
//   - the API worker running on localhost:8787 (wrangler dev in the API repo)
//   - the dev app running on localhost:9000 (`npm run dev` — its game server
//     long-polls the worker's /matchmaking/checkin out of the box in dev)
//
// Drives real browser players through the real matchmaking modal: all join
// the queue on the worker, the matcher groups them, the local game server
// receives the checkin assignment and creates the game, and every client
// gets into it (which also proves the allowedPublicIds allowlist accepts
// the matched players).
//
// Run: npm run test:matchmaking:e2e            (1v1: two players)
//      MM_MODE=2v2 npm run test:matchmaking:e2e (2v2: four players,
//        also verifies the in-game team split is 2 vs 2 and identical on
//        every client)

import {
  gotoHome,
  launch,
} from "../../.claude/skills/run-openfront/driver.mjs";
import { isUp, makeChecker, waitFor } from "./util.mjs";

const MODE = process.env.MM_MODE === "2v2" ? "2v2" : "1v1";
const PLAYER_COUNT = MODE === "2v2" ? 4 : 2;

if (!(await isUp("http://localhost:9000"))) {
  console.error(
    "Dev app is not running on :9000 — start it with `npm run dev`.",
  );
  process.exit(1);
}
if (!(await isUp("http://localhost:8787"))) {
  console.error(
    "API worker is not running on :8787 — start it with `wrangler dev` in the API repo.",
  );
  process.exit(1);
}

// Throttle rAF like the driver does for in-game work: software WebGL frames
// are expensive and an unthrottled loop starves the sim/timers.
const rafThrottle = (interval) => {
  let last = 0;
  window.requestAnimationFrame = (cb) => {
    const now = performance.now();
    const wait = Math.max(0, interval - (now - last));
    return setTimeout(() => {
      last = performance.now();
      cb(last);
    }, wait);
  };
  window.cancelAnimationFrame = (id) => clearTimeout(id);
};

// The app refuses software WebGL (initGL.ts gates on the renderer string and
// failIfMajorPerformanceCaveat), but headless browsers only have SwiftShader.
// We're verifying matchmaking/teams, not rendering, so let the context
// through in the test pages.
const glSpoof = () => {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === "webgl2" && attrs) {
      const rest = { ...attrs };
      delete rest.failIfMajorPerformanceCaveat;
      return origGetContext.call(this, type, rest);
    }
    return origGetContext.call(this, type, attrs);
  };
  const origGetParameter = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function (p) {
    if (p === 0x9246 /* UNMASKED_RENDERER_WEBGL */) {
      return "Harness Spoofed GPU";
    }
    return origGetParameter.call(this, p);
  };
};

const { browser } = await launch();
const pages = [];
for (let i = 0; i < PLAYER_COUNT; i++) {
  // One context per player: separate localStorage = distinct players.
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  await context.addInitScript(rafThrottle, 2000);
  await context.addInitScript(glSpoof);
  pages.push(await context.newPage());
}

const consoles = pages.map(() => []);
pages.forEach((p, i) => p.on("console", (msg) => consoles[i].push(msg.text())));

const dumpConsoles = () => {
  pages.forEach((_, i) => {
    console.error(`\n--- player ${i + 1} console (last 25 lines) ---`);
    for (const line of consoles[i].slice(-25)) console.error(line);
  });
  console.error(
    "\nHints: close code 1008 means the worker rejected the play token; " +
      "no assignment at all usually means the worker isn't accepting the " +
      "game server's checkin (x-api-key) or the matcher isn't running.",
  );
};

// The dev game server runs NUM_WORKERS=2; the worker path is derived from
// the gameId, so just probe both.
const fetchGameInfo = async (gameId) => {
  for (const worker of ["w0", "w1"]) {
    const res = await fetch(
      `http://localhost:9000/${worker}/api/game/${gameId}`,
    );
    if (res.ok) return res.json();
  }
  return null;
};

const c = makeChecker();
try {
  for (const p of pages) {
    await gotoHome(p);
    await p.evaluate((mode) => {
      window.__joinLobby = null;
      document.addEventListener(
        "join-lobby",
        (e) => (window.__joinLobby = e.detail ?? {}),
      );
      const el = document.querySelector("matchmaking-modal");
      el.mode = mode;
      el.connect();
    }, MODE);
  }
  console.log(`${PLAYER_COUNT} players queued (${MODE})...`);

  const gameIdOf = (p) =>
    p.evaluate(() => document.querySelector("matchmaking-modal").gameID);

  let gameIds;
  try {
    gameIds = await waitFor(
      async () => {
        const ids = await Promise.all(pages.map(gameIdOf));
        return ids.every(Boolean) ? ids : null;
      },
      {
        timeoutMs: 90000,
        intervalMs: 1000,
        label: "every player to receive a match-assignment",
      },
    );
  } catch (err) {
    dumpConsoles();
    throw err;
  }
  const gameId = gameIds[0];
  c.check(
    `all ${PLAYER_COUNT} players received an assignment (${gameId})`,
    true,
  );
  c.check(
    "all players got the same gameId",
    gameIds.every((id) => id === gameId),
  );

  // The modal polls the game server until the assigned game exists, then
  // dispatches join-lobby — this proves the checkin/creation side worked.
  try {
    await waitFor(
      async () => {
        const details = await Promise.all(
          pages.map((p) => p.evaluate(() => window.__joinLobby)),
        );
        return details.every((d) => d?.gameID === gameId);
      },
      {
        timeoutMs: 45000,
        intervalMs: 1000,
        label: "every player to dispatch join-lobby for the created game",
      },
    );
    c.check("game created on the game server", true);
  } catch (err) {
    dumpConsoles();
    throw err;
  }

  // The game must carry the mode's config and admit exactly the matched
  // players (allowedPublicIds).
  const info = await fetchGameInfo(gameId);
  if (MODE === "2v2") {
    c.check(
      "2v2 game config: Team mode, 2 teams, 4 max players",
      info?.gameConfig?.gameMode === "Team" &&
        info?.gameConfig?.playerTeams === 2 &&
        info?.gameConfig?.maxPlayers === 4,
    );
  } else {
    c.check(
      "1v1 game config: FFA, 2 max players",
      info?.gameConfig?.gameMode === "Free For All" &&
        info?.gameConfig?.maxPlayers === 2,
    );
  }
  c.check(
    `assignment allowlist has ${PLAYER_COUNT} publicIds`,
    info?.gameConfig?.allowedPublicIds?.length === PLAYER_COUNT,
  );

  try {
    await waitFor(
      async () => {
        const now = await fetchGameInfo(gameId);
        return (now?.clients?.length ?? 0) === PLAYER_COUNT;
      },
      {
        timeoutMs: 60000,
        intervalMs: 1000,
        label: "all matched players to pass the allowlist and join the game",
      },
    );
    c.check("all matched players admitted past the allowlist", true);
  } catch (err) {
    console.error(
      "game info at failure:",
      JSON.stringify(await fetchGameInfo(gameId)),
    );
    for (const p of pages) {
      console.error("page:", p.url());
    }
    dumpConsoles();
    throw err;
  }

  if (MODE === "2v2") {
    // Ride the real flow into the game and read the ground-truth team split
    // from each client's GameView (see run-openfront skill notes).
    const splitOf = (p) =>
      p.evaluate(() => {
        const g = document.querySelector("build-menu")?.game;
        if (!g) return null;
        try {
          const humans = g.players().filter((pl) => pl.type() === "HUMAN");
          if (humans.length < 4) return null;
          return humans.map((pl) => `${pl.clientID()}:${pl.team()}`).sort();
        } catch {
          return null;
        }
      });

    let splits;
    try {
      splits = await waitFor(
        async () => {
          const all = await Promise.all(pages.map(splitOf));
          return all.every(Boolean) ? all : null;
        },
        {
          timeoutMs: 120000,
          intervalMs: 2000,
          label: "every client to reach the started game with 4 humans",
        },
      );
    } catch (err) {
      dumpConsoles();
      throw err;
    }

    const teamCounts = {};
    for (const entry of splits[0]) {
      const team = entry.split(":")[1];
      teamCounts[team] = (teamCounts[team] ?? 0) + 1;
    }
    c.check(
      `in-game team split is 2 vs 2 (${JSON.stringify(teamCounts)})`,
      Object.values(teamCounts).sort().join(",") === "2,2",
    );
    c.check(
      "team split is identical on every client (deterministic)",
      splits.every((s) => JSON.stringify(s) === JSON.stringify(splits[0])),
    );
  }
} finally {
  await browser.close();
}
c.finish();
