import { Colord, colord } from "colord";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { PlayerInfo, PlayerType, TerrainType } from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { Theme } from "./Config";

export const pastelThemeDark = new (class implements Theme {
  private rand = new PseudoRandom(123);

  private background = colord({ r: 0, g: 0, b: 0 });
  private land = colord({ r: 194, g: 193, b: 148 });
  private shore = colord({ r: 134, g: 133, b: 88 });
  private falloutColors = [
    colord({ r: 120, g: 255, b: 71 }), // Original color
    colord({ r: 130, g: 255, b: 85 }), // Slightly lighter
    colord({ r: 110, g: 245, b: 65 }), // Slightly darker
    colord({ r: 125, g: 255, b: 75 }), // Warmer tint
    colord({ r: 115, g: 250, b: 68 }), // Cooler tint
  ];
  private water = colord({ r: 14, g: 11, b: 30 });
  private shorelineWater = colord({ r: 50, g: 50, b: 50 });

  private territoryColors: Colord[] = [
    colord({ r: 230, g: 100, b: 100 }), // Bright Red
    colord({ r: 100, g: 180, b: 230 }), // Sky Blue
    colord({ r: 230, g: 180, b: 80 }), // Golden Yellow
    colord({ r: 180, g: 100, b: 230 }), // Purple
    colord({ r: 80, g: 200, b: 120 }), // Emerald Green
    colord({ r: 230, g: 130, b: 180 }), // Pink
    colord({ r: 100, g: 160, b: 80 }), // Olive Green
    colord({ r: 230, g: 150, b: 100 }), // Peach
    colord({ r: 80, g: 130, b: 190 }), // Navy Blue
    colord({ r: 210, g: 210, b: 100 }), // Lime Yellow
    colord({ r: 190, g: 100, b: 130 }), // Maroon
    colord({ r: 100, g: 210, b: 210 }), // Turquoise
    colord({ r: 210, g: 140, b: 80 }), // Light Orange
    colord({ r: 150, g: 110, b: 190 }), // Lavender
    colord({ r: 180, g: 210, b: 120 }), // Light Green
    colord({ r: 210, g: 100, b: 160 }), // Hot Pink
    colord({ r: 100, g: 140, b: 110 }), // Sea Green
    colord({ r: 230, g: 180, b: 180 }), // Light Pink
    colord({ r: 120, g: 120, b: 190 }), // Periwinkle
    colord({ r: 190, g: 170, b: 100 }), // Sand
    colord({ r: 100, g: 180, b: 160 }), // Aquamarine
    colord({ r: 210, g: 160, b: 200 }), // Orchid
    colord({ r: 170, g: 190, b: 100 }), // Yellow Green
    colord({ r: 100, g: 130, b: 150 }), // Steel Blue
    colord({ r: 230, g: 140, b: 140 }), // Salmon
    colord({ r: 140, g: 180, b: 220 }), // Light Blue
    colord({ r: 200, g: 160, b: 110 }), // Tan
    colord({ r: 180, g: 130, b: 180 }), // Plum
    colord({ r: 130, g: 200, b: 130 }), // Light Sea Green
    colord({ r: 220, g: 120, b: 120 }), // Coral
    colord({ r: 120, g: 160, b: 200 }), // Cornflower Blue
    colord({ r: 200, g: 200, b: 140 }), // Khaki
    colord({ r: 160, g: 120, b: 160 }), // Purple Gray
    colord({ r: 140, g: 180, b: 140 }), // Dark Sea Green
    colord({ r: 200, g: 130, b: 110 }), // Dark Salmon
    colord({ r: 130, g: 170, b: 190 }), // Cadet Blue
    colord({ r: 190, g: 180, b: 160 }), // Tan Gray
    colord({ r: 170, g: 140, b: 190 }), // Medium Purple
    colord({ r: 160, g: 190, b: 160 }), // Pale Green
    colord({ r: 190, g: 150, b: 130 }), // Rosy Brown
    colord({ r: 140, g: 150, b: 180 }), // Light Slate Gray
    colord({ r: 180, g: 170, b: 140 }), // Dark Khaki
    colord({ r: 150, g: 130, b: 150 }), // Thistle
    colord({ r: 170, g: 190, b: 180 }), // Pale Blue Green
    colord({ r: 190, g: 140, b: 150 }), // Puce
    colord({ r: 130, g: 180, b: 170 }), // Medium Aquamarine
    colord({ r: 180, g: 160, b: 180 }), // Mauve
    colord({ r: 160, g: 180, b: 140 }), // Dark Olive Green
    colord({ r: 170, g: 150, b: 170 }), // Dusty Rose
    colord({ r: 100, g: 180, b: 230 }), // Sky Blue
    colord({ r: 230, g: 180, b: 80 }), // Golden Yellow
    colord({ r: 180, g: 100, b: 230 }), // Purple
    colord({ r: 80, g: 200, b: 120 }), // Emerald Green
    colord({ r: 230, g: 130, b: 180 }), // Pink
    colord({ r: 100, g: 160, b: 80 }), // Olive Green
    colord({ r: 230, g: 150, b: 100 }), // Peach
    colord({ r: 80, g: 130, b: 190 }), // Navy Blue
    colord({ r: 210, g: 210, b: 100 }), // Lime Yellow
    colord({ r: 190, g: 100, b: 130 }), // Maroon
    colord({ r: 100, g: 210, b: 210 }), // Turquoise
    colord({ r: 210, g: 140, b: 80 }), // Light Orange
    colord({ r: 150, g: 110, b: 190 }), // Lavender
    colord({ r: 180, g: 210, b: 120 }), // Light Green
    colord({ r: 210, g: 100, b: 160 }), // Hot Pink
    colord({ r: 100, g: 140, b: 110 }), // Sea Green
    colord({ r: 230, g: 180, b: 180 }), // Light Pink
    colord({ r: 120, g: 120, b: 190 }), // Periwinkle
    colord({ r: 190, g: 170, b: 100 }), // Sand
    colord({ r: 100, g: 180, b: 160 }), // Aquamarine
    colord({ r: 210, g: 160, b: 200 }), // Orchid
    colord({ r: 170, g: 190, b: 100 }), // Yellow Green
    colord({ r: 100, g: 130, b: 150 }), // Steel Blue
    colord({ r: 230, g: 140, b: 140 }), // Salmon
    colord({ r: 140, g: 180, b: 220 }), // Light Blue
    colord({ r: 200, g: 160, b: 110 }), // Tan
    colord({ r: 180, g: 130, b: 180 }), // Plum
    colord({ r: 130, g: 200, b: 130 }), // Light Sea Green
    colord({ r: 220, g: 120, b: 120 }), // Coral
    colord({ r: 120, g: 160, b: 200 }), // Cornflower Blue
    colord({ r: 200, g: 200, b: 140 }), // Khaki
    colord({ r: 160, g: 120, b: 160 }), // Purple Gray
    colord({ r: 140, g: 180, b: 140 }), // Dark Sea Green
    colord({ r: 200, g: 130, b: 110 }), // Dark Salmon
    colord({ r: 130, g: 170, b: 190 }), // Cadet Blue
    colord({ r: 190, g: 180, b: 160 }), // Tan Gray
    colord({ r: 170, g: 140, b: 190 }), // Medium Purple
    colord({ r: 160, g: 190, b: 160 }), // Pale Green
    colord({ r: 190, g: 150, b: 130 }), // Rosy Brown
    colord({ r: 140, g: 150, b: 180 }), // Light Slate Gray
    colord({ r: 180, g: 170, b: 140 }), // Dark Khaki
    colord({ r: 150, g: 130, b: 150 }), // Thistle
    colord({ r: 170, g: 190, b: 180 }), // Pale Blue Green
    colord({ r: 190, g: 140, b: 150 }), // Puce
    colord({ r: 130, g: 180, b: 170 }), // Medium Aquamarine
    colord({ r: 180, g: 160, b: 180 }), // Mauve
    colord({ r: 160, g: 180, b: 140 }), // Dark Olive Green
    colord({ r: 170, g: 150, b: 170 }), // Dusty Rose
  ];

  private humanColors: Colord[] = [
    // Original set
    colord({ r: 235, g: 75, b: 75 }), // Bright Red
    colord({ r: 67, g: 190, b: 84 }), // Fresh Green
    colord({ r: 59, g: 130, b: 246 }), // Royal Blue
    colord({ r: 245, g: 158, b: 11 }), // Amber
    colord({ r: 236, g: 72, b: 153 }), // Deep Pink
    colord({ r: 48, g: 178, b: 180 }), // Teal
    colord({ r: 168, g: 85, b: 247 }), // Vibrant Purple
    colord({ r: 251, g: 191, b: 36 }), // Marigold
    colord({ r: 74, g: 222, b: 128 }), // Mint
    colord({ r: 239, g: 68, b: 68 }), // Crimson
    colord({ r: 34, g: 197, b: 94 }), // Emerald
    colord({ r: 96, g: 165, b: 250 }), // Sky Blue
    colord({ r: 249, g: 115, b: 22 }), // Tangerine
    colord({ r: 192, g: 132, b: 252 }), // Lavender
    colord({ r: 45, g: 212, b: 191 }), // Turquoise
    colord({ r: 244, g: 114, b: 182 }), // Rose
    colord({ r: 132, g: 204, b: 22 }), // Lime
    colord({ r: 56, g: 189, b: 248 }), // Light Blue
    colord({ r: 234, g: 179, b: 8 }), // Sunflower
    colord({ r: 217, g: 70, b: 239 }), // Fuchsia
    colord({ r: 16, g: 185, b: 129 }), // Sea Green
    colord({ r: 251, g: 146, b: 60 }), // Light Orange
    colord({ r: 147, g: 51, b: 234 }), // Bright Purple
    colord({ r: 79, g: 70, b: 229 }), // Indigo
    colord({ r: 245, g: 101, b: 101 }), // Coral
    colord({ r: 134, g: 239, b: 172 }), // Light Green
    colord({ r: 59, g: 130, b: 246 }), // Cerulean
    colord({ r: 253, g: 164, b: 175 }), // Salmon Pink
    colord({ r: 147, g: 197, b: 253 }), // Powder Blue
    colord({ r: 252, g: 211, b: 77 }), // Golden
    colord({ r: 190, g: 92, b: 251 }), // Amethyst
    colord({ r: 82, g: 183, b: 136 }), // Jade
    colord({ r: 248, g: 113, b: 113 }), // Warm Red
    colord({ r: 99, g: 202, b: 253 }), // Azure
    colord({ r: 240, g: 171, b: 252 }), // Orchid
    colord({ r: 163, g: 230, b: 53 }), // Yellow Green
    colord({ r: 234, g: 88, b: 12 }), // Burnt Orange
    colord({ r: 125, g: 211, b: 252 }), // Crystal Blue
    colord({ r: 251, g: 113, b: 133 }), // Watermelon
    colord({ r: 52, g: 211, b: 153 }), // Spearmint
    colord({ r: 167, g: 139, b: 250 }), // Periwinkle
    colord({ r: 245, g: 158, b: 11 }), // Honey
    colord({ r: 110, g: 231, b: 183 }), // Seafoam
    colord({ r: 233, g: 213, b: 255 }), // Light Lilac
    colord({ r: 202, g: 138, b: 4 }), // Rich Gold
    colord({ r: 151, g: 255, b: 187 }), // Fresh Mint
    colord({ r: 220, g: 38, b: 38 }), // Ruby
    colord({ r: 124, g: 58, b: 237 }), // Royal Purple
    colord({ r: 45, g: 212, b: 191 }), // Ocean
    colord({ r: 252, g: 165, b: 165 }), // Peach

    // Additional 50 colors
    colord({ r: 179, g: 136, b: 255 }), // Light Purple
    colord({ r: 133, g: 77, b: 14 }), // Chocolate
    colord({ r: 52, g: 211, b: 153 }), // Aquamarine
    colord({ r: 234, g: 179, b: 8 }), // Mustard
    colord({ r: 236, g: 72, b: 153 }), // Hot Pink
    colord({ r: 147, g: 197, b: 253 }), // Sky
    colord({ r: 249, g: 115, b: 22 }), // Pumpkin
    colord({ r: 167, g: 139, b: 250 }), // Iris
    colord({ r: 16, g: 185, b: 129 }), // Pine
    colord({ r: 251, g: 146, b: 60 }), // Mango
    colord({ r: 192, g: 132, b: 252 }), // Wisteria
    colord({ r: 79, g: 70, b: 229 }), // Sapphire
    colord({ r: 245, g: 101, b: 101 }), // Salmon
    colord({ r: 134, g: 239, b: 172 }), // Spring Green
    colord({ r: 59, g: 130, b: 246 }), // Ocean Blue
    colord({ r: 253, g: 164, b: 175 }), // Rose Gold
    colord({ r: 16, g: 185, b: 129 }), // Forest
    colord({ r: 252, g: 211, b: 77 }), // Sunshine
    colord({ r: 190, g: 92, b: 251 }), // Grape
    colord({ r: 82, g: 183, b: 136 }), // Eucalyptus
    colord({ r: 248, g: 113, b: 113 }), // Cherry
    colord({ r: 99, g: 202, b: 253 }), // Arctic
    colord({ r: 240, g: 171, b: 252 }), // Lilac
    colord({ r: 163, g: 230, b: 53 }), // Chartreuse
    colord({ r: 234, g: 88, b: 12 }), // Rust
    colord({ r: 125, g: 211, b: 252 }), // Ice Blue
    colord({ r: 251, g: 113, b: 133 }), // Strawberry
    colord({ r: 52, g: 211, b: 153 }), // Sage
    colord({ r: 167, g: 139, b: 250 }), // Violet
    colord({ r: 245, g: 158, b: 11 }), // Apricot
    colord({ r: 110, g: 231, b: 183 }), // Mint Green
    colord({ r: 233, g: 213, b: 255 }), // Thistle
    colord({ r: 202, g: 138, b: 4 }), // Bronze
    colord({ r: 151, g: 255, b: 187 }), // Pistachio
    colord({ r: 220, g: 38, b: 38 }), // Fire Engine
    colord({ r: 124, g: 58, b: 237 }), // Electric Purple
    colord({ r: 45, g: 212, b: 191 }), // Caribbean
    colord({ r: 252, g: 165, b: 165 }), // Melon
    colord({ r: 168, g: 85, b: 247 }), // Byzantium
    colord({ r: 74, g: 222, b: 128 }), // Kelly Green
    colord({ r: 239, g: 68, b: 68 }), // Cardinal
    colord({ r: 34, g: 197, b: 94 }), // Shamrock
    colord({ r: 96, g: 165, b: 250 }), // Marina
    colord({ r: 249, g: 115, b: 22 }), // Carrot
    colord({ r: 192, g: 132, b: 252 }), // Heliotrope
    colord({ r: 45, g: 212, b: 191 }), // Lagoon
    colord({ r: 244, g: 114, b: 182 }), // Bubble Gum
    colord({ r: 132, g: 204, b: 22 }), // Apple
    colord({ r: 56, g: 189, b: 248 }), // Electric Blue
    colord({ r: 234, g: 179, b: 8 }), // Daffodil
  ];

  private _selfColor = colord({ r: 0, g: 255, b: 0 });
  private _allyColor = colord({ r: 255, g: 255, b: 0 });
  private _enemyColor = colord({ r: 255, g: 0, b: 0 });

  private _spawnHighlightColor = colord({ r: 255, g: 213, b: 79 });

  territoryColor(playerInfo: PlayerInfo): Colord {
    if (playerInfo.playerType == PlayerType.Human) {
      return this.humanColors[
        simpleHash(playerInfo.name) % this.humanColors.length
      ];
    }
    return this.territoryColors[
      simpleHash(playerInfo.name) % this.territoryColors.length
    ];
  }

  textColor(playerInfo: PlayerInfo): string {
    return playerInfo.playerType == PlayerType.Human ? "#ffffff" : "#dbdbdb";
  }

  borderColor(playerInfo: PlayerInfo): Colord {
    const tc = this.territoryColor(playerInfo).rgba;
    return colord({
      r: Math.max(tc.r - 40, 0),
      g: Math.max(tc.g - 40, 0),
      b: Math.max(tc.b - 40, 0),
    });
  }
  defendedBorderColor(playerInfo: PlayerInfo): Colord {
    const bc = this.borderColor(playerInfo).rgba;
    return colord({
      r: Math.max(bc.r - 40, 0),
      g: Math.max(bc.g - 40, 0),
      b: Math.max(bc.b - 40, 0),
    });
  }

  terrainColor(gm: GameMap, tile: TileRef): Colord {
    let mag = gm.magnitude(tile);
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
})();
