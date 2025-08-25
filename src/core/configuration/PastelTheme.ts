import { Colord, colord } from "colord";
import { PlayerType, Team, TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PlayerView } from "../game/GameView";
import { PseudoRandom } from "../PseudoRandom";
import { ColorAllocator } from "./ColorAllocator";
import { botColors, fallbackColors, humanColors, nationColors } from "./Colors";
import { Theme } from "./Config";

type ColorCache = Map<string, Colord>;

export class PastelTheme implements Theme {
  private readonly borderColorCache: ColorCache = new Map<string, Colord>();
  private readonly rand = new PseudoRandom(123);
  private readonly humanColorAllocator = new ColorAllocator(
    humanColors,
    fallbackColors,
  );
  private readonly botColorAllocator = new ColorAllocator(botColors, botColors);
  private readonly teamColorAllocator = new ColorAllocator(
    humanColors,
    fallbackColors,
  );
  private readonly nationColorAllocator = new ColorAllocator(
    nationColors,
    nationColors,
  );

  private readonly background = colord({ b: 60, g: 60, r: 60 });
  private readonly shore = colord({ b: 158, g: 203, r: 204 });
  private readonly falloutColors = [
    colord({ b: 71, g: 255, r: 120 }), // Original color
    colord({ b: 85, g: 255, r: 130 }), // Slightly lighter
    colord({ b: 65, g: 245, r: 110 }), // Slightly darker
    colord({ b: 75, g: 255, r: 125 }), // Warmer tint
    colord({ b: 68, g: 250, r: 115 }), // Cooler tint
  ];
  private readonly water = colord({ b: 180, g: 132, r: 70 });
  private readonly shorelineWater = colord({ b: 255, g: 143, r: 100 });

  private readonly _selfColor = colord({ b: 0, g: 255, r: 0 });
  private readonly _allyColor = colord({ b: 0, g: 255, r: 255 });
  private readonly _neutralColor = colord({ b: 128, g: 128, r: 128 });
  private readonly _enemyColor = colord({ b: 0, g: 0, r: 255 });

  private readonly _spawnHighlightColor = colord({ b: 79, g: 213, r: 255 });

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
    return player.type() === PlayerType.Human ? "#000000" : "#4D4D4D";
  }

  specialBuildingColor(player: PlayerView): Colord {
    const tc = this.territoryColor(player).rgba;

    return colord({
      b: Math.max(tc.b - 50, 0),
      g: Math.max(tc.g - 50, 0),
      r: Math.max(tc.r - 50, 0),
    });
  }

  railroadColor(player: PlayerView): Colord {
    const tc = this.territoryColor(player).rgba;

    const color = colord({
      b: Math.max(tc.b - 10, 0),
      g: Math.max(tc.g - 10, 0),
      r: Math.max(tc.r - 10, 0),
    });

    return color;
  }

  borderColor(player: PlayerView): Colord {
    const cached = this.borderColorCache.get(player.id());
    if (cached !== undefined) return cached;

    const tc = this.territoryColor(player).rgba;

    const color = colord({
      b: Math.max(tc.b - 40, 0),
      g: Math.max(tc.g - 40, 0),
      r: Math.max(tc.r - 40, 0),
    });

    this.borderColorCache.set(player.id(), color);
    return color;
  }

  defendedBorderColors(player: PlayerView): { light: Colord; dark: Colord } {
    return {
      dark: this.territoryColor(player).darken(0.4),
      light: this.territoryColor(player).darken(0.2),
    };
  }

  focusedBorderColor(): Colord {
    return colord({ b: 230, g: 230, r: 230 });
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
          b: Math.max(w.b - 10 + (11 - Math.min(mag, 10)), 0),
          g: Math.max(w.g - 10 + (11 - Math.min(mag, 10)), 0),
          r: Math.max(w.r - 10 + (11 - Math.min(mag, 10)), 0),
        });

      case TerrainType.Plains:
        return colord({
          b: 138,
          g: 220 - 2 * mag,
          r: 190,
        });
      case TerrainType.Highland:
        return colord({
          b: 138 + 2 * mag,
          g: 183 + 2 * mag,
          r: 200 + 2 * mag,
        });
      case TerrainType.Mountain:
        return colord({
          b: 230 + mag / 2,
          g: 230 + mag / 2,
          r: 230 + mag / 2,
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
  neutralColor(): Colord {
    return this._neutralColor;
  }
  enemyColor(): Colord {
    return this._enemyColor;
  }

  spawnHighlightColor(): Colord {
    return this._spawnHighlightColor;
  }
}
