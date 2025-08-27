import { Colord, colord } from "colord";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerType, Team, TerrainType } from "../game/Game";
import { botColors, fallbackColors, humanColors, nationColors } from "./Colors";
import { ColorAllocator } from "./ColorAllocator";
import { PlayerView } from "../game/GameView";
import { PseudoRandom } from "../PseudoRandom";
import { Theme } from "./Config";

type ColorCache = Map<string, Colord>;

export class PastelThemeDark implements Theme {
  private readonly borderColorCache: ColorCache = new Map<string, Colord>();
  private readonly rand = new PseudoRandom(123);
  private readonly humanColorAllocator = new ColorAllocator(humanColors, fallbackColors);
  private readonly botColorAllocator = new ColorAllocator(botColors, botColors);
  private readonly teamColorAllocator = new ColorAllocator(humanColors, fallbackColors);
  private readonly nationColorAllocator = new ColorAllocator(nationColors, nationColors);

  /* eslint-disable sort-keys */
  private readonly background = colord({ r: 0, g: 0, b: 0 });
  private readonly shore = colord({ r: 134, g: 133, b: 88 });
  private readonly falloutColors = [
    colord({ r: 120, g: 255, b: 71 }), // Original color
    colord({ r: 130, g: 255, b: 85 }), // Slightly lighter
    colord({ r: 110, g: 245, b: 65 }), // Slightly darker
    colord({ r: 125, g: 255, b: 75 }), // Warmer tint
    colord({ r: 115, g: 250, b: 68 }), // Cooler tint
  ];
  private readonly water = colord({ r: 14, g: 11, b: 30 });
  private readonly shorelineWater = colord({ r: 50, g: 50, b: 50 });

  private readonly _selfColor = colord({ r: 255, g: 255, b: 0 });
  private readonly _allyColor = colord({ r: 0, g: 255, b: 0 });
  private readonly _neutralColor = colord({ r: 128, g: 128, b: 128 });
  private readonly _enemyColor = colord({ r: 255, g: 0, b: 0 });

  private readonly _colorBlindSelfColor = colord({ r: 255, g: 200, b: 0 });
  private readonly _colorBlindAllyColor = colord({ r: 0, g: 180, b: 255 });
  private readonly _colorBlindNeutralColor = colord({ r: 160, g: 160, b: 160 });
  private readonly _colorBlindEnemyColor = colord({ r: 230, g: 0, b: 255 });

  private readonly _spawnHighlightColor = colord({ r: 255, g: 213, b: 79 });
  private readonly _colorBlindSpawnHighlightColor = colord({ r: 255, g: 255, b: 120 });
  /* eslint-enable sort-keys */

  teamColor(team: Team): Colord {
    return this.teamColorAllocator.assignTeamColor(team);
  }

  territoryColor(player: PlayerView): Colord {
    const team = player.team();
    if (team !== null) {
      return this.teamColorAllocator.assignTeamPlayerColor(team, player.id());
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
    return player.type() === PlayerType.Human ? "#ffffff" : "#e6e6e6";
  }

  /* eslint-disable sort-keys */
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
    const cached = this.borderColorCache.get(player.id());
    if (cached !== undefined) return cached;

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
    return colord({ r: 255, g: 255, b: 255 });
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
        if (gm.magnitude(tile) < 10) {
          return colord({
            r: Math.max(w.r + 9 - mag, 0),
            g: Math.max(w.g + 9 - mag, 0),
            b: Math.max(w.b + 9 - mag, 0),
          });
        }
        return this.water;
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
  /* eslint-enable sort-keys */

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
  neutralColor(): Colord {
    return this._neutralColor;
  }
  enemyColor(): Colord {
    return this._enemyColor;
  }

  colorBlindSelfColor(): Colord {
    return this._colorBlindSelfColor;
  }
  colorBlindAllyColor(): Colord {
    return this._colorBlindAllyColor;
  }
  colorBlindNeutralColor(): Colord {
    return this._colorBlindNeutralColor;
  }
  colorBlindEnemyColor(): Colord {
    return this._colorBlindEnemyColor;
  }

  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }

  colorBlindSpawnHighlightColor(): Colord {
    return this._colorBlindSpawnHighlightColor;
  }
}
