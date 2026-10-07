import { whenPageIdle } from "./WhenPageIdle";

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
  whenPageIdle(() => void loadGameClient().catch(() => {}));
}
