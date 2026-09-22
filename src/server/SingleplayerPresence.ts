import { ClientPlatform, ClientPlatformSchema, GameID } from "../core/Schemas";

// A singleplayer game runs entirely in the browser: this worker never hosts
// it, so the only way to know one is in progress is the client saying so.
// The client POSTs a heartbeat once a minute for the life of the game; a
// game is counted while its last beat is younger than the TTL. A worker
// restart or a deploy loses the map, and it refills within one interval —
// no reconnect logic, and no zeroed gauge that climbs back over 20 minutes.
export const SINGLEPLAYER_HEARTBEAT_INTERVAL_MS = 60_000;
export const SINGLEPLAYER_PRESENCE_TTL_MS =
  3 * SINGLEPLAYER_HEARTBEAT_INTERVAL_MS;

type Platform = ClientPlatform | "unknown";

export class SingleplayerPresence {
  private readonly lastSeen = new Map<
    GameID,
    { at: number; platform: Platform }
  >();

  constructor(
    private readonly ttlMs: number = SINGLEPLAYER_PRESENCE_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  heartbeat(gameID: GameID, platform: Platform): void {
    this.lastSeen.set(gameID, { at: this.now(), platform });
  }

  /** Games heard from within the TTL, per platform, zeros included. */
  activeGamesByPlatform(): Map<Platform, number> {
    const counts = new Map<Platform, number>(
      [...ClientPlatformSchema.options, "unknown" as const].map((p) => [p, 0]),
    );
    const cutoff = this.now() - this.ttlMs;
    for (const [gameID, { at, platform }] of this.lastSeen) {
      if (at < cutoff) {
        this.lastSeen.delete(gameID);
        continue;
      }
      counts.set(platform, counts.get(platform)! + 1);
    }
    return counts;
  }

  activeGames(): number {
    let total = 0;
    for (const n of this.activeGamesByPlatform().values()) total += n;
    return total;
  }
}
