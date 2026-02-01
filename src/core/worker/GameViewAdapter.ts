import { Theme } from "../configuration/Config";
import { Game, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { GameUpdateViewData } from "../game/GameUpdates";
import { GameView } from "../game/GameView";
import { TerrainMapData } from "../game/TerrainMapLoader";

/**
 * Adapter that makes Game work as GameView for rendering purposes.
 * Provides the interface that GroundTruthData and rendering passes need,
 * without requiring the full GameView infrastructure.
 */
export class GameViewAdapter implements Partial<GameView> {
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

  x(tile: TileRef): number {
    return this.game.x(tile);
  }

  y(tile: TileRef): number {
    return this.game.y(tile);
  }

  units(...types: UnitType[]): any[] {
    return this.game.units(...types);
  }

  /**
   * Return the authoritative tile state view.
   *
   * Important: this must be the live backing buffer, because GPU update passes
   * read from it when individual tiles are marked dirty.
   */
  tileStateView(): Uint16Array {
    return this.game.tileStateView();
  }

  /**
   * Return the immutable terrain data view.
   */
  terrainDataView(): Uint8Array {
    return this.game.terrainDataView();
  }

  /**
   * Convert Game players to PlayerView-like objects for rendering.
   * Computes colors from theme directly (no PlayerView needed).
   */
  playerViews(): any[] {
    const theme = this.theme;
    return this.game.players().map((player) => {
      const defaultTerritoryColor = theme.territoryColor(player as any);
      const defaultBorderColor = theme.borderColor(defaultTerritoryColor);
      const territoryRgb = defaultTerritoryColor.toRgb();
      const borderRgb = defaultBorderColor.toRgb();

      const view = {
        player,
        smallID: () => player.smallID(),
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
        hasEmbargo: (other: any) => {
          const otherPlayer = other?.player;
          if (!otherPlayer) return false;
          return (
            player.hasEmbargoAgainst(otherPlayer) ||
            otherPlayer.hasEmbargoAgainst(player)
          );
        },
        isFriendly: (other: any) => {
          const otherPlayer = other?.player;
          if (!otherPlayer) return false;
          return player.isFriendly(otherPlayer);
        },
      };

      return view;
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
  recentlyUpdatedTiles(): TileRef[] {
    if (!this.lastUpdate) {
      return [];
    }
    // packedTileUpdates encode [tileRef << 16 | state] as bigint.
    const packed = this.lastUpdate.packedTileUpdates;
    const out: TileRef[] = new Array(packed.length);
    for (let i = 0; i < packed.length; i++) {
      out[i] = Number(packed[i] >> 16n);
    }
    return out;
  }
}
