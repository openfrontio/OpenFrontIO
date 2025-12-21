import { Colord, colord } from "colord";
import { TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PastelTheme } from "./PastelTheme";

export class PastelThemeDark extends PastelTheme {
  private darkShore = colord("rgb(134,133,88)");

  private darkWater = colord("rgb(14,11,30)");
  private darkShorelineWater = colord("rgb(50,50,50)");

  // | Terrain Type      | Magnitude | Base Color Logic                                | Visual Description    |
  // | :---------------- | :-------- | :---------------------------------------------- | :-------------------- |
  // | **Shore (Land)**  | N/A       | Fixed: `rgb(134, 133, 88)`                    | Dark olive.           |
  // | **Plains**        | 0 - 9     | `rgb(140, 170, 88)` - `rgb(140, 152, 88)`   | Muted green.          |
  // | **Highland**      | 10 - 19   | `rgb(170, 153, 108)` - `rgb(188, 171, 126)` | Dark earth tone.      |
  // | **Mountain**      | 20 - 30   | `rgb(190, 190, 190)` - `rgb(195, 195, 195)` | Dark gray.            |
  // | **Water (Shore)** | 0         | Fixed: `rgb(50, 50, 50)`                      | Dark gray/black.      |
  // | **Water (Deep)**  | 1 - 10+   | `rgb(22, 19, 38)` - `rgb(14, 11, 30)`       | Very dark blue/black. |

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
