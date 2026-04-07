import { GameMapType } from "../core/game/Game";
import { PublicGameType } from "../core/Schemas";

interface JoinRateSample {
  joinRate: number; // clients per second
  timestamp: number;
}

/**
 * Tracks how quickly players join lobbies for each map, per game type.
 * Maintains a rolling window of recent samples and exposes a multiplier
 * that MapPlaylist can use to boost popular maps.
 */
export class JoinRateTracker {
  // gameType -> map -> recent samples
  private samples = new Map<
    PublicGameType,
    Map<GameMapType, JoinRateSample[]>
  >();

  constructor(
    private readonly maxSamplesPerMap: number = 30,
    private readonly sampleMaxAgeMs: number = 2 * 60 * 60 * 1000, // 2 hours
    private readonly alpha: number = 0.5, // max boost/reduction factor
  ) {}

  /**
   * Record a completed lobby's join rate.
   * Call this when a lobby transitions from Lobby → Active.
   */
  recordLobby(
    gameType: PublicGameType,
    map: GameMapType,
    numClients: number,
    lobbyDurationMs: number,
  ): void {
    if (lobbyDurationMs <= 0 || numClients <= 0) return;

    const joinRate = numClients / (lobbyDurationMs / 1000);

    if (!this.samples.has(gameType)) {
      this.samples.set(gameType, new Map());
    }
    const byMap = this.samples.get(gameType)!;
    if (!byMap.has(map)) {
      byMap.set(map, []);
    }

    const mapSamples = byMap.get(map)!;
    mapSamples.push({ joinRate, timestamp: Date.now() });

    // Evict old samples
    this.evict(mapSamples);
  }

  /**
   * Returns a frequency multiplier for each map that has data.
   * Maps with above-average join rates get a multiplier > 1,
   * maps with below-average get < 1. The range is [1 - alpha, 1 + alpha].
   * Maps with no data return no entry (caller uses base frequency as-is).
   */
  getFrequencyMultipliers(gameType: PublicGameType): Map<GameMapType, number> {
    const result = new Map<GameMapType, number>();
    const byMap = this.samples.get(gameType);
    if (!byMap) return result;

    // Compute average join rate per map
    const avgRates = new Map<GameMapType, number>();
    for (const [map, samples] of byMap) {
      this.evict(samples);
      if (samples.length === 0) continue;
      const avg =
        samples.reduce((sum, s) => sum + s.joinRate, 0) / samples.length;
      avgRates.set(map, avg);
    }

    if (avgRates.size === 0) return result;

    // Global average across all maps
    let globalSum = 0;
    for (const rate of avgRates.values()) {
      globalSum += rate;
    }
    const globalAvg = globalSum / avgRates.size;

    if (globalAvg <= 0) return result;

    // Compute multiplier: 1 + alpha * (mapAvg - globalAvg) / globalAvg
    // Clamped to [1 - alpha, 1 + alpha]
    for (const [map, avg] of avgRates) {
      const normalized = (avg - globalAvg) / globalAvg;
      const multiplier = Math.max(
        1 - this.alpha,
        Math.min(1 + this.alpha, 1 + this.alpha * normalized),
      );
      result.set(map, multiplier);
    }

    return result;
  }

  private evict(samples: JoinRateSample[]): void {
    const now = Date.now();
    // Remove expired samples from the front
    while (
      samples.length > 0 &&
      now - samples[0].timestamp > this.sampleMaxAgeMs
    ) {
      samples.shift();
    }
    // Cap at max samples (keep most recent)
    while (samples.length > this.maxSamplesPerMap) {
      samples.shift();
    }
  }
}
