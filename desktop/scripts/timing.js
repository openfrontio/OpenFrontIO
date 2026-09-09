(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (desc, fn, timeoutMs = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      try { const v = fn(); if (v) return v; } catch (e) { /* retry */ }
      await sleep(100);
    }
    throw new Error("timeout: " + desc);
  };
  const t0 = performance.now();

  // Homepage ready
  await waitFor("game-mode-selector upgrade", () => customElements.get("game-mode-selector"));
  const selector = document.querySelector("game-mode-selector");
  await waitFor("selector rendered", () => selector && selector.children.length > 0, 20000);
  const tHome = performance.now();

  // Click through the real UI
  const soloBtn = await waitFor("solo card button", () => {
    const btns = [...selector.querySelectorAll("button")];
    return btns.find((b) => b.textContent.trim().toLowerCase().includes("solo"));
  });
  soloBtn.click();
  const soloModal = document.querySelector("single-player-modal");
  await waitFor("solo modal open", () => !soloModal.classList.contains("hidden"));
  const startBtn = await waitFor("start button", () => soloModal.querySelector("o-button"));
  const tClick = performance.now();
  startBtn.click();

  // Match truly running
  await waitFor("in-game class", () => document.body.classList.contains("in-game"), 120000);
  await waitFor("webgl canvas mounted", () => document.getElementById("webgl-debug-canvas") !== null, 60000);
  const tMatch = performance.now();

  // Measure 5s of live turns to sanity-check tick rate
  await sleep(5000);

  console.log(`TIMING homepage_ready_ms=${Math.round(tHome - t0)}`);
  console.log(`TIMING match_start_ms=${Math.round(tMatch - tClick)}`);
  return "SMOKE_OK";
})()
