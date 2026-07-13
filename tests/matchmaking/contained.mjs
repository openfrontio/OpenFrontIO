// Contained matchmaking integration test: drives the real matchmaking modal
// in the real app against a fake matchmaking server (fakeServer.mjs) that
// speaks the documented protocol. Covers the close-code contract:
//   - unexpected close (deploy)        -> reconnect + rejoin
//   - 1008 Invalid session             -> reconnect + rejoin (fresh token)
//   - 1000 Replaced by newer connection-> message shown, NO retry
//   - intentional close (user backs out or assignment received) -> no retry
//
// Prerequisite: the dev app must be running (`npm run dev`, port 9000).
// Run: npm run test:matchmaking

import {
  gotoHome,
  launch,
} from "../../.claude/skills/run-openfront/driver.mjs";
import { startFakeMatchmakingServer } from "./fakeServer.mjs";
import { isUp, makeChecker, waitFor } from "./util.mjs";

if (!(await isUp("http://localhost:9000"))) {
  console.error(
    "Dev app is not running on :9000 — start it with `npm run dev`.",
  );
  process.exit(1);
}

const fake = await startFakeMatchmakingServer();
const control = async (path, body) => {
  const res = await fetch(`${fake.controlUrl}/${path}`, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
};
const joins = async () => {
  const res = await fetch(`${fake.controlUrl}/state`);
  return (await res.json()).joins;
};
const joinCountReaches = (n, timeoutMs) =>
  waitFor(async () => (await joins()).length >= n, {
    timeoutMs,
    label: `join #${n} to reach the fake server`,
  });

const { browser, page } = await launch();
const c = makeChecker();
try {
  await gotoHome(page);

  // Redirect the modal's /matchmaking/join socket to the fake server while
  // keeping real browser WebSocket (and close-code) semantics.
  await page.evaluate((wsUrl) => {
    const Real = window.WebSocket;
    window.WebSocket = class extends Real {
      constructor(url, protocols) {
        const s = String(url);
        if (s.includes("/matchmaking/join")) {
          super(
            `${wsUrl}/matchmaking/join?${s.split("?")[1] ?? ""}`,
            protocols,
          );
        } else {
          super(url, protocols);
        }
      }
    };
    window.__mmMessages = [];
    window.addEventListener("show-message", (e) =>
      window.__mmMessages.push(e.detail?.message),
    );
  }, fake.wsUrl);

  const modal = (body) =>
    page.evaluate(`(() => {
      const el = document.querySelector("matchmaking-modal");
      ${body}
    })()`);
  const resetAndConnect = (mode = "1v1") =>
    modal(`el.gameID = null;
      el.intentionalClose = false;
      el.reconnectAttempts = 0;
      el.mode = ${JSON.stringify(mode)};
      el.connect();`);

  // 1. Joining the queue: connect -> join arrives (after the modal's 2s delay)
  await resetAndConnect();
  await joinCountReaches(1, 8000);
  c.check("join sent after connect", true);
  c.check("1v1 join sends mode=1v1", (await joins())[0].mode === "1v1");

  // 2. Deploy/restart: server drops the socket abruptly -> reconnect + rejoin
  await control("kill");
  await joinCountReaches(2, 10000);
  c.check("unexpected close -> reconnected and rejoined", true);

  // 3. Invalid session: next join is closed 1008 -> client retries and rejoins
  await control("reject-next");
  await control("kill"); // forces the reconnect whose join gets 1008
  await joinCountReaches(4, 20000); // join 3 rejected, join 4 accepted
  c.check("1008 -> reconnected and rejoined with fresh token", true);

  // 4. Assignment: modal records the gameId
  await control("assign", { gameId: "FakeGame1" });
  await waitFor(() => modal(`return el.gameID === "FakeGame1";`), {
    timeoutMs: 5000,
    label: "modal to receive match-assignment",
  });
  c.check("match-assignment received", true);
  await modal(`el.onClose();`); // stop the game-exists polling

  // 5. Replaced by newer connection: message shown, no retry
  await resetAndConnect();
  await joinCountReaches(5, 8000);
  await control("replace");
  await waitFor(() => page.evaluate(() => window.__mmMessages.length > 0), {
    timeoutMs: 5000,
    label: "replaced message",
  });
  const msg = await page.evaluate(() => window.__mmMessages.at(-1));
  c.check(
    `replaced -> message shown ("${msg}")`,
    typeof msg === "string" && !msg.includes("matchmaking_modal."),
  );
  await new Promise((r) => setTimeout(r, 3500));
  c.check("replaced -> no retry", (await joins()).length === 5);

  // 6. Intentional close (user backs out): no retry, no message
  await resetAndConnect();
  await joinCountReaches(6, 8000);
  const msgsBefore = await page.evaluate(() => window.__mmMessages.length);
  await modal(`el.onClose();`);
  await new Promise((r) => setTimeout(r, 3500));
  c.check("intentional close -> no retry", (await joins()).length === 6);
  c.check(
    "intentional close -> no message",
    (await page.evaluate(() => window.__mmMessages.length)) === msgsBefore,
  );

  // 7. 2v2 queue: join carries mode=2v2
  await resetAndConnect("2v2");
  await joinCountReaches(7, 8000);
  c.check("2v2 join sends mode=2v2", (await joins())[6].mode === "2v2");
  await modal(`el.onClose();`);
} finally {
  await browser.close();
  await fake.close();
}
c.finish();
