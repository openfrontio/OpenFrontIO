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
  console.log("USERFLOW: start");

  // 1. Wait for homepage components
  await waitFor("game-mode-selector upgrade", () => customElements.get("game-mode-selector"));
  const selector = document.querySelector("game-mode-selector");
  await waitFor("selector rendered", () => selector && selector.children.length > 0, 20000);
  console.log("USERFLOW: homepage rendered");

  // 2. Find the real Solo card button (desktop grid) and click it
  //    The Solo card is the col-span-2 button in the hidden sm:grid row.
  const soloBtn = await waitFor("solo card button", () => {
    const btns = [...selector.querySelectorAll("button")];
    return btns.find(b => b.textContent.trim().toLowerCase().includes("solo"));
  });
  console.log("USERFLOW: clicking solo card");
  soloBtn.click();

  // 3. Wait for the solo modal to open
  const soloModal = document.querySelector("single-player-modal");
  await waitFor("solo modal open", () => !soloModal.classList.contains("hidden"));
  console.log("USERFLOW: solo modal open");

  // 4. Click the Start button (o-button inside the modal footer)
  const startBtn = await waitFor("start button", () => soloModal.querySelector("o-button"));
  console.log("USERFLOW: clicking start");
  startBtn.click();
  console.log("USERFLOW: start clicked");

  // 5. Wait for the game to enter in-game state
  await waitFor("in-game class", () => document.body.classList.contains("in-game"), 120000);
  console.log("USERFLOW: IN GAME");

  // 6. Run 8 seconds of turns
  await sleep(8000);

  // 7. Inspect state: canvas, game stats, anything visible
  const canvas = document.querySelector("#app canvas, canvas");
  console.log("USERFLOW: canvas present: " + !!canvas);
  if (canvas) {
    console.log("USERFLOW: canvas size: " + canvas.width + "x" + canvas.height);
  }
  console.log("USERFLOW: still in-game: " + document.body.classList.contains("in-game"));

  return "READY_FOR_SCREENSHOT";
})()
