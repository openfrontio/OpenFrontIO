import { Colord, colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";

extend([lchPlugin]);
extend([labPlugin]);

export const red = colord({ h: 0, l: 56, s: 82 });
export const blue = colord({ h: 224, l: 58, s: 100 });
export const teal = colord({ h: 172, l: 50, s: 66 });
export const purple = colord({ h: 271, l: 56, s: 81 });
export const yellow = colord({ h: 45, l: 47, s: 93 });
export const orange = colord({ h: 25, l: 53, s: 95 });
export const green = colord({ h: 128, l: 50, s: 49 });
export const botColor = colord({ h: 36, l: 80, s: 10 });

export const redTeamColors: Colord[] = generateTeamColors(red);
export const blueTeamColors: Colord[] = generateTeamColors(blue);
export const tealTeamColors: Colord[] = generateTeamColors(teal);
export const purpleTeamColors: Colord[] = generateTeamColors(purple);
export const yellowTeamColors: Colord[] = generateTeamColors(yellow);
export const orangeTeamColors: Colord[] = generateTeamColors(orange);
export const greenTeamColors: Colord[] = generateTeamColors(green);
export const botTeamColors: Colord[] = [colord(botColor)];

function generateTeamColors(baseColor: Colord): Colord[] {
  const { h: baseHue, s: baseSaturation, l: baseLightness } = baseColor.toHsl();
  const colorCount = 64;

  return Array.from({ length: colorCount }, (_, index) => {
    const progression = index / (colorCount - 1);

    const saturation = baseSaturation * (1.0 - 0.3 * progression);
    const lightness = Math.min(100, baseLightness + progression * 30);

    return colord({
      h: baseHue,
      l: lightness,
      s: saturation,
    });
  });
}

export const nationColors: Colord[] = [
  colord({ b: 100, g: 100, r: 230 }), // Bright Red
  colord({ b: 230, g: 180, r: 100 }), // Sky Blue
  colord({ b: 80, g: 180, r: 230 }), // Golden Yellow
  colord({ b: 230, g: 100, r: 180 }), // Purple
  colord({ b: 120, g: 200, r: 80 }), // Emerald Green
  colord({ b: 180, g: 130, r: 230 }), // Pink
  colord({ b: 80, g: 160, r: 100 }), // Olive Green
  colord({ b: 100, g: 150, r: 230 }), // Peach
  colord({ b: 190, g: 130, r: 80 }), // Navy Blue
  colord({ b: 100, g: 210, r: 210 }), // Lime Yellow
  colord({ b: 130, g: 100, r: 190 }), // Maroon
  colord({ b: 210, g: 210, r: 100 }), // Turquoise
  colord({ b: 80, g: 140, r: 210 }), // Light Orange
  colord({ b: 190, g: 110, r: 150 }), // Lavender
  colord({ b: 120, g: 210, r: 180 }), // Light Green
  colord({ b: 160, g: 100, r: 210 }), // Hot Pink
  colord({ b: 110, g: 140, r: 100 }), // Sea Green
  colord({ b: 180, g: 180, r: 230 }), // Light Pink
  colord({ b: 190, g: 120, r: 120 }), // Periwinkle
  colord({ b: 100, g: 170, r: 190 }), // Sand
  colord({ b: 160, g: 180, r: 100 }), // Aquamarine
  colord({ b: 200, g: 160, r: 210 }), // Orchid
  colord({ b: 100, g: 190, r: 170 }), // Yellow Green
  colord({ b: 150, g: 130, r: 100 }), // Steel Blue
  colord({ b: 140, g: 140, r: 230 }), // Salmon
  colord({ b: 220, g: 180, r: 140 }), // Light Blue
  colord({ b: 110, g: 160, r: 200 }), // Tan
  colord({ b: 180, g: 130, r: 180 }), // Plum
  colord({ b: 130, g: 200, r: 130 }), // Light Sea Green
  colord({ b: 120, g: 120, r: 220 }), // Coral
  colord({ b: 200, g: 160, r: 120 }), // Cornflower Blue
  colord({ b: 140, g: 200, r: 200 }), // Khaki
  colord({ b: 160, g: 120, r: 160 }), // Purple Gray
  colord({ b: 140, g: 180, r: 140 }), // Dark Sea Green
  colord({ b: 110, g: 130, r: 200 }), // Dark Salmon
  colord({ b: 190, g: 170, r: 130 }), // Cadet Blue
  colord({ b: 160, g: 180, r: 190 }), // Tan Gray
  colord({ b: 190, g: 140, r: 170 }), // Medium Purple
  colord({ b: 160, g: 190, r: 160 }), // Pale Green
  colord({ b: 130, g: 150, r: 190 }), // Rosy Brown
  colord({ b: 180, g: 150, r: 140 }), // Light Slate Gray
  colord({ b: 140, g: 170, r: 180 }), // Dark Khaki
  colord({ b: 150, g: 130, r: 150 }), // Thistle
  colord({ b: 180, g: 190, r: 170 }), // Pale Blue Green
  colord({ b: 150, g: 140, r: 190 }), // Puce
  colord({ b: 170, g: 180, r: 130 }), // Medium Aquamarine
  colord({ b: 180, g: 160, r: 180 }), // Mauve
  colord({ b: 140, g: 180, r: 160 }), // Dark Olive Green
  colord({ b: 170, g: 150, r: 170 }), // Dusty Rose
  colord({ b: 230, g: 180, r: 100 }), // Sky Blue
  colord({ b: 80, g: 180, r: 230 }), // Golden Yellow
  colord({ b: 230, g: 100, r: 180 }), // Purple
  colord({ b: 120, g: 200, r: 80 }), // Emerald Green
  colord({ b: 180, g: 130, r: 230 }), // Pink
  colord({ b: 80, g: 160, r: 100 }), // Olive Green
  colord({ b: 100, g: 150, r: 230 }), // Peach
  colord({ b: 190, g: 130, r: 80 }), // Navy Blue
  colord({ b: 100, g: 210, r: 210 }), // Lime Yellow
  colord({ b: 130, g: 100, r: 190 }), // Maroon
  colord({ b: 210, g: 210, r: 100 }), // Turquoise
  colord({ b: 80, g: 140, r: 210 }), // Light Orange
  colord({ b: 190, g: 110, r: 150 }), // Lavender
  colord({ b: 120, g: 210, r: 180 }), // Light Green
  colord({ b: 160, g: 100, r: 210 }), // Hot Pink
  colord({ b: 110, g: 140, r: 100 }), // Sea Green
  colord({ b: 180, g: 180, r: 230 }), // Light Pink
  colord({ b: 190, g: 120, r: 120 }), // Periwinkle
  colord({ b: 100, g: 170, r: 190 }), // Sand
  colord({ b: 160, g: 180, r: 100 }), // Aquamarine
  colord({ b: 200, g: 160, r: 210 }), // Orchid
  colord({ b: 100, g: 190, r: 170 }), // Yellow Green
  colord({ b: 150, g: 130, r: 100 }), // Steel Blue
  colord({ b: 140, g: 140, r: 230 }), // Salmon
  colord({ b: 220, g: 180, r: 140 }), // Light Blue
  colord({ b: 110, g: 160, r: 200 }), // Tan
  colord({ b: 180, g: 130, r: 180 }), // Plum
  colord({ b: 130, g: 200, r: 130 }), // Light Sea Green
  colord({ b: 120, g: 120, r: 220 }), // Coral
  colord({ b: 200, g: 160, r: 120 }), // Cornflower Blue
  colord({ b: 140, g: 200, r: 200 }), // Khaki
  colord({ b: 160, g: 120, r: 160 }), // Purple Gray
  colord({ b: 140, g: 180, r: 140 }), // Dark Sea Green
  colord({ b: 110, g: 130, r: 200 }), // Dark Salmon
  colord({ b: 190, g: 170, r: 130 }), // Cadet Blue
  colord({ b: 160, g: 180, r: 190 }), // Tan Gray
  colord({ b: 190, g: 140, r: 170 }), // Medium Purple
  colord({ b: 160, g: 190, r: 160 }), // Pale Green
  colord({ b: 130, g: 150, r: 190 }), // Rosy Brown
  colord({ b: 180, g: 150, r: 140 }), // Light Slate Gray
  colord({ b: 140, g: 170, r: 180 }), // Dark Khaki
  colord({ b: 150, g: 130, r: 150 }), // Thistle
  colord({ b: 180, g: 190, r: 170 }), // Pale Blue Green
  colord({ b: 150, g: 140, r: 190 }), // Puce
  colord({ b: 170, g: 180, r: 130 }), // Medium Aquamarine
  colord({ b: 180, g: 160, r: 180 }), // Mauve
  colord({ b: 140, g: 180, r: 160 }), // Dark Olive Green
  colord({ b: 170, g: 150, r: 170 }), // Dusty Rose
];

// Bright pastel theme with 64 colors
export const humanColors: Colord[] = [
  colord({ b: 129, g: 185, r: 16 }), // Sea Green
  colord({ b: 94, g: 197, r: 34 }), // Emerald
  colord({ b: 191, g: 212, r: 45 }), // Turquoise
  colord({ b: 180, g: 178, r: 48 }), // Teal
  colord({ b: 153, g: 211, r: 52 }), // Spearmint
  colord({ b: 248, g: 189, r: 56 }), // Light Blue
  colord({ b: 246, g: 130, r: 59 }), // Royal Blue
  colord({ b: 84, g: 190, r: 67 }), // Fresh Green
  colord({ b: 128, g: 222, r: 74 }), // Mint
  colord({ b: 229, g: 70, r: 79 }), // Indigo
  colord({ b: 136, g: 183, r: 82 }), // Jade
  colord({ b: 250, g: 165, r: 96 }), // Sky Blue
  colord({ b: 253, g: 202, r: 99 }), // Azure
  colord({ b: 183, g: 231, r: 110 }), // Seafoam
  colord({ b: 237, g: 58, r: 124 }), // Royal Purple
  colord({ b: 252, g: 211, r: 125 }), // Crystal Blue
  colord({ b: 22, g: 204, r: 132 }), // Lime
  colord({ b: 14, g: 77, r: 133 }), // Chocolate
  colord({ b: 172, g: 239, r: 134 }), // Light Green
  colord({ b: 234, g: 51, r: 147 }), // Bright Purple
  colord({ b: 253, g: 197, r: 147 }), // Powder Blue
  colord({ b: 187, g: 255, r: 151 }), // Fresh Mint
  colord({ b: 53, g: 230, r: 163 }), // Yellow Green
  colord({ b: 250, g: 139, r: 167 }), // Periwinkle
  colord({ b: 247, g: 85, r: 168 }), // Vibrant Purple
  colord({ b: 255, g: 136, r: 179 }), // Light Purple
  colord({ b: 201, g: 255, r: 186 }), // Pale Emerald
  colord({ b: 251, g: 92, r: 190 }), // Amethyst
  colord({ b: 252, g: 132, r: 192 }), // Lavender
  colord({ b: 4, g: 138, r: 202 }), // Rich Gold
  colord({ b: 255, g: 225, r: 202 }), // Baby Blue
  colord({ b: 255, g: 204, r: 204 }), // Soft Lavender Blue
  colord({ b: 239, g: 70, r: 217 }), // Fuchsia
  colord({ b: 38, g: 38, r: 220 }), // Ruby
  colord({ b: 255, g: 220, r: 220 }), // Meringue Blue
  colord({ b: 250, g: 240, r: 220 }), // Ice Blue
  colord({ b: 210, g: 250, r: 230 }), // Pastel Lime
  colord({ b: 250, g: 255, r: 230 }), // Mint Whisper
  colord({ b: 255, g: 213, r: 233 }), // Light Lilac
  colord({ b: 12, g: 88, r: 234 }), // Burnt Orange
  colord({ b: 8, g: 179, r: 234 }), // Sunflower
  colord({ b: 75, g: 75, r: 235 }), // Bright Red
  colord({ b: 153, g: 72, r: 236 }), // Deep Pink
  colord({ b: 68, g: 68, r: 239 }), // Crimson
  colord({ b: 252, g: 171, r: 240 }), // Orchid
  colord({ b: 200, g: 240, r: 240 }), // Light Khaki
  colord({ b: 182, g: 114, r: 244 }), // Rose
  colord({ b: 101, g: 101, r: 245 }), // Coral
  colord({ b: 11, g: 158, r: 245 }), // Amber
  colord({ b: 113, g: 113, r: 248 }), // Warm Red
  colord({ b: 22, g: 115, r: 249 }), // Tangerine
  colord({ b: 225, g: 215, r: 250 }), // Cotton Candy
  colord({ b: 210, g: 250, r: 250 }), // Pastel Lemon
  colord({ b: 133, g: 113, r: 251 }), // Watermelon
  colord({ b: 60, g: 146, r: 251 }), // Light Orange
  colord({ b: 36, g: 191, r: 251 }), // Marigold
  colord({ b: 245, g: 235, r: 251 }), // Rose Powder
  colord({ b: 165, g: 165, r: 252 }), // Peach
  colord({ b: 77, g: 211, r: 252 }), // Golden
  colord({ b: 175, g: 164, r: 253 }), // Salmon Pink
  colord({ b: 229, g: 204, r: 255 }), // Blush Pink
  colord({ b: 186, g: 223, r: 255 }), // Apricot Cream
  colord({ b: 200, g: 240, r: 255 }), // Vanilla
];

export const botColors: Colord[] = [
  colord({ b: 120, g: 120, r: 190 }), // Muted Red
  colord({ b: 190, g: 160, r: 120 }), // Muted Sky Blue
  colord({ b: 100, g: 160, r: 190 }), // Muted Golden Yellow
  colord({ b: 190, g: 120, r: 160 }), // Muted Purple
  colord({ b: 130, g: 170, r: 100 }), // Muted Emerald Green
  colord({ b: 160, g: 130, r: 190 }), // Muted Pink
  colord({ b: 100, g: 150, r: 120 }), // Muted Olive Green
  colord({ b: 120, g: 140, r: 190 }), // Muted Peach
  colord({ b: 160, g: 120, r: 100 }), // Muted Navy Blue
  colord({ b: 120, g: 170, r: 170 }), // Muted Lime Yellow
  colord({ b: 130, g: 120, r: 160 }), // Muted Maroon
  colord({ b: 170, g: 170, r: 120 }), // Muted Turquoise
  colord({ b: 100, g: 140, r: 170 }), // Muted Light Orange
  colord({ b: 160, g: 120, r: 140 }), // Muted Lavender
  colord({ b: 130, g: 170, r: 150 }), // Muted Light Green
  colord({ b: 140, g: 120, r: 170 }), // Muted Hot Pink
  colord({ b: 120, g: 140, r: 120 }), // Muted Sea Green
  colord({ b: 160, g: 160, r: 180 }), // Muted Light Pink
  colord({ b: 160, g: 130, r: 130 }), // Muted Periwinkle
  colord({ b: 120, g: 150, r: 160 }), // Muted Sand
  colord({ b: 150, g: 160, r: 120 }), // Muted Aquamarine
  colord({ b: 170, g: 150, r: 170 }), // Muted Orchid
  colord({ b: 120, g: 160, r: 150 }), // Muted Yellow Green
  colord({ b: 140, g: 130, r: 120 }), // Muted Steel Blue
  colord({ b: 140, g: 140, r: 180 }), // Muted Salmon
  colord({ b: 170, g: 160, r: 140 }), // Muted Light Blue
  colord({ b: 130, g: 150, r: 170 }), // Muted Tan
  colord({ b: 160, g: 130, r: 160 }), // Muted Plum
  colord({ b: 130, g: 170, r: 130 }), // Muted Light Sea Green
  colord({ b: 130, g: 130, r: 170 }), // Muted Coral
  colord({ b: 170, g: 150, r: 130 }), // Muted Cornflower Blue
  colord({ b: 140, g: 170, r: 170 }), // Muted Khaki
  colord({ b: 150, g: 130, r: 150 }), // Muted Purple Gray
  colord({ b: 140, g: 160, r: 140 }), // Muted Dark Sea Green
  colord({ b: 120, g: 130, r: 170 }), // Muted Dark Salmon
  colord({ b: 160, g: 150, r: 130 }), // Muted Cadet Blue
  colord({ b: 150, g: 160, r: 160 }), // Muted Tan Gray
  colord({ b: 160, g: 140, r: 150 }), // Muted Medium Purple
  colord({ b: 150, g: 170, r: 150 }), // Muted Pale Green
  colord({ b: 130, g: 140, r: 160 }), // Muted Rosy Brown
  colord({ b: 160, g: 150, r: 140 }), // Muted Light Slate Gray
  colord({ b: 140, g: 150, r: 160 }), // Muted Dark Khaki
  colord({ b: 140, g: 130, r: 140 }), // Muted Thistle
  colord({ b: 160, g: 160, r: 150 }), // Muted Pale Blue Green
  colord({ b: 150, g: 140, r: 160 }), // Muted Puce
  colord({ b: 150, g: 160, r: 130 }), // Muted Medium Aquamarine
  colord({ b: 160, g: 150, r: 160 }), // Muted Mauve
  colord({ b: 140, g: 160, r: 150 }), // Muted Dark Olive Green
  colord({ b: 150, g: 140, r: 150 }), // Muted Dusty Rose
];

// Fallback colors for when the color palette is exhausted. Currently 100 colors.
export const fallbackColors: Colord[] = [
  colord({ b: 0, g: 5, r: 0 }), // Black Mint
  colord({ b: 0, g: 15, r: 0 }), // Deep Forest
  colord({ b: 0, g: 25, r: 0 }), // Jungle
  colord({ b: 0, g: 35, r: 0 }), // Dark Emerald
  colord({ b: 0, g: 45, r: 0 }), // Green Moss
  colord({ b: 0, g: 55, r: 0 }), // Moss Shadow
  colord({ b: 0, g: 65, r: 0 }), // Dark Meadow
  colord({ b: 0, g: 75, r: 0 }), // Forest Fern
  colord({ b: 0, g: 85, r: 0 }), // Pine Leaf
  colord({ b: 0, g: 95, r: 0 }), // Shadow Grass
  colord({ b: 0, g: 105, r: 0 }), // Classic Green
  colord({ b: 0, g: 115, r: 0 }), // Deep Lime
  colord({ b: 0, g: 125, r: 0 }), // Dense Leaf
  colord({ b: 0, g: 135, r: 0 }), // Basil Green
  colord({ b: 0, g: 145, r: 0 }), // Organic Green
  colord({ b: 0, g: 155, r: 0 }), // Bitter Herb
  colord({ b: 0, g: 165, r: 0 }), // Raw Spinach
  colord({ b: 0, g: 175, r: 0 }), // Woodland
  colord({ b: 0, g: 185, r: 0 }), // Spring Weed
  colord({ b: 5, g: 195, r: 0 }), // Apple Stem
  colord({ b: 10, g: 205, r: 0 }), // Crisp Lettuce
  colord({ b: 15, g: 215, r: 0 }), // Vibrant Green
  colord({ b: 20, g: 225, r: 0 }), // Bright Herb
  colord({ b: 25, g: 235, r: 0 }), // Green Splash
  colord({ b: 30, g: 245, r: 0 }), // Mint Leaf
  colord({ b: 35, g: 255, r: 0 }), // Fresh Mint
  colord({ b: 45, g: 255, r: 10 }), // Neon Grass
  colord({ b: 55, g: 255, r: 20 }), // Lemon Balm
  colord({ b: 65, g: 255, r: 30 }), // Juicy Green
  colord({ b: 75, g: 255, r: 40 }), // Pear Tint
  colord({ b: 85, g: 255, r: 50 }), // Avocado Pastel
  colord({ b: 95, g: 255, r: 60 }), // Lime Glow
  colord({ b: 105, g: 255, r: 70 }), // Light Leaf
  colord({ b: 115, g: 255, r: 80 }), // Soft Fern
  colord({ b: 125, g: 255, r: 90 }), // Pastel Green
  colord({ b: 135, g: 255, r: 100 }), // Green Melon
  colord({ b: 145, g: 255, r: 110 }), // Herbal Mist
  colord({ b: 155, g: 255, r: 120 }), // Kiwi Foam
  colord({ b: 165, g: 255, r: 130 }), // Aloe Fresh
  colord({ b: 175, g: 255, r: 140 }), // Light Mint
  colord({ b: 255, g: 200, r: 150 }), // Cornflower Mist
  colord({ b: 185, g: 255, r: 150 }), // Green Sorbet
  colord({ b: 255, g: 215, r: 160 }), // Powder Blue
  colord({ b: 195, g: 255, r: 160 }), // Pastel Apple
  colord({ b: 255, g: 190, r: 170 }), // Periwinkle Ice
  colord({ b: 255, g: 225, r: 170 }), // Baby Sky
  colord({ b: 205, g: 255, r: 170 }), // Aloe Breeze
  colord({ b: 255, g: 180, r: 180 }), // Pale Indigo
  colord({ b: 250, g: 235, r: 180 }), // Aqua Pastel
  colord({ b: 215, g: 255, r: 180 }), // Pale Mint
  colord({ b: 195, g: 140, r: 190 }), // Fuchsia Tint
  colord({ b: 240, g: 245, r: 190 }), // Ice Mint
  colord({ b: 225, g: 255, r: 190 }), // Mint Water
  colord({ b: 200, g: 145, r: 195 }), // Dusky Rose
  colord({ b: 205, g: 150, r: 200 }), // Plum Frost
  colord({ b: 255, g: 170, r: 200 }), // Lilac Bloom
  colord({ b: 215, g: 255, r: 200 }), // Cool Aloe
  colord({ b: 235, g: 255, r: 200 }), // Cool Mist
  colord({ b: 210, g: 155, r: 205 }), // Berry Foam
  colord({ b: 215, g: 160, r: 210 }), // Grape Cloud
  colord({ b: 245, g: 255, r: 210 }), // Sea Mist
  colord({ b: 220, g: 165, r: 215 }), // Light Bloom
  colord({ b: 200, g: 255, r: 215 }), // Fresh Mint
  colord({ b: 255, g: 160, r: 220 }), // Violet Mist
  colord({ b: 225, g: 170, r: 220 }), // Cherry Blossom
  colord({ b: 255, g: 255, r: 220 }), // Pale Aqua
  colord({ b: 230, g: 175, r: 225 }), // Faded Rose
  colord({ b: 175, g: 255, r: 225 }), // Soft Lime
  colord({ b: 235, g: 180, r: 230 }), // Dreamy Mauve
  colord({ b: 255, g: 250, r: 230 }), // Sky Haze
  colord({ b: 255, g: 150, r: 235 }), // Orchid Glow
  colord({ b: 240, g: 185, r: 235 }), // Powder Violet
  colord({ b: 245, g: 190, r: 240 }), // Pastel Violet
  colord({ b: 255, g: 240, r: 240 }), // Frosted Lilac
  colord({ b: 160, g: 250, r: 240 }), // Citrus Wash
  colord({ b: 240, g: 160, r: 245 }), // Rose Lilac
  colord({ b: 250, g: 195, r: 245 }), // Soft Magenta
  colord({ b: 175, g: 245, r: 245 }), // Lemon Mist
  colord({ b: 255, g: 200, r: 250 }), // Lilac Cream
  colord({ b: 255, g: 230, r: 250 }), // Misty Mauve
  colord({ b: 225, g: 170, r: 255 }), // Bubblegum Pink
  colord({ b: 215, g: 185, r: 255 }), // Blush Mist
  colord({ b: 235, g: 195, r: 255 }), // Faded Fuchsia
  colord({ b: 220, g: 200, r: 255 }), // Cotton Rose
  colord({ b: 245, g: 205, r: 255 }), // Pastel Orchid
  colord({ b: 255, g: 205, r: 255 }), // Violet Bloom
  colord({ b: 230, g: 210, r: 255 }), // Pastel Blush
  colord({ b: 250, g: 210, r: 255 }), // Lavender Mist
  colord({ b: 255, g: 210, r: 255 }), // Orchid Mist
  colord({ b: 195, g: 215, r: 255 }), // Apricot Glow
  colord({ b: 245, g: 215, r: 255 }), // Rose Whisper
  colord({ b: 235, g: 220, r: 255 }), // Pink Mist
  colord({ b: 250, g: 220, r: 255 }), // Powder Petal
  colord({ b: 180, g: 225, r: 255 }), // Butter Peach
  colord({ b: 255, g: 225, r: 255 }), // Petal Mist
  colord({ b: 245, g: 230, r: 255 }), // Light Rose
  colord({ b: 200, g: 235, r: 255 }), // Cream Peach
  colord({ b: 235, g: 235, r: 255 }), // Blushed Petal
  colord({ b: 220, g: 240, r: 255 }), // Pastel Sand
  colord({ b: 210, g: 245, r: 255 }), // Soft Banana
];
