import { Theme } from "../configuration/Config";
import { Game, UnitType } from "../game/Game";
import { GameUpdateViewData } from "../game/GameUpdates";
import { GameView } from "../game/GameView";
import { TerrainMapData } from "../game/TerrainMapLoader";

/**
 * Adapter that makes Game work as GameView for rendering purposes.
 * Provides the interface that GroundTruthData and rendering passes need,
 * without requiring the full GameView infrastructure.
 */
export class GameViewAdapter implements Partial<GameView> {
  private tileStateCache: Uint16Array | null = null;
  private terrainDataCache: Uint8Array | null = null;
  private lastUpdate: GameUpdateViewData | null = null;

  constructor(
    private game: Game,
    private mapData: TerrainMapData,
    private theme: Theme,
  ) {}

  /**
   * Update adapter with latest game update data.
   * Invalidates caches so they're recomputed on next access.
   */
  update(gu: GameUpdateViewData): void {
    this.lastUpdate = gu;
    // Invalidate caches when updated
    this.tileStateCache = null;
    this.terrainDataCache = null;
  }

  config() {
    return this.game.config();
  }

  width(): number {
    return this.game.width();
  }

  height(): number {
    return this.game.height();
  }

  x(tile: bigint): number {
    return this.game.x(tile);
  }

  y(tile: bigint): number {
    return this.game.y(tile);
  }

  units(...types: UnitType[]): any[] {
    return this.game.units(...types);
  }

  /**
   * Build tile state view from game.
   * Cached until next update.
   */
  tileStateView(): Uint16Array {
    if (this.tileStateCache) {
      return this.tileStateCache;
    }
    // Build tile state from game
    const width = this.game.width();
    const height = this.game.height();
    const state = new Uint16Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = this.game.ref(x, y);
        const owner = this.game.owner(tile);
        const ownerId = owner ? owner.smallID() : 0;
        const terrain = this.game.terrain(tile);
        const terrainType = terrain.type();
        const terrainMag = terrain.magnitude();
        // Pack state: ownerId (12 bits) | terrainType (2 bits) | terrainMag (2 bits)
        state[y * width + x] =
          (ownerId & 0xfff) |
          ((terrainType & 0x3) << 12) |
          ((terrainMag & 0x3) << 14);
      }
    }
    this.tileStateCache = state;
    return state;
  }

  /**
   * Build terrain data view from game.
   * Cached until next update.
   */
  terrainDataView(): Uint8Array {
    if (this.terrainDataCache) {
      return this.terrainDataCache;
    }
    // Build terrain data from game
    const width = this.game.width();
    const height = this.game.height();
    const terrainData = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = this.game.ref(x, y);
        const terrain = this.game.terrain(tile);
        terrainData[y * width + x] = terrain.type();
      }
    }
    this.terrainDataCache = terrainData;
    return terrainData;
  }

  /**
   * Convert Game players to PlayerView-like objects for rendering.
   * Computes colors from theme directly (no PlayerView needed).
   */
  playerViews(): any[] {
    const theme = this.game.config().theme();
    return this.game.players().map((p) => {
      // Get default colors from theme
      const defaultTerritoryColor = theme.territoryColor(p as any);
      const defaultBorderColor = theme.borderColor(defaultTerritoryColor);
      const territoryRgb = defaultTerritoryColor.toRgb();
      const borderRgb = defaultBorderColor.toRgb();

      return {
        smallID: () => p.smallID(),
        territoryColor: () => ({
          rgba: {
            r: Math.round(territoryRgb.r),
            g: Math.round(territoryRgb.g),
            b: Math.round(territoryRgb.b),
            a: Math.round((territoryRgb.a ?? 1) * 255),
          },
        }),
        borderColor: () => ({
          rgba: {
            r: Math.round(borderRgb.r),
            g: Math.round(borderRgb.g),
            b: Math.round(borderRgb.b),
            a: Math.round((borderRgb.a ?? 1) * 255),
          },
        }),
      };
    });
  }

  /**
   * Get my player for highlighting (returns null in worker context).
   */
  myPlayer(): any | null {
    // Return null for now - this is used for highlighting
    // Could be implemented if we track clientID in worker
    return null;
  }

  /**
   * Get recently updated tiles from last game update.
   */
  recentlyUpdatedTiles(): bigint[] {
    if (!this.lastUpdate) {
      return [];
    }
    return Array.from(this.lastUpdate.packedTileUpdates);
  }
}
