import { colord, Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";

extend([lchPlugin]);
extend([labPlugin]);

export const red = colord({ h: 0, s: 82, l: 56 });
export const blue = colord({ h: 224, s: 100, l: 58 });
export const teal = colord({ h: 172, s: 66, l: 50 });
export const purple = colord({ h: 271, s: 81, l: 56 });
export const yellow = colord({ h: 45, s: 93, l: 47 });
export const orange = colord({ h: 25, s: 95, l: 53 });
export const green = colord({ h: 128, s: 49, l: 50 });
export const botColor = colord({ h: 36, s: 10, l: 80 });

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
      s: saturation,
      l: lightness,
    });
  });
}

export const nationColors: Colord[] = [
  colord("rgb(230,100,100)"), // Bright Red
  colord("rgb(100,180,230)"), // Sky Blue
  colord("rgb(230,180,80)"), // Golden Yellow
  colord("rgb(180,100,230)"), // Purple
  colord("rgb(80,200,120)"), // Emerald Green
  colord("rgb(230,130,180)"), // Pink
  colord("rgb(100,160,80)"), // Olive Green
  colord("rgb(230,150,100)"), // Peach
  colord("rgb(80,130,190)"), // Navy Blue
  colord("rgb(210,210,100)"), // Lime Yellow
  colord("rgb(190,100,130)"), // Maroon
  colord("rgb(100,210,210)"), // Turquoise
  colord("rgb(210,140,80)"), // Light Orange
  colord("rgb(150,110,190)"), // Lavender
  colord("rgb(180,210,120)"), // Light Green
  colord("rgb(210,100,160)"), // Hot Pink
  colord("rgb(100,140,110)"), // Sea Green
  colord("rgb(230,180,180)"), // Light Pink
  colord("rgb(120,120,190)"), // Periwinkle
  colord("rgb(190,170,100)"), // Sand
  colord("rgb(100,180,160)"), // Aquamarine
  colord("rgb(210,160,200)"), // Orchid
  colord("rgb(170,190,100)"), // Yellow Green
  colord("rgb(100,130,150)"), // Steel Blue
  colord("rgb(230,140,140)"), // Salmon
  colord("rgb(140,180,220)"), // Light Blue
  colord("rgb(200,160,110)"), // Tan
  colord("rgb(180,130,180)"), // Plum
  colord("rgb(130,200,130)"), // Light Sea Green
  colord("rgb(220,120,120)"), // Coral
  colord("rgb(120,160,200)"), // Cornflower Blue
  colord("rgb(200,200,140)"), // Khaki
  colord("rgb(160,120,160)"), // Purple Gray
  colord("rgb(140,180,140)"), // Dark Sea Green
  colord("rgb(200,130,110)"), // Dark Salmon
  colord("rgb(130,170,190)"), // Cadet Blue
  colord("rgb(190,180,160)"), // Tan Gray
  colord("rgb(170,140,190)"), // Medium Purple
  colord("rgb(160,190,160)"), // Pale Green
  colord("rgb(190,150,130)"), // Rosy Brown
  colord("rgb(140,150,180)"), // Light Slate Gray
  colord("rgb(180,170,140)"), // Dark Khaki
  colord("rgb(150,130,150)"), // Thistle
  colord("rgb(170,190,180)"), // Pale Blue Green
  colord("rgb(190,140,150)"), // Puce
  colord("rgb(130,180,170)"), // Medium Aquamarine
  colord("rgb(180,160,180)"), // Mauve
  colord("rgb(160,180,140)"), // Dark Olive Green
  colord("rgb(170,150,170)"), // Dusty Rose
  colord("rgb(100,180,230)"), // Sky Blue
  colord("rgb(230,180,80)"), // Golden Yellow
  colord("rgb(180,100,230)"), // Purple
  colord("rgb(80,200,120)"), // Emerald Green
  colord("rgb(230,130,180)"), // Pink
  colord("rgb(100,160,80)"), // Olive Green
  colord("rgb(230,150,100)"), // Peach
  colord("rgb(80,130,190)"), // Navy Blue
  colord("rgb(210,210,100)"), // Lime Yellow
  colord("rgb(190,100,130)"), // Maroon
  colord("rgb(100,210,210)"), // Turquoise
  colord("rgb(210,140,80)"), // Light Orange
  colord("rgb(150,110,190)"), // Lavender
  colord("rgb(180,210,120)"), // Light Green
  colord("rgb(210,100,160)"), // Hot Pink
  colord("rgb(100,140,110)"), // Sea Green
  colord("rgb(230,180,180)"), // Light Pink
  colord("rgb(120,120,190)"), // Periwinkle
  colord("rgb(190,170,100)"), // Sand
  colord("rgb(100,180,160)"), // Aquamarine
  colord("rgb(210,160,200)"), // Orchid
  colord("rgb(170,190,100)"), // Yellow Green
  colord("rgb(100,130,150)"), // Steel Blue
  colord("rgb(230,140,140)"), // Salmon
  colord("rgb(140,180,220)"), // Light Blue
  colord("rgb(200,160,110)"), // Tan
  colord("rgb(180,130,180)"), // Plum
  colord("rgb(130,200,130)"), // Light Sea Green
  colord("rgb(220,120,120)"), // Coral
  colord("rgb(120,160,200)"), // Cornflower Blue
  colord("rgb(200,200,140)"), // Khaki
  colord("rgb(160,120,160)"), // Purple Gray
  colord("rgb(140,180,140)"), // Dark Sea Green
  colord("rgb(200,130,110)"), // Dark Salmon
  colord("rgb(130,170,190)"), // Cadet Blue
  colord("rgb(190,180,160)"), // Tan Gray
  colord("rgb(170,140,190)"), // Medium Purple
  colord("rgb(160,190,160)"), // Pale Green
  colord("rgb(190,150,130)"), // Rosy Brown
  colord("rgb(140,150,180)"), // Light Slate Gray
  colord("rgb(180,170,140)"), // Dark Khaki
  colord("rgb(150,130,150)"), // Thistle
  colord("rgb(170,190,180)"), // Pale Blue Green
  colord("rgb(190,140,150)"), // Puce
  colord("rgb(130,180,170)"), // Medium Aquamarine
  colord("rgb(180,160,180)"), // Mauve
  colord("rgb(160,180,140)"), // Dark Olive Green
  colord("rgb(170,150,170)"), // Dusty Rose
];

// Bright pastel theme with 64 colors
export const humanColors: Colord[] = [
  colord("rgb(16,185,129)"), // Sea Green
  colord("rgb(34,197,94)"), // Emerald
  colord("rgb(45,212,191)"), // Turquoise
  colord("rgb(48,178,180)"), // Teal
  colord("rgb(52,211,153)"), // Spearmint
  colord("rgb(56,189,248)"), // Light Blue
  colord("rgb(59,130,246)"), // Royal Blue
  colord("rgb(67,190,84)"), // Fresh Green
  colord("rgb(74,222,128)"), // Mint
  colord("rgb(79,70,229)"), // Indigo
  colord("rgb(82,183,136)"), // Jade
  colord("rgb(96,165,250)"), // Sky Blue
  colord("rgb(99,202,253)"), // Azure
  colord("rgb(110,231,183)"), // Seafoam
  colord("rgb(124,58,237)"), // Royal Purple
  colord("rgb(125,211,252)"), // Crystal Blue
  colord("rgb(132,204,22)"), // Lime
  colord("rgb(133,77,14)"), // Chocolate
  colord("rgb(134,239,172)"), // Light Green
  colord("rgb(147,51,234)"), // Bright Purple
  colord("rgb(147,197,253)"), // Powder Blue
  colord("rgb(151,255,187)"), // Fresh Mint
  colord("rgb(163,230,53)"), // Yellow Green
  colord("rgb(167,139,250)"), // Periwinkle
  colord("rgb(168,85,247)"), // Vibrant Purple
  colord("rgb(179,136,255)"), // Light Purple
  colord("rgb(186,255,201)"), // Pale Emerald
  colord("rgb(190,92,251)"), // Amethyst
  colord("rgb(192,132,252)"), // Lavender
  colord("rgb(202,138,4)"), // Rich Gold
  colord("rgb(202,225,255)"), // Baby Blue
  colord("rgb(204,204,255)"), // Soft Lavender Blue
  colord("rgb(217,70,239)"), // Fuchsia
  colord("rgb(220,38,38)"), // Ruby
  colord("rgb(220,220,255)"), // Meringue Blue
  colord("rgb(220,240,250)"), // Ice Blue
  colord("rgb(230,250,210)"), // Pastel Lime
  colord("rgb(230,255,250)"), // Mint Whisper
  colord("rgb(233,213,255)"), // Light Lilac
  colord("rgb(234,88,12)"), // Burnt Orange
  colord("rgb(234,179,8)"), // Sunflower
  colord("rgb(235,75,75)"), // Bright Red
  colord("rgb(236,72,153)"), // Deep Pink
  colord("rgb(239,68,68)"), // Crimson
  colord("rgb(240,171,252)"), // Orchid
  colord("rgb(240,240,200)"), // Light Khaki
  colord("rgb(244,114,182)"), // Rose
  colord("rgb(245,101,101)"), // Coral
  colord("rgb(245,158,11)"), // Amber
  colord("rgb(248,113,113)"), // Warm Red
  colord("rgb(249,115,22)"), // Tangerine
  colord("rgb(250,215,225)"), // Cotton Candy
  colord("rgb(250,250,210)"), // Pastel Lemon
  colord("rgb(251,113,133)"), // Watermelon
  colord("rgb(251,146,60)"), // Light Orange
  colord("rgb(251,191,36)"), // Marigold
  colord("rgb(251,235,245)"), // Rose Powder
  colord("rgb(252,165,165)"), // Peach
  colord("rgb(252,211,77)"), // Golden
  colord("rgb(253,164,175)"), // Salmon Pink
  colord("rgb(255,204,229)"), // Blush Pink
  colord("rgb(255,223,186)"), // Apricot Cream
  colord("rgb(255,240,200)"), // Vanilla
];

export const botColors: Colord[] = [
  colord("rgb(190,120,120)"), // Muted Red
  colord("rgb(120,160,190)"), // Muted Sky Blue
  colord("rgb(190,160,100)"), // Muted Golden Yellow
  colord("rgb(160,120,190)"), // Muted Purple
  colord("rgb(100,170,130)"), // Muted Emerald Green
  colord("rgb(190,130,160)"), // Muted Pink
  colord("rgb(120,150,100)"), // Muted Olive Green
  colord("rgb(190,140,120)"), // Muted Peach
  colord("rgb(100,120,160)"), // Muted Navy Blue
  colord("rgb(170,170,120)"), // Muted Lime Yellow
  colord("rgb(160,120,130)"), // Muted Maroon
  colord("rgb(120,170,170)"), // Muted Turquoise
  colord("rgb(170,140,100)"), // Muted Light Orange
  colord("rgb(140,120,160)"), // Muted Lavender
  colord("rgb(150,170,130)"), // Muted Light Green
  colord("rgb(170,120,140)"), // Muted Hot Pink
  colord("rgb(120,140,120)"), // Muted Sea Green
  colord("rgb(180,160,160)"), // Muted Light Pink
  colord("rgb(130,130,160)"), // Muted Periwinkle
  colord("rgb(160,150,120)"), // Muted Sand
  colord("rgb(120,160,150)"), // Muted Aquamarine
  colord("rgb(170,150,170)"), // Muted Orchid
  colord("rgb(150,160,120)"), // Muted Yellow Green
  colord("rgb(120,130,140)"), // Muted Steel Blue
  colord("rgb(180,140,140)"), // Muted Salmon
  colord("rgb(140,160,170)"), // Muted Light Blue
  colord("rgb(170,150,130)"), // Muted Tan
  colord("rgb(160,130,160)"), // Muted Plum
  colord("rgb(130,170,130)"), // Muted Light Sea Green
  colord("rgb(170,130,130)"), // Muted Coral
  colord("rgb(130,150,170)"), // Muted Cornflower Blue
  colord("rgb(170,170,140)"), // Muted Khaki
  colord("rgb(150,130,150)"), // Muted Purple Gray
  colord("rgb(140,160,140)"), // Muted Dark Sea Green
  colord("rgb(170,130,120)"), // Muted Dark Salmon
  colord("rgb(130,150,160)"), // Muted Cadet Blue
  colord("rgb(160,160,150)"), // Muted Tan Gray
  colord("rgb(150,140,160)"), // Muted Medium Purple
  colord("rgb(150,170,150)"), // Muted Pale Green
  colord("rgb(160,140,130)"), // Muted Rosy Brown
  colord("rgb(140,150,160)"), // Muted Light Slate Gray
  colord("rgb(160,150,140)"), // Muted Dark Khaki
  colord("rgb(140,130,140)"), // Muted Thistle
  colord("rgb(150,160,160)"), // Muted Pale Blue Green
  colord("rgb(160,140,150)"), // Muted Puce
  colord("rgb(130,160,150)"), // Muted Medium Aquamarine
  colord("rgb(160,150,160)"), // Muted Mauve
  colord("rgb(150,160,140)"), // Muted Dark Olive Green
  colord("rgb(150,140,150)"), // Muted Dusty Rose
];

// Fallback colors for when the color palette is exhausted. Currently 100 colors.
export const fallbackColors: Colord[] = [
  colord("rgb(0,5,0)"), // Black Mint
  colord("rgb(0,15,0)"), // Deep Forest
  colord("rgb(0,25,0)"), // Jungle
  colord("rgb(0,35,0)"), // Dark Emerald
  colord("rgb(0,45,0)"), // Green Moss
  colord("rgb(0,55,0)"), // Moss Shadow
  colord("rgb(0,65,0)"), // Dark Meadow
  colord("rgb(0,75,0)"), // Forest Fern
  colord("rgb(0,85,0)"), // Pine Leaf
  colord("rgb(0,95,0)"), // Shadow Grass
  colord("rgb(0,105,0)"), // Classic Green
  colord("rgb(0,115,0)"), // Deep Lime
  colord("rgb(0,125,0)"), // Dense Leaf
  colord("rgb(0,135,0)"), // Basil Green
  colord("rgb(0,145,0)"), // Organic Green
  colord("rgb(0,155,0)"), // Bitter Herb
  colord("rgb(0,165,0)"), // Raw Spinach
  colord("rgb(0,175,0)"), // Woodland
  colord("rgb(0,185,0)"), // Spring Weed
  colord("rgb(0,195,5)"), // Apple Stem
  colord("rgb(0,205,10)"), // Crisp Lettuce
  colord("rgb(0,215,15)"), // Vibrant Green
  colord("rgb(0,225,20)"), // Bright Herb
  colord("rgb(0,235,25)"), // Green Splash
  colord("rgb(0,245,30)"), // Mint Leaf
  colord("rgb(0,255,35)"), // Fresh Mint
  colord("rgb(10,255,45)"), // Neon Grass
  colord("rgb(20,255,55)"), // Lemon Balm
  colord("rgb(30,255,65)"), // Juicy Green
  colord("rgb(40,255,75)"), // Pear Tint
  colord("rgb(50,255,85)"), // Avocado Pastel
  colord("rgb(60,255,95)"), // Lime Glow
  colord("rgb(70,255,105)"), // Light Leaf
  colord("rgb(80,255,115)"), // Soft Fern
  colord("rgb(90,255,125)"), // Pastel Green
  colord("rgb(100,255,135)"), // Green Melon
  colord("rgb(110,255,145)"), // Herbal Mist
  colord("rgb(120,255,155)"), // Kiwi Foam
  colord("rgb(130,255,165)"), // Aloe Fresh
  colord("rgb(140,255,175)"), // Light Mint
  colord("rgb(150,200,255)"), // Cornflower Mist
  colord("rgb(150,255,185)"), // Green Sorbet
  colord("rgb(160,215,255)"), // Powder Blue
  colord("rgb(160,255,195)"), // Pastel Apple
  colord("rgb(170,190,255)"), // Periwinkle Ice
  colord("rgb(170,225,255)"), // Baby Sky
  colord("rgb(170,255,205)"), // Aloe Breeze
  colord("rgb(180,180,255)"), // Pale Indigo
  colord("rgb(180,235,250)"), // Aqua Pastel
  colord("rgb(180,255,215)"), // Pale Mint
  colord("rgb(190,140,195)"), // Fuchsia Tint
  colord("rgb(190,245,240)"), // Ice Mint
  colord("rgb(190,255,225)"), // Mint Water
  colord("rgb(195,145,200)"), // Dusky Rose
  colord("rgb(200,150,205)"), // Plum Frost
  colord("rgb(200,170,255)"), // Lilac Bloom
  colord("rgb(200,255,215)"), // Cool Aloe
  colord("rgb(200,255,235)"), // Cool Mist
  colord("rgb(205,155,210)"), // Berry Foam
  colord("rgb(210,160,215)"), // Grape Cloud
  colord("rgb(210,255,245)"), // Sea Mist
  colord("rgb(215,165,220)"), // Light Bloom
  colord("rgb(215,255,200)"), // Fresh Mint
  colord("rgb(220,160,255)"), // Violet Mist
  colord("rgb(220,170,225)"), // Cherry Blossom
  colord("rgb(220,255,255)"), // Pale Aqua
  colord("rgb(225,175,230)"), // Faded Rose
  colord("rgb(225,255,175)"), // Soft Lime
  colord("rgb(230,180,235)"), // Dreamy Mauve
  colord("rgb(230,250,255)"), // Sky Haze
  colord("rgb(235,150,255)"), // Orchid Glow
  colord("rgb(235,185,240)"), // Powder Violet
  colord("rgb(240,190,245)"), // Pastel Violet
  colord("rgb(240,240,255)"), // Frosted Lilac
  colord("rgb(240,250,160)"), // Citrus Wash
  colord("rgb(245,160,240)"), // Rose Lilac
  colord("rgb(245,195,250)"), // Soft Magenta
  colord("rgb(245,245,175)"), // Lemon Mist
  colord("rgb(250,200,255)"), // Lilac Cream
  colord("rgb(250,230,255)"), // Misty Mauve
  colord("rgb(255,170,225)"), // Bubblegum Pink
  colord("rgb(255,185,215)"), // Blush Mist
  colord("rgb(255,195,235)"), // Faded Fuchsia
  colord("rgb(255,200,220)"), // Cotton Rose
  colord("rgb(255,205,245)"), // Pastel Orchid
  colord("rgb(255,205,255)"), // Violet Bloom
  colord("rgb(255,210,230)"), // Pastel Blush
  colord("rgb(255,210,250)"), // Lavender Mist
  colord("rgb(255,210,255)"), // Orchid Mist
  colord("rgb(255,215,195)"), // Apricot Glow
  colord("rgb(255,215,245)"), // Rose Whisper
  colord("rgb(255,220,235)"), // Pink Mist
  colord("rgb(255,220,250)"), // Powder Petal
  colord("rgb(255,225,180)"), // Butter Peach
  colord("rgb(255,225,255)"), // Petal Mist
  colord("rgb(255,230,245)"), // Light Rose
  colord("rgb(255,235,200)"), // Cream Peach
  colord("rgb(255,235,235)"), // Blushed Petal
  colord("rgb(255,240,220)"), // Pastel Sand
  colord("rgb(255,245,210)"), // Soft Banana
];
