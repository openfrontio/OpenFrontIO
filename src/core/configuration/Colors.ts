import { colord, Colord } from "colord";

export const red: Colord = colord({ r: 235, g: 53, b: 53 }); // Bright Red
export const blue: Colord = colord({ r: 41, g: 98, b: 255 }); // Royal Blue
export const teal = colord({ h: 172, s: 66, l: 50 });
export const purple = colord({ h: 271, s: 81, l: 56 });
export const yellow = colord({ h: 45, s: 93, l: 47 });
export const orange = colord({ h: 25, s: 95, l: 53 });
export const green = colord({ h: 128, s: 49, l: 50 });
export const botColor: Colord = colord({ r: 210, g: 206, b: 200 }); // Muted Beige Gray

export const territoryColors: Colord[] = [
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

export const humanColors: Colord[] = [
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
