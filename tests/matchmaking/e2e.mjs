// End-to-end matchmaking integration test. Requires the REAL stack:
//   - the API worker running on localhost:8787 (wrangler dev in the API repo)
//   - the dev app running on localhost:9000 (`npm run dev` — its game server
//     long-polls the worker's /matchmaking/checkin out of the box in dev)
//
// Drives two real browser players through the real matchmaking modal:
// both join the queue on the worker, the matcher pairs them, the local game
// server receives the checkin assignment and creates the game, and both
// clients see the game exist and dispatch join-lobby.
//
// Run: npm run test:matchmaking:e2e

import {
  gotoHome,
  launch,
} from "../../.claude/skills/run-openfront/driver.mjs";
import { isUp, makeChecker, waitFor } from "./util.mjs";

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

const { browser, page: page1 } = await launch();
const context2 = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
});
const page2 = await context2.newPage();

const pages = [page1, page2];
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

const c = makeChecker();
try {
  // Two contexts = separate localStorage = two distinct players.
  for (const p of pages) {
    await gotoHome(p);
    await p.evaluate(() => {
      window.__joinLobby = null;
      document.addEventListener(
        "join-lobby",
        (e) => (window.__joinLobby = e.detail ?? {}),
      );
      document.querySelector("matchmaking-modal").connect();
    });
  }

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
        label: "both players to receive a match-assignment",
      },
    );
  } catch (err) {
    dumpConsoles();
    throw err;
  }
  c.check(`both players received an assignment (${gameIds[0]})`, true);
  c.check("both players got the same gameId", gameIds[0] === gameIds[1]);

  // The modal polls the game server until the assigned game exists, then
  // dispatches join-lobby — this proves the checkin/creation side worked.
  try {
    await waitFor(
      async () => {
        const details = await Promise.all(
          pages.map((p) => p.evaluate(() => window.__joinLobby)),
        );
        return details.every((d) => d?.gameID === gameIds[0]);
      },
      {
        timeoutMs: 45000,
        intervalMs: 1000,
        label: "both players to dispatch join-lobby for the created game",
      },
    );
    c.check("game created on the game server and joinable by both", true);
  } catch (err) {
    dumpConsoles();
    throw err;
  }
} finally {
  await browser.close();
}
c.finish();
