/**
 * The game client (the lobby connection, the HUD, the renderer) is its own
 * chunk, so the homepage loads without it. prefetchGameClient fetches it in
 * the background once the page has loaded, so a join rarely waits on it.
 */
export function loadGameClient(): Promise<typeof import("./ClientGameRunner")> {
  return import("./ClientGameRunner");
}

export function prefetchGameClient(): void {
  // A failed prefetch is left to the join that needs the chunk.
  const prefetch = () => void loadGameClient().catch(() => {});
  const whenIdle = () => {
    if ("requestIdleCallback" in window) {
      requestIdleCallback(prefetch, { timeout: 5000 });
    } else {
      setTimeout(prefetch, 1000);
    }
  };
  if (document.readyState === "complete") {
    whenIdle();
  } else {
    window.addEventListener("load", whenIdle, { once: true });
  }
}
