// Offline E2E smoke test for the desktop shell.
//
// Boots the Electron app against the production static/ build with every
// non-app:// request blocked (harder-blocked than the shell itself, to prove
// zero internet is needed), then drives the real UI:
//   1. wait for the homepage (game-mode-selector upgraded)
//   2. click Solo -> single-player modal opens
//   3. click Start -> the client dispatches join-lobby (singleplayer)
//   4. LocalServer + core worker spin up -> turns execute -> .in-game class
// Exit code 0 only if the game actually runs offline.

import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const RENDERER_SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (desc, fn, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try {
        const v = fn();
        if (v) return v;
      } catch {}
      await sleep(250);
    }
    throw new Error("timeout waiting for " + desc);
  };

  // The main process blocks every non-app:// request at the network layer —
  // the real no-internet simulation. Here we only RECORD the external
  // attempts (cosmetics/auth/archive all degrade gracefully offline); they
  // must not fail the test, since the game must merely tolerate their
  // failure, not avoid making them.
  window.__externalAttempts = [];

  window.addEventListener("error", (e) => {
    window.__consoleErrors.push(String(e.message));
  });

  // 1. Homepage up: Lit upgraded the game mode selector.
  await waitFor("game-mode-selector upgrade", () =>
    customElements.get("game-mode-selector"),
  );
  const selector = document.querySelector("game-mode-selector");
  await waitFor(
    "selector rendered",
    () => selector !== null && selector.children.length > 0,
    20000,
  );

  // 2. Click the real Solo card (the same button a user clicks), not the
  // showPage shortcut — validateUsername() only runs on the real path.
  const soloBtn = await waitFor("solo card button", () => {
    const btns = [...selector.querySelectorAll("button")];
    return btns.find((b) =>
      b.textContent.trim().toLowerCase().includes("solo"),
    );
  });
  soloBtn.click();

  // 3. Wait for the solo modal, then click Start.
  const soloModal = document.querySelector("single-player-modal");
  await waitFor("solo modal open", () =>
    !soloModal.classList.contains("hidden"),
  );
  const startBtn = await waitFor("start button", () =>
    soloModal.querySelector("o-button"),
  );
  startBtn.click();

  // 4. The lobby join sets .in-game — but that alone doesn't prove the match
  // runs (an earlier bug: the blob worker couldn't fetch root-relative map
  // URLs, the sim silently never started, .in-game was set anyway). The
  // match is truly running when the WebGL canvas mounts and the local
  // server has executed turns.
  await waitFor("in-game class", () =>
    document.body.classList.contains("in-game"),
  120000);
  // The game mounts two elements once the match truly runs: the WebGL
  // canvas (id=webgl-debug-canvas, inserted as body's first child) and the
  // pointer-event input overlay (#game-input-overlay). .in-game alone is NOT
  // proof — an earlier bug left the class set while the sim was dead.
  await waitFor("webgl canvas mounted", () =>
    document.getElementById("webgl-debug-canvas") !== null,
  60000);
  await waitFor("input overlay mounted", () =>
    document.getElementById("game-input-overlay") !== null,
  10000);

  // Let the simulation run a few seconds of real turns.
  await sleep(5000);

  if (!document.getElementById("webgl-debug-canvas")) {
    throw new Error("canvas disappeared — match not running");
  }
  if (!document.body.classList.contains("in-game")) {
    throw new Error("game not running after start");
  }

  return "SMOKE_OK";
})()
`;

function main(): void {
  // Invoke electron.exe directly: spawning the .cmd shim without shell:true
  // throws EINVAL on Node >= 18.20 (CVE-2024-27980 hardening).
  const electronExe = path.resolve(
    __dirname,
    "..",
    "node_modules",
    "electron",
    "dist",
    "electron.exe",
  );

  // The renderer script is too large for a Windows command line — pass it as
  // a file and have the main process read it.
  const scriptFile = path.join(os.tmpdir(), `openfront-smoke-${Date.now()}.js`);
  fs.writeFileSync(scriptFile, RENDERER_SCRIPT);

  // The shell's own log file: GUI-subsystem stdout is unreliable on Windows.
  const logFile = path.join(
    os.tmpdir(),
    `openfront-smoke-main-${Date.now()}.log`,
  );
  const args = [".", "--smoke-test", `--renderer-script-file=${scriptFile}`];

  const child = spawn(electronExe, args, {
    cwd: path.resolve(__dirname, ".."),
    stdio: ["ignore", "ignore", "ignore"],
    env: {
      ...process.env,
      OPENFRONT_DESKTOP_LOG: logFile,
    },
  });

  let output = "";
  let settled = false;

  // Poll the log file for the verdict — the only channel that reliably
  // carries main-process output on Windows.
  const logPoll = setInterval(() => {
    try {
      const fresh = fs.readFileSync(logFile, "utf-8");
      output = fresh;
      if (fresh.includes("SMOKE_OK") && !settled) {
        settled = true;
        clearInterval(logPoll);
        console.log("SMOKE TEST PASSED: solo game runs fully offline");
        child.kill();
        setTimeout(() => process.exit(0), 500);
      } else if (fresh.includes("SMOKE_FAIL") && !settled) {
        settled = true;
        clearInterval(logPoll);
        console.error("SMOKE TEST FAILED");
        console.error(fresh.slice(-3000));
        child.kill();
        setTimeout(() => process.exit(1), 500);
      }
    } catch {
      /* log file may not exist yet */
    }
  }, 500);

  child.on("close", () => {
    if (settled) return;
    settled = true;
    clearInterval(logPoll);
    console.error("SMOKE TEST FAILED: electron exited before a verdict");
    console.error(output ? output.slice(-3000) : "(no log output)");
    process.exit(1);
  });

  // Global timeout: 3 minutes.
  setTimeout(() => {
    if (settled) return;
    settled = true;
    clearInterval(logPoll);
    console.error("SMOKE TEST FAILED: global timeout");
    console.error(output ? output.slice(-3000) : "(no log output)");
    child.kill();
    process.exit(1);
  }, 180000);
}

void main();
