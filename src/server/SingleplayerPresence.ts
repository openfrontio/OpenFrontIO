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
// The route is unauthenticated and any well-formed id is accepted, so cap
// how many distinct games a worker will track: well above what one worker
// legitimately sees, small enough that a flood cannot grow the map.
export const SINGLEPLAYER_PRESENCE_MAX_GAMES = 50_000;

type Platform = ClientPlatform | "unknown";

export class SingleplayerPresence {
  private readonly lastSeen = new Map<
    GameID,
    { at: number; platform: Platform }
  >();

  private lastPrunedAt = -Infinity;

  constructor(
    private readonly ttlMs: number = SINGLEPLAYER_PRESENCE_TTL_MS,
    private readonly now: () => number = Date.now,
    private readonly maxGames: number = SINGLEPLAYER_PRESENCE_MAX_GAMES,
  ) {}

  heartbeat(gameID: GameID, platform: Platform): void {
    // Prune here too, not only when the gauge reads: with OTel off nothing
    // reads it, and the map would grow by one entry per id ever seen. A
    // full scan per beat would be quadratic under a flood, so throttle it
    // to once an interval — except at the cap, where a stale entry must not
    // cost a real game its slot.
    const now = this.now();
    if (
      now - this.lastPrunedAt >= SINGLEPLAYER_HEARTBEAT_INTERVAL_MS ||
      this.lastSeen.size >= this.maxGames
    ) {
      this.prune();
    }
    if (!this.lastSeen.has(gameID) && this.lastSeen.size >= this.maxGames) {
      return;
    }
    this.lastSeen.set(gameID, { at: now, platform });
  }

  /** Games heard from within the TTL, per platform, zeros included. */
  activeGamesByPlatform(): Map<Platform, number> {
    this.prune();
    const counts = new Map<Platform, number>(
      [...ClientPlatformSchema.options, "unknown" as const].map((p) => [p, 0]),
    );
    for (const { platform } of this.lastSeen.values()) {
      counts.set(platform, counts.get(platform)! + 1);
    }
    return counts;
  }

  private prune(): void {
    this.lastPrunedAt = this.now();
    const cutoff = this.lastPrunedAt - this.ttlMs;
    for (const [gameID, { at }] of this.lastSeen) {
      if (at < cutoff) this.lastSeen.delete(gameID);
    }
  }

  activeGames(): number {
    let total = 0;
    for (const n of this.activeGamesByPlatform().values()) total += n;
    return total;
  }
}
