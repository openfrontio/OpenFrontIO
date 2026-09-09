(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (desc, fn, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { const v = fn(); if (v) return v; } catch (e) { /* retry */ }
      await sleep(250);
    }
    throw new Error("timeout: " + desc);
  };
  const log = (m) => console.log("BOUNTY_E2E: " + m);

  // 1. Start a solo game through the real Solo card, with randomSpawn set
  // via the modal's reactive state (equivalent to a user clicking the
  // toggle; auto-spawns at game start). Solo spawn phase = 100 ticks (10s).
  await waitFor("game-mode-selector upgrade", () => customElements.get("game-mode-selector"));
  const selector = document.querySelector("game-mode-selector");
  await waitFor("selector rendered", () => selector && selector.children.length > 0, 20000);
  const soloBtn = await waitFor("solo card button", () => {
    const btns = [...selector.querySelectorAll("button")];
    return btns.find((b) => b.textContent.trim().toLowerCase().includes("solo"));
  });
  soloBtn.click();
  const soloModal = document.querySelector("single-player-modal");
  await waitFor("solo modal open", () => !soloModal.classList.contains("hidden"));
  soloModal.randomSpawn = true;
  await sleep(300);
  const startBtn = await waitFor("start button", () => soloModal.querySelector("o-button"));
  startBtn.click();
  await waitFor("in-game class", () => document.body.classList.contains("in-game"), 120000);
  log("game started");

  const overlay = await waitFor("input overlay", () =>
    document.getElementById("game-input-overlay"),
  );
  const rightClick = (x, y) => {
    overlay.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y, button: 2,
    }));
  };

  const W = window.innerWidth, H = window.innerHeight;
  const grid = [];
  for (const fx of [0.3, 0.5, 0.7]) for (const fy of [0.3, 0.5, 0.7]) grid.push([W * fx, H * fy]);

  // 2. Let spawn phase end (100 ticks) plus bot expansion, so radial menus
  // work and enemy territory exists.
  await sleep(16000);
  log("spawn settled");

  // 3. Grid-search right-clicks for an enemy tile: bounty slice appears.
  let bountyPath = null;
  outer: for (let round = 0; round < 6; round++) {
    for (const [x, y] of grid) {
      rightClick(x, y);
      await sleep(600);
      const hit = document.querySelector('path[data-id="place_bounty"]');
      if (hit) { bountyPath = hit; break outer; }
    }
    await sleep(3000); // let the sim advance between sweeps
  }
  if (!bountyPath) throw new Error("no enemy tile found with a bounty slice");
  log("bounty slice found");

  // 4. Click the bounty slice -> SendResourceModal opens in bounty mode.
  bountyPath.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(800);
  const modal = await waitFor("bounty modal", () =>
    document.querySelector("send-resource-modal"),
  10000);
  if (modal.mode !== "bounty") throw new Error("modal opened in mode " + modal.mode);
  log("bounty modal open, player gold basis: " + modal.total);

  // 5. Wait for enough gold for the minimum bounty, then confirm at Max.
  await waitFor(
    "enough gold",
    () => Number(modal.total ?? 0) >= 1000,
    60000,
  );
  const maxBtn = await waitFor("max preset", () => {
    const btns = [...modal.querySelectorAll("button")];
    return btns.find((b) => /^(max|100%)$/i.test(b.textContent.trim()));
  });
  maxBtn.click();
  await sleep(300);
  const sendBtn = await waitFor("confirm button", () => {
    const btns = [...modal.querySelectorAll("button")];
    return btns.find((b) => /^(send|confirm|place bounty)$/i.test(b.textContent.trim()));
  });
  sendBtn.click();
  log("bounty confirmed");
  await sleep(4000);

  // 6. The BountyPlacedEvent must arrive back as a toast in EventsDisplay —
  // the full UI -> core -> worker -> UI loop, end to end.
  const eventsText = (document.querySelector("events-display")?.textContent ?? "").toLowerCase();
  if (!eventsText.includes("bounty")) {
    throw new Error("no bounty toast in events display; text was: " + eventsText.slice(0, 300));
  }
  log("bounty toast visible");

  return "SMOKE_OK";
})()
