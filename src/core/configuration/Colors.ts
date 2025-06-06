import { colord, Colord } from "colord";
import { ColoredTeams, Team } from "../game/Game";
import { simpleHash } from "../Util";

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

// 254 colors
export const humanColors: Colord[] = [
  colord({ r: 0, g: 0, b: 51 }),
  colord({ r: 0, g: 0, b: 102 }),
  colord({ r: 0, g: 0, b: 153 }),
  colord({ r: 0, g: 0, b: 204 }),
  colord({ r: 0, g: 0, b: 255 }),
  colord({ r: 0, g: 51, b: 0 }),
  colord({ r: 0, g: 51, b: 51 }),
  colord({ r: 0, g: 51, b: 102 }),
  colord({ r: 0, g: 51, b: 153 }),
  colord({ r: 0, g: 51, b: 204 }),
  colord({ r: 0, g: 51, b: 255 }),
  colord({ r: 0, g: 102, b: 0 }),
  colord({ r: 0, g: 102, b: 51 }),
  colord({ r: 0, g: 102, b: 102 }),
  colord({ r: 0, g: 102, b: 153 }),
  colord({ r: 0, g: 102, b: 204 }),
  colord({ r: 0, g: 102, b: 255 }),
  colord({ r: 0, g: 153, b: 0 }),
  colord({ r: 0, g: 153, b: 51 }),
  colord({ r: 0, g: 153, b: 102 }),
  colord({ r: 0, g: 153, b: 153 }),
  colord({ r: 0, g: 153, b: 204 }),
  colord({ r: 0, g: 153, b: 255 }),
  colord({ r: 0, g: 204, b: 0 }),
  colord({ r: 0, g: 204, b: 51 }),
  colord({ r: 0, g: 204, b: 102 }),
  colord({ r: 0, g: 204, b: 153 }),
  colord({ r: 0, g: 204, b: 204 }),
  colord({ r: 0, g: 204, b: 255 }),
  colord({ r: 0, g: 255, b: 0 }),
  colord({ r: 0, g: 255, b: 51 }),
  colord({ r: 0, g: 255, b: 102 }),
  colord({ r: 0, g: 255, b: 153 }),
  colord({ r: 0, g: 255, b: 204 }),
  colord({ r: 0, g: 255, b: 255 }),
  colord({ r: 51, g: 0, b: 0 }),
  colord({ r: 51, g: 0, b: 51 }),
  colord({ r: 51, g: 0, b: 102 }),
  colord({ r: 51, g: 0, b: 153 }),
  colord({ r: 51, g: 0, b: 204 }),
  colord({ r: 51, g: 0, b: 255 }),
  colord({ r: 51, g: 51, b: 0 }),
  colord({ r: 51, g: 51, b: 51 }),
  colord({ r: 51, g: 51, b: 102 }),
  colord({ r: 51, g: 51, b: 153 }),
  colord({ r: 51, g: 51, b: 204 }),
  colord({ r: 51, g: 51, b: 255 }),
  colord({ r: 51, g: 102, b: 0 }),
  colord({ r: 51, g: 102, b: 51 }),
  colord({ r: 51, g: 102, b: 102 }),
  colord({ r: 51, g: 102, b: 153 }),
  colord({ r: 51, g: 102, b: 204 }),
  colord({ r: 51, g: 102, b: 255 }),
  colord({ r: 51, g: 153, b: 0 }),
  colord({ r: 51, g: 153, b: 51 }),
  colord({ r: 51, g: 153, b: 102 }),
  colord({ r: 51, g: 153, b: 153 }),
  colord({ r: 51, g: 153, b: 204 }),
  colord({ r: 51, g: 153, b: 255 }),
  colord({ r: 51, g: 204, b: 0 }),
  colord({ r: 51, g: 204, b: 51 }),
  colord({ r: 51, g: 204, b: 102 }),
  colord({ r: 51, g: 204, b: 153 }),
  colord({ r: 51, g: 204, b: 204 }),
  colord({ r: 51, g: 204, b: 255 }),
  colord({ r: 51, g: 255, b: 0 }),
  colord({ r: 51, g: 255, b: 51 }),
  colord({ r: 51, g: 255, b: 102 }),
  colord({ r: 51, g: 255, b: 153 }),
  colord({ r: 51, g: 255, b: 204 }),
  colord({ r: 51, g: 255, b: 255 }),
  colord({ r: 102, g: 0, b: 0 }),
  colord({ r: 102, g: 0, b: 51 }),
  colord({ r: 102, g: 0, b: 102 }),
  colord({ r: 102, g: 0, b: 153 }),
  colord({ r: 102, g: 0, b: 204 }),
  colord({ r: 102, g: 0, b: 255 }),
  colord({ r: 102, g: 51, b: 0 }),
  colord({ r: 102, g: 51, b: 51 }),
  colord({ r: 102, g: 51, b: 102 }),
  colord({ r: 102, g: 51, b: 153 }),
  colord({ r: 102, g: 51, b: 204 }),
  colord({ r: 102, g: 51, b: 255 }),
  colord({ r: 102, g: 102, b: 0 }),
  colord({ r: 102, g: 102, b: 51 }),
  colord({ r: 102, g: 102, b: 102 }),
  colord({ r: 102, g: 102, b: 153 }),
  colord({ r: 102, g: 102, b: 204 }),
  colord({ r: 102, g: 102, b: 255 }),
  colord({ r: 102, g: 153, b: 0 }),
  colord({ r: 102, g: 153, b: 51 }),
  colord({ r: 102, g: 153, b: 102 }),
  colord({ r: 102, g: 153, b: 153 }),
  colord({ r: 102, g: 153, b: 204 }),
  colord({ r: 102, g: 153, b: 255 }),
  colord({ r: 102, g: 204, b: 0 }),
  colord({ r: 102, g: 204, b: 51 }),
  colord({ r: 102, g: 204, b: 102 }),
  colord({ r: 102, g: 204, b: 153 }),
  colord({ r: 102, g: 204, b: 204 }),
  colord({ r: 102, g: 204, b: 255 }),
  colord({ r: 102, g: 255, b: 0 }),
  colord({ r: 102, g: 255, b: 51 }),
  colord({ r: 102, g: 255, b: 102 }),
  colord({ r: 102, g: 255, b: 153 }),
  colord({ r: 102, g: 255, b: 204 }),
  colord({ r: 102, g: 255, b: 255 }),
  colord({ r: 153, g: 0, b: 0 }),
  colord({ r: 153, g: 0, b: 51 }),
  colord({ r: 153, g: 0, b: 102 }),
  colord({ r: 153, g: 0, b: 153 }),
  colord({ r: 153, g: 0, b: 204 }),
  colord({ r: 153, g: 0, b: 255 }),
  colord({ r: 153, g: 51, b: 0 }),
  colord({ r: 153, g: 51, b: 51 }),
  colord({ r: 153, g: 51, b: 102 }),
  colord({ r: 153, g: 51, b: 153 }),
  colord({ r: 153, g: 51, b: 204 }),
  colord({ r: 153, g: 51, b: 255 }),
  colord({ r: 153, g: 102, b: 0 }),
  colord({ r: 153, g: 102, b: 51 }),
  colord({ r: 153, g: 102, b: 102 }),
  colord({ r: 153, g: 102, b: 153 }),
  colord({ r: 153, g: 102, b: 204 }),
  colord({ r: 153, g: 102, b: 255 }),
  colord({ r: 153, g: 153, b: 0 }),
  colord({ r: 153, g: 153, b: 51 }),
  colord({ r: 153, g: 153, b: 102 }),
  colord({ r: 153, g: 153, b: 153 }),
  colord({ r: 153, g: 153, b: 204 }),
  colord({ r: 153, g: 153, b: 255 }),
  colord({ r: 153, g: 204, b: 0 }),
  colord({ r: 153, g: 204, b: 51 }),
  colord({ r: 153, g: 204, b: 102 }),
  colord({ r: 153, g: 204, b: 153 }),
  colord({ r: 153, g: 204, b: 204 }),
  colord({ r: 153, g: 204, b: 255 }),
  colord({ r: 153, g: 255, b: 0 }),
  colord({ r: 153, g: 255, b: 51 }),
  colord({ r: 153, g: 255, b: 102 }),
  colord({ r: 153, g: 255, b: 153 }),
  colord({ r: 153, g: 255, b: 204 }),
  colord({ r: 153, g: 255, b: 255 }),
  colord({ r: 204, g: 0, b: 0 }),
  colord({ r: 204, g: 0, b: 51 }),
  colord({ r: 204, g: 0, b: 102 }),
  colord({ r: 204, g: 0, b: 153 }),
  colord({ r: 204, g: 0, b: 204 }),
  colord({ r: 204, g: 0, b: 255 }),
  colord({ r: 204, g: 51, b: 0 }),
  colord({ r: 204, g: 51, b: 51 }),
  colord({ r: 204, g: 51, b: 102 }),
  colord({ r: 204, g: 51, b: 153 }),
  colord({ r: 204, g: 51, b: 204 }),
  colord({ r: 204, g: 51, b: 255 }),
  colord({ r: 204, g: 102, b: 0 }),
  colord({ r: 204, g: 102, b: 51 }),
  colord({ r: 204, g: 102, b: 102 }),
  colord({ r: 204, g: 102, b: 153 }),
  colord({ r: 204, g: 102, b: 204 }),
  colord({ r: 204, g: 102, b: 255 }),
  colord({ r: 204, g: 153, b: 0 }),
  colord({ r: 204, g: 153, b: 51 }),
  colord({ r: 204, g: 153, b: 102 }),
  colord({ r: 204, g: 153, b: 153 }),
  colord({ r: 204, g: 153, b: 204 }),
  colord({ r: 204, g: 153, b: 255 }),
  colord({ r: 204, g: 204, b: 0 }),
  colord({ r: 204, g: 204, b: 51 }),
  colord({ r: 204, g: 204, b: 102 }),
  colord({ r: 204, g: 204, b: 153 }),
  colord({ r: 204, g: 204, b: 204 }),
  colord({ r: 204, g: 204, b: 255 }),
  colord({ r: 204, g: 255, b: 0 }),
  colord({ r: 204, g: 255, b: 51 }),
  colord({ r: 204, g: 255, b: 102 }),
  colord({ r: 204, g: 255, b: 153 }),
  colord({ r: 204, g: 255, b: 204 }),
  colord({ r: 204, g: 255, b: 255 }),
  colord({ r: 255, g: 0, b: 0 }),
  colord({ r: 255, g: 0, b: 51 }),
  colord({ r: 255, g: 0, b: 102 }),
  colord({ r: 255, g: 0, b: 153 }),
  colord({ r: 255, g: 0, b: 204 }),
  colord({ r: 255, g: 0, b: 255 }),
  colord({ r: 255, g: 51, b: 0 }),
  colord({ r: 255, g: 51, b: 51 }),
  colord({ r: 255, g: 51, b: 102 }),
  colord({ r: 255, g: 51, b: 153 }),
  colord({ r: 255, g: 51, b: 204 }),
  colord({ r: 255, g: 51, b: 255 }),
  colord({ r: 255, g: 102, b: 0 }),
  colord({ r: 255, g: 102, b: 51 }),
  colord({ r: 255, g: 102, b: 102 }),
  colord({ r: 255, g: 102, b: 153 }),
  colord({ r: 255, g: 102, b: 204 }),
  colord({ r: 255, g: 102, b: 255 }),
  colord({ r: 255, g: 153, b: 0 }),
  colord({ r: 255, g: 153, b: 51 }),
  colord({ r: 255, g: 153, b: 102 }),
  colord({ r: 255, g: 153, b: 153 }),
  colord({ r: 255, g: 153, b: 204 }),
  colord({ r: 255, g: 153, b: 255 }),
  colord({ r: 255, g: 204, b: 0 }),
  colord({ r: 255, g: 204, b: 51 }),
  colord({ r: 255, g: 204, b: 102 }),
  colord({ r: 255, g: 204, b: 153 }),
  colord({ r: 255, g: 204, b: 204 }),
  colord({ r: 255, g: 204, b: 255 }),
  colord({ r: 255, g: 255, b: 0 }),
  colord({ r: 255, g: 255, b: 51 }),
  colord({ r: 255, g: 255, b: 102 }),
  colord({ r: 255, g: 255, b: 153 }),
  colord({ r: 255, g: 255, b: 204 }),
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

export class ColorAllocator {
  private usedHashes = new Set<number>();
  private availableColors: Colord[];
  private assigned = new Map<string, Colord>();

  constructor(colors: Colord[]) {
    this.availableColors = [...colors];
  }

  assignBotColor(id: string): Colord {
    const hash = simpleHash(id);
    return this.availableColors[hash % this.availableColors.length];
  }

  assignPlayerColor(id: string): Colord {
    if (this.assigned.has(id)) {
      return this.assigned.get(id)!;
    }

    if (this.availableColors.length === 0) {
      const fallback = colord({ r: 200, g: 200, b: 200 });
      this.assigned.set(id, fallback);
      return fallback;
    }

    const index = 0;
    const color = this.availableColors.splice(index, 1)[0];
    this.assigned.set(id, color);
    return color;
  }

  assignTeamColor(team: Team): Colord {
    switch (team) {
      case ColoredTeams.Blue:
        return blue;
      case ColoredTeams.Red:
        return red;
      case ColoredTeams.Teal:
        return teal;
      case ColoredTeams.Purple:
        return purple;
      case ColoredTeams.Yellow:
        return yellow;
      case ColoredTeams.Orange:
        return orange;
      case ColoredTeams.Green:
        return green;
      case ColoredTeams.Bot:
        return botColor;
      default:
        return this.availableColors[
          simpleHash(team) % this.availableColors.length
        ];
    }
  }
}
