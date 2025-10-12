import { Colord, colord } from "colord";
import { TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PastelTheme } from "./PastelTheme";

export class PastelThemeDark extends PastelTheme {
  private darkShore = colord({ r: 134, g: 133, b: 88 });

  private darkWater = colord({ r: 14, g: 11, b: 30 });
  private darkShorelineWater = colord({ r: 50, g: 50, b: 50 });

  terrainColor(gm: GameMap, tile: TileRef): Colord {
    const mag = gm.magnitude(tile);
    if (gm.isShore(tile)) {
      return this.darkShore;
    }
    switch (gm.terrainType(tile)) {
      case TerrainType.Ocean:
      case TerrainType.Lake: {
        const w = this.darkWater.rgba;
        if (gm.isShoreline(tile) && gm.isWater(tile)) {
          return this.darkShorelineWater;
        }
        if (gm.magnitude(tile) < 10) {
          return colord({
            r: Math.max(w.r + 9 - mag, 0),
            g: Math.max(w.g + 9 - mag, 0),
            b: Math.max(w.b + 9 - mag, 0),
          });
        }
        return this.darkWater;
      }
      case TerrainType.Plains:
        return colord({
          r: 140,
          g: 170 - 2 * mag,
          b: 88,
        });
      case TerrainType.Highland:
        return colord({
          r: 150 + 2 * mag,
          g: 133 + 2 * mag,
          b: 88 + 2 * mag,
        });
      case TerrainType.Mountain:
        return colord({
          r: 180 + mag / 2,
          g: 180 + mag / 2,
          b: 180 + mag / 2,
        });
    }
  }
}
