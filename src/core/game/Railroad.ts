import { Game, Tick } from "./Game";
import { TileRef } from "./GameMap";
import { GameUpdateType, RailTile, RailType } from "./GameUpdates";
import { TrainStation } from "./TrainStation";

const CONGESTION_EMA_ALPHA = 0.05;

export class Railroad {
  private trainCount: number = 0;
  private congestionEma: number = 0;
  private lastCongestionTick: Tick | null = null;
  // Geometry of this railroad once construction is computed
  private railTiles: RailTile[] | null = null;
  // Last fare used for client-side coloring
  private lastFare: bigint | null = null;

  constructor(
    public from: TrainStation,
    public to: TrainStation,
    public tiles: TileRef[],
  ) {}

  delete(game: Game) {
    const railTiles: RailTile[] = this.tiles.map((tile) => ({
      tile,
      railType: RailType.VERTICAL,
    }));
    game.addUpdate({
      type: GameUpdateType.RailroadEvent,
      isActive: false,
      railTiles,
    });
    this.from.removeRailroad(this);
    this.to.removeRailroad(this);
  }

  incrementTrainCount(currentTick: Tick): void {
    this.trainCount++;
    this.updateCongestionEma(currentTick);
  }

  decrementTrainCount(currentTick: Tick): void {
    this.trainCount = Math.max(0, this.trainCount - 1);
    this.updateCongestionEma(currentTick);
  }

  private updateCongestionEma(currentTick: Tick): void {
    if (this.lastCongestionTick === null) {
      this.lastCongestionTick = currentTick;
      this.congestionEma = this.trainCount;
      return;
    }

    const deltaTicks = currentTick - this.lastCongestionTick;
    this.lastCongestionTick = currentTick;

    if (deltaTicks <= 0) {
      // Fallback to single-step EMA if ticks didn't advance
      const alpha = CONGESTION_EMA_ALPHA;
      this.congestionEma =
        alpha * this.trainCount + (1 - alpha) * this.congestionEma;
      return;
    }

    const base = 1 - CONGESTION_EMA_ALPHA;
    const decay = Math.pow(base, deltaTicks);
    const alpha = 1 - decay;

    this.congestionEma = alpha * this.trainCount + decay * this.congestionEma;
  }

  getLength(): number {
    return this.tiles.length;
  }

  getFare(): bigint {
    const baseLengthFare = 10;
    const baseCongestionFare = BigInt(2000);
    const lengthFare = BigInt(this.getLength() * baseLengthFare); // Base fare proportional to length
    // Busy railroads should be more expensive: each train adds a congestion premium
    const effectiveCongestion = Math.max(0, Math.round(this.congestionEma));
    const congestionFactor = BigInt(1 + effectiveCongestion); // 1,2,3,...
    const congestionFare = baseCongestionFare * congestionFactor;
    return lengthFare + congestionFare;
  }

  setRailTiles(tiles: RailTile[]) {
    this.railTiles = tiles;
  }

  /**
   * Emit a fare update to clients if the fare has changed significantly.
   * Currently uses a 10% relative-change threshold.
   */
  updateFare(game: Game) {
    if (!this.railTiles || this.railTiles.length === 0) return;
    const newFare = this.getFare();
    if (this.lastFare !== null) {
      const prev = this.lastFare;
      const diff = newFare > prev ? newFare - prev : prev - newFare;
      const threshold = prev / 10n; // 10%
      if (threshold > 0n && diff < threshold) {
        this.lastFare = newFare;
        return;
      }
    }
    this.lastFare = newFare;

    const numericFare = Number(newFare);
    const railTilesWithFare: RailTile[] = this.railTiles.map((t) => ({
      ...t,
      fare: numericFare,
    }));

    game.addUpdate({
      type: GameUpdateType.RailroadEvent,
      isActive: true,
      isFareUpdate: true,
      railTiles: railTilesWithFare,
    });
  }
}

export function getOrientedRailroad(
  from: TrainStation,
  to: TrainStation,
): OrientedRailroad | null {
  const railroad = from.getRailroadTo(to);
  if (!railroad) return null;
  // If tiles are stored from -> to, we go forward when railroad.to === to
  const forward = railroad.to === to;
  return new OrientedRailroad(railroad, forward);
}

/**
 * Wrap a railroad with a direction so it always starts at tiles[0]
 */
export class OrientedRailroad {
  private tiles: TileRef[] = [];
  constructor(
    private railroad: Railroad,
    private forward: boolean,
  ) {
    this.tiles = this.forward
      ? this.railroad.tiles
      : [...this.railroad.tiles].reverse();
  }

  getTiles(): TileRef[] {
    return this.tiles;
  }

  getRailroad(): Railroad {
    return this.railroad;
  }

  getStart(): TrainStation {
    return this.forward ? this.railroad.from : this.railroad.to;
  }

  getEnd(): TrainStation {
    return this.forward ? this.railroad.to : this.railroad.from;
  }
}
