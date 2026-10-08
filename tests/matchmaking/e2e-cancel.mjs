// E2E test for the short-handed matchmade game cancellation + auto-requeue
// (PR #4762). Same stack as e2e.mjs (dev app on :9000, API worker on :8787).
//
// Four browser players queue for 2v2. One of them (the "no-show") has its
// /exists polls blocked, so it never dispatches join-lobby and never
// connects to the game server — simulating a client that fails to connect
// in time. Expected: at the 15s start deadline the server cancels the game
// instead of starting it 3-handed, the three connected players get the
// kick_reason.match_cancelled toast, dispatch leave-lobby, and their
// matchmaking modals rejoin the queue automatically.
//
// Run: node tests/matchmaking/e2e-cancel.mjs

import { readFileSync } from "node:fs";
import {
  gotoHome,
  launch,
} from "../../.claude/skills/run-openfront/driver.mjs";
import { isUp, makeChecker, waitFor } from "./util.mjs";

const MODE = "2v2";
const PLAYER_COUNT = 4;
const NO_SHOW = 3; // index of the player that never reaches the game

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

const { browser } = await launch();
const pages = [];
for (let i = 0; i < PLAYER_COUNT; i++) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
  });
  await context.addInitScript(rafThrottle, 2000);
  pages.push(await context.newPage());
}

// The no-show never learns the game exists, so it never joins it.
await pages[NO_SHOW].route("**/api/game/*/exists", (route) => route.abort());

const consoles = pages.map(() => []);
pages.forEach((p, i) => p.on("console", (msg) => consoles[i].push(msg.text())));
const dumpConsoles = () => {
  pages.forEach((_, i) => {
    console.error(`\n--- player ${i + 1} console (last 25 lines) ---`);
    for (const line of consoles[i].slice(-25)) console.error(line);
  });
};

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
      window.__leaveLobby = null;
      window.__toasts = [];
      document.addEventListener(
        "join-lobby",
        (e) => (window.__joinLobby = e.detail ?? {}),
      );
      document.addEventListener(
        "leave-lobby",
        (e) => (window.__leaveLobby = e.detail ?? {}),
      );
      window.addEventListener("show-message", (e) =>
        window.__toasts.push(e.detail?.message ?? ""),
      );
      const el = document.querySelector("matchmaking-modal");
      // requeue() refuses to rejoin a closed modal; in the real flow the
      // modal is open (it only closes at prestart). Open it the same way
      // Main's modal-close loop toggles it.
      el.isModalOpen = true;
      el.mode = mode;
      el.connect();
    }, MODE);
  }
  console.log(`${PLAYER_COUNT} players queued (${MODE}), one will no-show...`);

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
  const assignedAt = Date.now();
  c.check(
    `all ${PLAYER_COUNT} players received an assignment (${gameId})`,
    gameIds.every((id) => id === gameId),
  );

  // The three live players join the game; the no-show must not.
  try {
    await waitFor(
      async () => {
        const info = await fetchGameInfo(gameId);
        return (info?.clients?.length ?? 0) === PLAYER_COUNT - 1;
      },
      {
        timeoutMs: 20000,
        intervalMs: 500,
        label: "the three live players to join the game",
      },
    );
    c.check("three live players joined the game", true);
  } catch (err) {
    dumpConsoles();
    throw err;
  }
  c.check(
    "no-show never dispatched join-lobby",
    (await pages[NO_SHOW].evaluate(() => window.__joinLobby)) === null,
  );

  // The 15s deadline passes -> the server must cancel instead of starting.
  // Give it the deadline + tick granularity + margin.
  let finalStates;
  try {
    finalStates = await waitFor(
      async () => {
        const states = await Promise.all(
          pages.map((p) =>
            p.evaluate(() => {
              const el = document.querySelector("matchmaking-modal");
              return {
                gameID: el.gameID,
                connected: el.connected,
                toasts: window.__toasts,
                leaveLobby: window.__leaveLobby,
              };
            }),
          ),
        );
        const live = states.filter((_, i) => i !== NO_SHOW);
        // Requeued = cancellation toast seen, left the dead lobby, modal
        // back in the queue (gameID cleared, join re-sent after the 2s
        // connect delay).
        const done = live.every(
          (s) =>
            s.toasts.length > 0 &&
            s.leaveLobby !== null &&
            s.gameID === null &&
            s.connected === true,
        );
        return done ? states : null;
      },
      {
        timeoutMs: 40000,
        intervalMs: 1000,
        label: "the three live players to be cancelled and requeued",
      },
    );
  } catch (err) {
    dumpConsoles();
    throw err;
  }
  const secs = ((Date.now() - assignedAt) / 1000).toFixed(1);
  c.check(
    `live players cancelled + requeued (${secs}s after assignment)`,
    true,
  );

  const liveStates = finalStates.filter((_, i) => i !== NO_SHOW);
  c.check(
    "cancellation toast mentions the failed connect",
    liveStates.every((s) => s.toasts.some((t) => /cancelled/i.test(t))),
  );
  c.check(
    'leave-lobby cause is "match-cancelled"',
    liveStates.every((s) => s.leaveLobby?.cause === "match-cancelled"),
  );
  c.check(
    "no-show got no toast and kept its stale assignment",
    finalStates[NO_SHOW].toasts.length === 0 &&
      finalStates[NO_SHOW].gameID === gameId,
  );

  // The cancelled game must be gone from the game server (pruned, never
  // started, nothing archived).
  await new Promise((r) => setTimeout(r, 2000));
  c.check(
    "cancelled game pruned from the server",
    (await fetchGameInfo(gameId)) === null,
  );

  const devLog = readFileSync("/tmp/dev.log", "utf8");
  c.check(
    "server logged the cancellation",
    devLog.includes("cancelling matchmade game"),
  );
} finally {
  await browser.close();
}
c.finish();
