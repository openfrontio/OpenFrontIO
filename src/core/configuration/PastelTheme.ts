import { Colord, colord } from "colord";
import { PseudoRandom } from "../PseudoRandom";
import { PlayerType, Team, TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { ColorAllocator } from "./ColorAllocator";
import { botColors, fallbackColors, humanColors, nationColors } from "./Colors";
import { Theme } from "./Config";

type ColorCache = Map<string, Colord>;

export class PastelTheme implements Theme {
  private borderColorCache: ColorCache = new Map<string, Colord>();
  private rand = new PseudoRandom(123);
  private humanColorAllocator = new ColorAllocator(humanColors, fallbackColors);
  private botColorAllocator = new ColorAllocator(botColors, botColors);
  private teamColorAllocator = new ColorAllocator(humanColors, fallbackColors);
  private nationColorAllocator = new ColorAllocator(nationColors, nationColors);

  private background = colord({ r: 60, g: 60, b: 60 });
  private shore = colord({ r: 204, g: 203, b: 158 });
  private falloutColors = [
    colord({ r: 120, g: 255, b: 71 }), // Original color
    colord({ r: 130, g: 255, b: 85 }), // Slightly lighter
    colord({ r: 110, g: 245, b: 65 }), // Slightly darker
    colord({ r: 125, g: 255, b: 75 }), // Warmer tint
    colord({ r: 115, g: 250, b: 68 }), // Cooler tint
  ];
  private water = colord({ r: 70, g: 132, b: 180 });
  private shorelineWater = colord({ r: 100, g: 143, b: 255 });

  private _selfColor = colord({ r: 0, g: 255, b: 0 });
  private _allyColor = colord({ r: 255, g: 255, b: 0 });
  private _enemyColor = colord({ r: 255, g: 0, b: 0 });

  private _spawnHighlightColor = colord({ r: 255, g: 213, b: 79 });

  teamColor(team: Team): Colord {
    return this.teamColorAllocator.assignTeamColor(team);
  }

  territoryColor(player: PlayerView): Colord {
    const team = player.team();
    if (team !== null) {
      return this.teamColor(team);
    }
    if (player.type() === PlayerType.Human) {
      return this.humanColorAllocator.assignColor(player.id());
    }
    if (player.type() === PlayerType.Bot) {
      return this.botColorAllocator.assignColor(player.id());
    }
    return this.nationColorAllocator.assignColor(player.id());
  }

  textColor(player: PlayerView): string {
    return player.type() === PlayerType.Human ? "#000000" : "#4D4D4D";
  }

  specialBuildingColor(player: PlayerView): Colord {
    const tc = this.territoryColor(player).rgba;
    return colord({
      r: Math.max(tc.r - 50, 0),
      g: Math.max(tc.g - 50, 0),
      b: Math.max(tc.b - 50, 0),
    });
  }

  railroadColor(player: PlayerView): Colord {
    const tc = this.territoryColor(player).rgba;
    const color = colord({
      r: Math.max(tc.r - 10, 0),
      g: Math.max(tc.g - 10, 0),
      b: Math.max(tc.b - 10, 0),
    });
    return color;
  }

  borderColor(player: PlayerView): Colord {
    if (this.borderColorCache.has(player.id())) {
      return this.borderColorCache.get(player.id())!;
    }
    const tc = this.territoryColor(player).rgba;
    const color = colord({
      r: Math.max(tc.r - 40, 0),
      g: Math.max(tc.g - 40, 0),
      b: Math.max(tc.b - 40, 0),
    });

    this.borderColorCache.set(player.id(), color);
    return color;
  }

  defendedBorderColors(player: PlayerView): { light: Colord; dark: Colord } {
    return {
      light: this.territoryColor(player).darken(0.2),
      dark: this.territoryColor(player).darken(0.4),
    };
  }

  focusedBorderColor(): Colord {
    return colord({ r: 230, g: 230, b: 230 });
  }

  terrainColor(gm: GameMap, tile: TileRef): Colord {
    const mag = gm.magnitude(tile);
    if (gm.isShore(tile)) {
      return this.shore;
    }
    switch (gm.terrainType(tile)) {
      case TerrainType.Ocean:
      case TerrainType.Lake:
        const w = this.water.rgba;
        if (gm.isShoreline(tile) && gm.isWater(tile)) {
          return this.shorelineWater;
        }
        return colord({
          r: Math.max(w.r - 10 + (11 - Math.min(mag, 10)), 0),
          g: Math.max(w.g - 10 + (11 - Math.min(mag, 10)), 0),
          b: Math.max(w.b - 10 + (11 - Math.min(mag, 10)), 0),
        });

      case TerrainType.Plains:
        return colord({
          r: 190,
          g: 220 - 2 * mag,
          b: 138,
        });
      case TerrainType.Highland:
        return colord({
          r: 200 + 2 * mag,
          g: 183 + 2 * mag,
          b: 138 + 2 * mag,
        });
      case TerrainType.Mountain:
        return colord({
          r: 230 + mag / 2,
          g: 230 + mag / 2,
          b: 230 + mag / 2,
        });
    }
  }

  backgroundColor(): Colord {
    return this.background;
  }

  falloutColor(): Colord {
    return this.rand.randElement(this.falloutColors);
  }

  font(): string {
    return "Overpass, sans-serif";
  }

  selfColor(): Colord {
    return this._selfColor;
  }
  allyColor(): Colord {
    return this._allyColor;
  }
  enemyColor(): Colord {
    return this._enemyColor;
  }

  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }
}
