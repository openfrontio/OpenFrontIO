import { colord, Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";
extend([lchPlugin]);
extend([labPlugin]);

export const red: Colord = colord({ r: 235, g: 53, b: 53 }); // Bright Red
export const blue: Colord = colord({ r: 41, g: 98, b: 255 }); // Royal Blue
export const teal = colord({ h: 172, s: 66, l: 50 });
export const purple = colord({ h: 271, s: 81, l: 56 });
export const yellow = colord({ h: 45, s: 93, l: 47 });
export const orange = colord({ h: 25, s: 95, l: 53 });
export const green = colord({ h: 128, s: 49, l: 50 });
export const botColor: Colord = colord({ r: 210, g: 206, b: 200 }); // Muted Beige Gray

export const nationColors: Colord[] = [
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

// Bright pastel theme with 64 colors
export const humanColors: Colord[] = [
  colord({ r: 16, g: 185, b: 129 }), // Sea Green
  colord({ r: 34, g: 197, b: 94 }), // Emerald
  colord({ r: 45, g: 212, b: 191 }), // Turquoise
  colord({ r: 48, g: 178, b: 180 }), // Teal
  colord({ r: 52, g: 211, b: 153 }), // Spearmint
  colord({ r: 56, g: 189, b: 248 }), // Light Blue
  colord({ r: 59, g: 130, b: 246 }), // Royal Blue
  colord({ r: 67, g: 190, b: 84 }), // Fresh Green
  colord({ r: 74, g: 222, b: 128 }), // Mint
  colord({ r: 79, g: 70, b: 229 }), // Indigo
  colord({ r: 82, g: 183, b: 136 }), // Jade
  colord({ r: 96, g: 165, b: 250 }), // Sky Blue
  colord({ r: 99, g: 202, b: 253 }), // Azure
  colord({ r: 110, g: 231, b: 183 }), // Seafoam
  colord({ r: 124, g: 58, b: 237 }), // Royal Purple
  colord({ r: 125, g: 211, b: 252 }), // Crystal Blue
  colord({ r: 132, g: 204, b: 22 }), // Lime
  colord({ r: 133, g: 77, b: 14 }), // Chocolate
  colord({ r: 134, g: 239, b: 172 }), // Light Green
  colord({ r: 147, g: 51, b: 234 }), // Bright Purple
  colord({ r: 147, g: 197, b: 253 }), // Powder Blue
  colord({ r: 151, g: 255, b: 187 }), // Fresh Mint
  colord({ r: 163, g: 230, b: 53 }), // Yellow Green
  colord({ r: 167, g: 139, b: 250 }), // Periwinkle
  colord({ r: 168, g: 85, b: 247 }), // Vibrant Purple
  colord({ r: 179, g: 136, b: 255 }), // Light Purple
  colord({ r: 186, g: 255, b: 201 }), // Pale Emerald
  colord({ r: 190, g: 92, b: 251 }), // Amethyst
  colord({ r: 192, g: 132, b: 252 }), // Lavender
  colord({ r: 202, g: 138, b: 4 }), // Rich Gold
  colord({ r: 202, g: 225, b: 255 }), // Baby Blue
  colord({ r: 204, g: 204, b: 255 }), // Soft Lavender Blue
  colord({ r: 217, g: 70, b: 239 }), // Fuchsia
  colord({ r: 220, g: 38, b: 38 }), // Ruby
  colord({ r: 220, g: 220, b: 255 }), // Meringue Blue
  colord({ r: 220, g: 240, b: 250 }), // Ice Blue
  colord({ r: 230, g: 250, b: 210 }), // Pastel Lime
  colord({ r: 230, g: 255, b: 250 }), // Mint Whisper
  colord({ r: 233, g: 213, b: 255 }), // Light Lilac
  colord({ r: 234, g: 88, b: 12 }), // Burnt Orange
  colord({ r: 234, g: 179, b: 8 }), // Sunflower
  colord({ r: 235, g: 75, b: 75 }), // Bright Red
  colord({ r: 236, g: 72, b: 153 }), // Deep Pink
  colord({ r: 239, g: 68, b: 68 }), // Crimson
  colord({ r: 240, g: 171, b: 252 }), // Orchid
  colord({ r: 240, g: 240, b: 200 }), // Light Khaki
  colord({ r: 244, g: 114, b: 182 }), // Rose
  colord({ r: 245, g: 101, b: 101 }), // Coral
  colord({ r: 245, g: 158, b: 11 }), // Amber
  colord({ r: 248, g: 113, b: 113 }), // Warm Red
  colord({ r: 249, g: 115, b: 22 }), // Tangerine
  colord({ r: 250, g: 215, b: 225 }), // Cotton Candy
  colord({ r: 250, g: 250, b: 210 }), // Pastel Lemon
  colord({ r: 251, g: 113, b: 133 }), // Watermelon
  colord({ r: 251, g: 146, b: 60 }), // Light Orange
  colord({ r: 251, g: 191, b: 36 }), // Marigold
  colord({ r: 251, g: 235, b: 245 }), // Rose Powder
  colord({ r: 252, g: 165, b: 165 }), // Peach
  colord({ r: 252, g: 211, b: 77 }), // Golden
  colord({ r: 253, g: 164, b: 175 }), // Salmon Pink
  colord({ r: 255, g: 204, b: 229 }), // Blush Pink
  colord({ r: 255, g: 223, b: 186 }), // Apricot Cream
  colord({ r: 255, g: 240, b: 200 }), // Vanilla
];

export const botColors: Colord[] = [
  colord({ r: 190, g: 120, b: 120 }), // Muted Red
  colord({ r: 120, g: 160, b: 190 }), // Muted Sky Blue
  colord({ r: 190, g: 160, b: 100 }), // Muted Golden Yellow
  colord({ r: 160, g: 120, b: 190 }), // Muted Purple
  colord({ r: 100, g: 170, b: 130 }), // Muted Emerald Green
  colord({ r: 190, g: 130, b: 160 }), // Muted Pink
  colord({ r: 120, g: 150, b: 100 }), // Muted Olive Green
  colord({ r: 190, g: 140, b: 120 }), // Muted Peach
  colord({ r: 100, g: 120, b: 160 }), // Muted Navy Blue
  colord({ r: 170, g: 170, b: 120 }), // Muted Lime Yellow
  colord({ r: 160, g: 120, b: 130 }), // Muted Maroon
  colord({ r: 120, g: 170, b: 170 }), // Muted Turquoise
  colord({ r: 170, g: 140, b: 100 }), // Muted Light Orange
  colord({ r: 140, g: 120, b: 160 }), // Muted Lavender
  colord({ r: 150, g: 170, b: 130 }), // Muted Light Green
  colord({ r: 170, g: 120, b: 140 }), // Muted Hot Pink
  colord({ r: 120, g: 140, b: 120 }), // Muted Sea Green
  colord({ r: 180, g: 160, b: 160 }), // Muted Light Pink
  colord({ r: 130, g: 130, b: 160 }), // Muted Periwinkle
  colord({ r: 160, g: 150, b: 120 }), // Muted Sand
  colord({ r: 120, g: 160, b: 150 }), // Muted Aquamarine
  colord({ r: 170, g: 150, b: 170 }), // Muted Orchid
  colord({ r: 150, g: 160, b: 120 }), // Muted Yellow Green
  colord({ r: 120, g: 130, b: 140 }), // Muted Steel Blue
  colord({ r: 180, g: 140, b: 140 }), // Muted Salmon
  colord({ r: 140, g: 160, b: 170 }), // Muted Light Blue
  colord({ r: 170, g: 150, b: 130 }), // Muted Tan
  colord({ r: 160, g: 130, b: 160 }), // Muted Plum
  colord({ r: 130, g: 170, b: 130 }), // Muted Light Sea Green
  colord({ r: 170, g: 130, b: 130 }), // Muted Coral
  colord({ r: 130, g: 150, b: 170 }), // Muted Cornflower Blue
  colord({ r: 170, g: 170, b: 140 }), // Muted Khaki
  colord({ r: 150, g: 130, b: 150 }), // Muted Purple Gray
  colord({ r: 140, g: 160, b: 140 }), // Muted Dark Sea Green
  colord({ r: 170, g: 130, b: 120 }), // Muted Dark Salmon
  colord({ r: 130, g: 150, b: 160 }), // Muted Cadet Blue
  colord({ r: 160, g: 160, b: 150 }), // Muted Tan Gray
  colord({ r: 150, g: 140, b: 160 }), // Muted Medium Purple
  colord({ r: 150, g: 170, b: 150 }), // Muted Pale Green
  colord({ r: 160, g: 140, b: 130 }), // Muted Rosy Brown
  colord({ r: 140, g: 150, b: 160 }), // Muted Light Slate Gray
  colord({ r: 160, g: 150, b: 140 }), // Muted Dark Khaki
  colord({ r: 140, g: 130, b: 140 }), // Muted Thistle
  colord({ r: 150, g: 160, b: 160 }), // Muted Pale Blue Green
  colord({ r: 160, g: 140, b: 150 }), // Muted Puce
  colord({ r: 130, g: 160, b: 150 }), // Muted Medium Aquamarine
  colord({ r: 160, g: 150, b: 160 }), // Muted Mauve
  colord({ r: 150, g: 160, b: 140 }), // Muted Dark Olive Green
  colord({ r: 150, g: 140, b: 150 }), // Muted Dusty Rose
];

// Fallback colors for when the color palette is exhausted. Currently 100 colors.
export const fallbackColors: Colord[] = [
  colord({ r: 0, g: 5, b: 0 }), // Black Mint
  colord({ r: 0, g: 15, b: 0 }), // Deep Forest
  colord({ r: 0, g: 25, b: 0 }), // Jungle
  colord({ r: 0, g: 35, b: 0 }), // Dark Emerald
  colord({ r: 0, g: 45, b: 0 }), // Green Moss
  colord({ r: 0, g: 55, b: 0 }), // Moss Shadow
  colord({ r: 0, g: 65, b: 0 }), // Dark Meadow
  colord({ r: 0, g: 75, b: 0 }), // Forest Fern
  colord({ r: 0, g: 85, b: 0 }), // Pine Leaf
  colord({ r: 0, g: 95, b: 0 }), // Shadow Grass
  colord({ r: 0, g: 105, b: 0 }), // Classic Green
  colord({ r: 0, g: 115, b: 0 }), // Deep Lime
  colord({ r: 0, g: 125, b: 0 }), // Dense Leaf
  colord({ r: 0, g: 135, b: 0 }), // Basil Green
  colord({ r: 0, g: 145, b: 0 }), // Organic Green
  colord({ r: 0, g: 155, b: 0 }), // Bitter Herb
  colord({ r: 0, g: 165, b: 0 }), // Raw Spinach
  colord({ r: 0, g: 175, b: 0 }), // Woodland
  colord({ r: 0, g: 185, b: 0 }), // Spring Weed
  colord({ r: 0, g: 195, b: 5 }), // Apple Stem
  colord({ r: 0, g: 205, b: 10 }), // Crisp Lettuce
  colord({ r: 0, g: 215, b: 15 }), // Vibrant Green
  colord({ r: 0, g: 225, b: 20 }), // Bright Herb
  colord({ r: 0, g: 235, b: 25 }), // Green Splash
  colord({ r: 0, g: 245, b: 30 }), // Mint Leaf
  colord({ r: 0, g: 255, b: 35 }), // Fresh Mint
  colord({ r: 10, g: 255, b: 45 }), // Neon Grass
  colord({ r: 20, g: 255, b: 55 }), // Lemon Balm
  colord({ r: 30, g: 255, b: 65 }), // Juicy Green
  colord({ r: 40, g: 255, b: 75 }), // Pear Tint
  colord({ r: 50, g: 255, b: 85 }), // Avocado Pastel
  colord({ r: 60, g: 255, b: 95 }), // Lime Glow
  colord({ r: 70, g: 255, b: 105 }), // Light Leaf
  colord({ r: 80, g: 255, b: 115 }), // Soft Fern
  colord({ r: 90, g: 255, b: 125 }), // Pastel Green
  colord({ r: 100, g: 255, b: 135 }), // Green Melon
  colord({ r: 110, g: 255, b: 145 }), // Herbal Mist
  colord({ r: 120, g: 255, b: 155 }), // Kiwi Foam
  colord({ r: 130, g: 255, b: 165 }), // Aloe Fresh
  colord({ r: 140, g: 255, b: 175 }), // Light Mint
  colord({ r: 150, g: 200, b: 255 }), // Cornflower Mist
  colord({ r: 150, g: 255, b: 185 }), // Green Sorbet
  colord({ r: 160, g: 215, b: 255 }), // Powder Blue
  colord({ r: 160, g: 255, b: 195 }), // Pastel Apple
  colord({ r: 170, g: 190, b: 255 }), // Periwinkle Ice
  colord({ r: 170, g: 225, b: 255 }), // Baby Sky
  colord({ r: 170, g: 255, b: 205 }), // Aloe Breeze
  colord({ r: 180, g: 180, b: 255 }), // Pale Indigo
  colord({ r: 180, g: 235, b: 250 }), // Aqua Pastel
  colord({ r: 180, g: 255, b: 215 }), // Pale Mint
  colord({ r: 190, g: 140, b: 195 }), // Fuchsia Tint
  colord({ r: 190, g: 245, b: 240 }), // Ice Mint
  colord({ r: 190, g: 255, b: 225 }), // Mint Water
  colord({ r: 195, g: 145, b: 200 }), // Dusky Rose
  colord({ r: 200, g: 150, b: 205 }), // Plum Frost
  colord({ r: 200, g: 170, b: 255 }), // Lilac Bloom
  colord({ r: 200, g: 255, b: 215 }), // Cool Aloe
  colord({ r: 200, g: 255, b: 235 }), // Cool Mist
  colord({ r: 205, g: 155, b: 210 }), // Berry Foam
  colord({ r: 210, g: 160, b: 215 }), // Grape Cloud
  colord({ r: 210, g: 255, b: 245 }), // Sea Mist
  colord({ r: 215, g: 165, b: 220 }), // Light Bloom
  colord({ r: 215, g: 255, b: 200 }), // Fresh Mint
  colord({ r: 220, g: 160, b: 255 }), // Violet Mist
  colord({ r: 220, g: 170, b: 225 }), // Cherry Blossom
  colord({ r: 220, g: 255, b: 255 }), // Pale Aqua
  colord({ r: 225, g: 175, b: 230 }), // Faded Rose
  colord({ r: 225, g: 255, b: 175 }), // Soft Lime
  colord({ r: 230, g: 180, b: 235 }), // Dreamy Mauve
  colord({ r: 230, g: 250, b: 255 }), // Sky Haze
  colord({ r: 235, g: 150, b: 255 }), // Orchid Glow
  colord({ r: 235, g: 185, b: 240 }), // Powder Violet
  colord({ r: 240, g: 190, b: 245 }), // Pastel Violet
  colord({ r: 240, g: 240, b: 255 }), // Frosted Lilac
  colord({ r: 240, g: 250, b: 160 }), // Citrus Wash
  colord({ r: 245, g: 160, b: 240 }), // Rose Lilac
  colord({ r: 245, g: 195, b: 250 }), // Soft Magenta
  colord({ r: 245, g: 245, b: 175 }), // Lemon Mist
  colord({ r: 250, g: 200, b: 255 }), // Lilac Cream
  colord({ r: 250, g: 230, b: 255 }), // Misty Mauve
  colord({ r: 255, g: 170, b: 225 }), // Bubblegum Pink
  colord({ r: 255, g: 185, b: 215 }), // Blush Mist
  colord({ r: 255, g: 195, b: 235 }), // Faded Fuchsia
  colord({ r: 255, g: 200, b: 220 }), // Cotton Rose
  colord({ r: 255, g: 205, b: 245 }), // Pastel Orchid
  colord({ r: 255, g: 205, b: 255 }), // Violet Bloom
  colord({ r: 255, g: 210, b: 230 }), // Pastel Blush
  colord({ r: 255, g: 210, b: 250 }), // Lavender Mist
  colord({ r: 255, g: 210, b: 255 }), // Orchid Mist
  colord({ r: 255, g: 215, b: 195 }), // Apricot Glow
  colord({ r: 255, g: 215, b: 245 }), // Rose Whisper
  colord({ r: 255, g: 220, b: 235 }), // Pink Mist
  colord({ r: 255, g: 220, b: 250 }), // Powder Petal
  colord({ r: 255, g: 225, b: 180 }), // Butter Peach
  colord({ r: 255, g: 225, b: 255 }), // Petal Mist
  colord({ r: 255, g: 230, b: 245 }), // Light Rose
  colord({ r: 255, g: 235, b: 200 }), // Cream Peach
  colord({ r: 255, g: 235, b: 235 }), // Blushed Petal
  colord({ r: 255, g: 240, b: 220 }), // Pastel Sand
  colord({ r: 255, g: 245, b: 210 }), // Soft Banana
];
