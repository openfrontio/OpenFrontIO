import { GameID } from "../core/Schemas";
import { ClientEnv } from "./ClientEnv";
import { clientPlatform } from "./ClientPlatform";

// The server counts a game while its last beat is younger than three
// intervals (SingleplayerPresence on the worker), so a missed beat or a
// worker restart costs at most a couple of minutes of undercount.
export const SINGLEPLAYER_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Tells the game server a singleplayer game is in progress, once now and
 * then once a minute, so the worker can export a concurrent-games gauge.
 * The game runs entirely in the browser, so this is the server's only
 * signal that it exists.
 *
 * The beat goes to the same host and worker the game's own socket would
 * use, resolved from the id: a tab pinned to a draining deployment keeps
 * reporting to that deployment, and a desktop shell reports to its injected
 * host. On the static apex page no server is known yet and the URL cannot
 * be built; that beat is skipped rather than aimed at the page host.
 *
 * Returns a function that stops the heartbeat.
 */
export function startSingleplayerHeartbeat(gameID: GameID): () => void {
  const beat = () => {
    try {
      const url = `${ClientEnv.gameHttpBase(gameID)}/${ClientEnv.gameWorkerPath(gameID)}/api/singleplayer/${gameID}/heartbeat`;
      void fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: clientPlatform() }),
      }).catch(() => {});
    } catch {
      // No game server known (NoServerError): nothing to report to.
    }
  };
  beat();
  const interval = setInterval(beat, SINGLEPLAYER_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(interval);
}
