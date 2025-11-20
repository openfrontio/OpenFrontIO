import { colord, Colord, extend } from "colord";
import labPlugin from "colord/plugins/lab";
import lchPlugin from "colord/plugins/lch";

extend([lchPlugin]);
extend([labPlugin]);

export const red = colord("rgb(235,51,51)");
export const blue = colord("rgb(41,98,255)");
export const teal = colord("rgb(43,212,189)");
export const purple = colord("rgb(146,52,234)");
export const yellow = colord("rgb(231,176,8)");
export const orange = colord("rgb(249,116,21)");
export const green = colord("rgb(65,190,82)");
export const botColor = colord("rgb(209,205,199)");

export const redTeamColors: Colord[] = generateTeamColors(red);
export const blueTeamColors: Colord[] = generateTeamColors(blue);
export const tealTeamColors: Colord[] = generateTeamColors(teal);
export const purpleTeamColors: Colord[] = generateTeamColors(purple);
export const yellowTeamColors: Colord[] = generateTeamColors(yellow);
export const orangeTeamColors: Colord[] = generateTeamColors(orange);
export const greenTeamColors: Colord[] = generateTeamColors(green);
export const botTeamColors: Colord[] = [botColor];

function generateTeamColors(baseColor: Colord): Colord[] {
  const hsl = baseColor.toHsl();
  const colorCount = 64;

  return Array.from({ length: colorCount }, (_, index) => {
    const progression = index / (colorCount - 1);

    const saturation = hsl.s * (1.0 - 0.3 * progression);
    const lightness = Math.min(100, hsl.l + progression * 30);

    return colord({
      h: hsl.h,
      s: saturation,
      l: lightness,
    });
  });
}

export const nationColors: Colord[] = [
  colord("rgb(210,210,100)"), // Lime Yellow
  colord("rgb(180,210,120)"), // Light Green
  colord("rgb(170,190,100)"), // Yellow Green
  colord("rgb(80,200,120)"), // Emerald Green
  colord("rgb(130,200,130)"), // Light Sea Green
  colord("rgb(140,180,140)"), // Dark Sea Green
  colord("rgb(160,190,160)"), // Pale Green
  colord("rgb(160,180,140)"), // Dark Olive Green
  colord("rgb(100,160,80)"), // Olive Green
  colord("rgb(100,140,110)"), // Sea Green
  colord("rgb(100,180,160)"), // Aquamarine
  colord("rgb(130,180,170)"), // Medium Aquamarine
  colord("rgb(170,190,180)"), // Pale Blue Green
  colord("rgb(100,130,150)"), // Steel Blue
  colord("rgb(120,160,200)"), // Cornflower Blue
  colord("rgb(140,150,180)"), // Light Slate Gray
  colord("rgb(100,210,210)"), // Turquoise
  colord("rgb(140,180,220)"), // Light Blue
  colord("rgb(130,170,190)"), // Cadet Blue
  colord("rgb(100,180,230)"), // Sky Blue
  colord("rgb(80,130,190)"), // Navy Blue
  colord("rgb(120,120,190)"), // Periwinkle
  colord("rgb(150,110,190)"), // Lavender
  colord("rgb(160,120,160)"), // Purple Gray
  colord("rgb(170,140,190)"), // Medium Purple
  colord("rgb(180,130,180)"), // Plum
  colord("rgb(190,140,150)"), // Puce
  colord("rgb(180,100,230)"), // Purple
  colord("rgb(180,160,180)"), // Mauve
  colord("rgb(170,150,170)"), // Dusty Rose
  colord("rgb(150,130,150)"), // Thistle
  colord("rgb(230,180,180)"), // Light Pink
  colord("rgb(210,160,200)"), // Orchid
  colord("rgb(230,130,180)"), // Pink
  colord("rgb(210,100,160)"), // Hot Pink
  colord("rgb(190,100,130)"), // Maroon
  colord("rgb(220,120,120)"), // Coral
  colord("rgb(200,130,110)"), // Dark Salmon
  colord("rgb(230,140,140)"), // Salmon
  colord("rgb(230,100,100)"), // Bright Red
  colord("rgb(230,150,100)"), // Peach
  colord("rgb(210,140,80)"), // Light Orange
  colord("rgb(230,180,80)"), // Golden Yellow
  colord("rgb(200,160,110)"), // Tan
  colord("rgb(190,150,130)"), // Rosy Brown
  colord("rgb(190,180,160)"), // Tan Gray
  colord("rgb(180,170,140)"), // Dark Khaki
  colord("rgb(200,200,140)"), // Khaki
  colord("rgb(190,170,100)"), // Sand
];

// Bright pastel theme with 64 colors
export const humanColors: Colord[] = [
  colord("rgb(163,230,53)"), // Yellow Green
  colord("rgb(132,204,22)"), // Lime
  colord("rgb(16,185,129)"), // Sea Green
  colord("rgb(52,211,153)"), // Spearmint
  colord("rgb(45,212,191)"), // Turquoise
  colord("rgb(74,222,128)"), // Mint
  colord("rgb(110,231,183)"), // Seafoam
  colord("rgb(134,239,172)"), // Light Green
  colord("rgb(151,255,187)"), // Fresh Mint
  colord("rgb(186,255,201)"), // Pale Emerald
  colord("rgb(230,250,210)"), // Pastel Lime
  colord("rgb(34,197,94)"), // Emerald
  colord("rgb(67,190,84)"), // Fresh Green
  colord("rgb(82,183,136)"), // Jade
  colord("rgb(48,178,180)"), // Teal
  colord("rgb(230,255,250)"), // Mint Whisper
  colord("rgb(220,240,250)"), // Ice Blue
  colord("rgb(233,213,255)"), // Light Lilac
  colord("rgb(204,204,255)"), // Soft Lavender Blue
  colord("rgb(220,220,255)"), // Meringue Blue
  colord("rgb(202,225,255)"), // Baby Blue
  colord("rgb(147,197,253)"), // Powder Blue
  colord("rgb(125,211,252)"), // Crystal Blue
  colord("rgb(99,202,253)"), // Azure
  colord("rgb(56,189,248)"), // Light Blue
  colord("rgb(96,165,250)"), // Sky Blue
  colord("rgb(59,130,246)"), // Royal Blue
  colord("rgb(79,70,229)"), // Indigo
  colord("rgb(124,58,237)"), // Royal Purple
  colord("rgb(147,51,234)"), // Bright Purple
  colord("rgb(179,136,255)"), // Light Purple
  colord("rgb(167,139,250)"), // Periwinkle
  colord("rgb(217,70,239)"), // Fuchsia
  colord("rgb(168,85,247)"), // Vibrant Purple
  colord("rgb(190,92,251)"), // Amethyst
  colord("rgb(192,132,252)"), // Lavender
  colord("rgb(240,171,252)"), // Orchid
  colord("rgb(244,114,182)"), // Rose
  colord("rgb(236,72,153)"), // Deep Pink
  colord("rgb(220,38,38)"), // Ruby
  colord("rgb(239,68,68)"), // Crimson
  colord("rgb(235,75,75)"), // Bright Red
  colord("rgb(245,101,101)"), // Coral
  colord("rgb(248,113,113)"), // Warm Red
  colord("rgb(251,113,133)"), // Watermelon
  colord("rgb(253,164,175)"), // Salmon Pink
  colord("rgb(252,165,165)"), // Peach
  colord("rgb(255,204,229)"), // Blush Pink
  colord("rgb(250,215,225)"), // Cotton Candy
  colord("rgb(251,235,245)"), // Rose Powder
  colord("rgb(240,240,200)"), // Light Khaki
  colord("rgb(250,250,210)"), // Pastel Lemon
  colord("rgb(255,240,200)"), // Vanilla
  colord("rgb(255,223,186)"), // Apricot Cream
  colord("rgb(252,211,77)"), // Golden
  colord("rgb(251,191,36)"), // Marigold
  colord("rgb(234,179,8)"), // Sunflower
  colord("rgb(202,138,4)"), // Rich Gold
  colord("rgb(245,158,11)"), // Amber
  colord("rgb(251,146,60)"), // Light Orange
  colord("rgb(249,115,22)"), // Tangerine
  colord("rgb(234,88,12)"), // Burnt Orange
  colord("rgb(133,77,14)"), // Chocolate
];

export const botColors: Colord[] = [
  colord("rgb(150,160,140)"), // Muted Dark Olive Green
  colord("rgb(160,160,150)"), // Muted Tan Gray
  colord("rgb(170,170,140)"), // Muted Khaki
  colord("rgb(170,170,120)"), // Muted Lime Yellow
  colord("rgb(150,160,120)"), // Muted Yellow Green
  colord("rgb(150,170,130)"), // Muted Light Green
  colord("rgb(150,170,150)"), // Muted Pale Green
  colord("rgb(130,170,130)"), // Muted Light Sea Green
  colord("rgb(140,160,140)"), // Muted Dark Sea Green
  colord("rgb(120,150,100)"), // Muted Olive Green
  colord("rgb(120,140,120)"), // Muted Sea Green
  colord("rgb(100,170,130)"), // Muted Emerald Green
  colord("rgb(120,160,150)"), // Muted Aquamarine
  colord("rgb(130,160,150)"), // Muted Medium Aquamarine
  colord("rgb(120,170,170)"), // Muted Turquoise
  colord("rgb(120,160,190)"), // Muted Sky Blue
  colord("rgb(130,150,170)"), // Muted Cornflower Blue
  colord("rgb(130,150,160)"), // Muted Cadet Blue
  colord("rgb(140,150,160)"), // Muted Light Slate Gray
  colord("rgb(140,160,170)"), // Muted Light Blue
  colord("rgb(150,160,160)"), // Muted Pale Blue Green
  colord("rgb(100,120,160)"), // Muted Navy Blue
  colord("rgb(120,130,140)"), // Muted Steel Blue
  colord("rgb(130,130,160)"), // Muted Periwinkle
  colord("rgb(140,130,140)"), // Muted Thistle
  colord("rgb(140,120,160)"), // Muted Lavender
  colord("rgb(150,130,150)"), // Muted Purple Gray
  colord("rgb(150,140,160)"), // Muted Medium Purple
  colord("rgb(160,130,160)"), // Muted Plum
  colord("rgb(170,150,170)"), // Muted Orchid
  colord("rgb(160,120,190)"), // Muted Purple
  colord("rgb(160,120,130)"), // Muted Maroon
  colord("rgb(170,120,140)"), // Muted Hot Pink
  colord("rgb(170,130,120)"), // Muted Dark Salmon
  colord("rgb(170,130,130)"), // Muted Coral
  colord("rgb(180,140,140)"), // Muted Salmon
  colord("rgb(190,130,160)"), // Muted Pink
  colord("rgb(190,120,120)"), // Muted Red
  colord("rgb(190,140,120)"), // Muted Peach
  colord("rgb(190,160,100)"), // Muted Golden Yellow
  colord("rgb(170,140,100)"), // Muted Light Orange
  colord("rgb(160,140,130)"), // Muted Rosy Brown
  colord("rgb(170,150,130)"), // Muted Tan
  colord("rgb(160,150,120)"), // Muted Sand
  colord("rgb(160,150,140)"), // Muted Dark Khaki
  colord("rgb(160,140,150)"), // Muted Puce
  colord("rgb(160,150,160)"), // Muted Mauve
  colord("rgb(150,140,150)"), // Muted Dusty Rose
  colord("rgb(180,160,160)"), // Muted Light Pink
];

// Fallback colors for when the color palette is exhausted.
export const fallbackColors: Colord[] = [
  colord("rgb(35,0,0)"),
  colord("rgb(45,0,0)"),
  colord("rgb(55,0,0)"),
  colord("rgb(65,0,0)"),
  colord("rgb(75,0,0)"),
  colord("rgb(85,0,0)"),
  colord("rgb(95,0,0)"),
  colord("rgb(105,0,0)"),
  colord("rgb(115,0,0)"),
  colord("rgb(125,0,0)"),
  colord("rgb(135,0,0)"),
  colord("rgb(145,0,0)"),
  colord("rgb(155,0,0)"),
  colord("rgb(165,0,0)"),
  colord("rgb(175,0,0)"),
  colord("rgb(185,0,0)"),
  colord("rgb(195,0,5)"),
  colord("rgb(205,0,10)"),
  colord("rgb(215,0,15)"),
  colord("rgb(225,0,20)"),
  colord("rgb(235,0,25)"),
  colord("rgb(245,0,30)"),
  colord("rgb(255,0,35)"),
  colord("rgb(255,10,45)"),
  colord("rgb(255,20,55)"),
  colord("rgb(255,30,65)"),
  colord("rgb(255,40,75)"),
  colord("rgb(255,50,85)"),
  colord("rgb(255,60,95)"),
  colord("rgb(255,70,105)"),
  colord("rgb(255,80,115)"),
  colord("rgb(255,90,125)"),
  colord("rgb(255,100,135)"),
  colord("rgb(255,110,145)"),
  colord("rgb(255,120,155)"),
  colord("rgb(255,130,165)"),
  colord("rgb(255,140,175)"),
  colord("rgb(255,150,185)"),
  colord("rgb(255,160,195)"),
  colord("rgb(255,170,205)"),
  colord("rgb(255,180,215)"),
  colord("rgb(255,190,225)"),
  colord("rgb(255,200,235)"),
  colord("rgb(0,45,0)"),
  colord("rgb(0,55,0)"),
  colord("rgb(0,65,0)"),
  colord("rgb(0,75,0)"),
  colord("rgb(0,85,0)"),
  colord("rgb(0,95,0)"),
  colord("rgb(0,105,0)"),
  colord("rgb(0,115,0)"),
  colord("rgb(0,125,0)"),
  colord("rgb(0,135,0)"),
  colord("rgb(0,145,0)"),
  colord("rgb(0,155,0)"),
  colord("rgb(0,165,0)"),
  colord("rgb(0,175,0)"),
  colord("rgb(0,185,0)"),
  colord("rgb(0,195,5)"),
  colord("rgb(0,205,10)"),
  colord("rgb(0,215,15)"),
  colord("rgb(0,225,20)"),
  colord("rgb(0,235,25)"),
  colord("rgb(0,245,30)"),
  colord("rgb(0,255,35)"),
  colord("rgb(10,255,45)"),
  colord("rgb(20,255,55)"),
  colord("rgb(30,255,65)"),
  colord("rgb(40,255,75)"),
  colord("rgb(50,255,85)"),
  colord("rgb(60,255,95)"),
  colord("rgb(70,255,105)"),
  colord("rgb(80,255,115)"),
  colord("rgb(90,255,125)"),
  colord("rgb(100,255,135)"),
  colord("rgb(110,255,145)"),
  colord("rgb(120,255,155)"),
  colord("rgb(130,255,165)"),
  colord("rgb(140,255,175)"),
  colord("rgb(150,255,185)"),
  colord("rgb(160,255,195)"),
  colord("rgb(170,255,205)"),
  colord("rgb(180,255,215)"),
  colord("rgb(190,255,225)"),
  colord("rgb(200,255,235)"),
  colord("rgb(0,0,35)"),
  colord("rgb(0,0,45)"),
  colord("rgb(0,0,55)"),
  colord("rgb(0,0,65)"),
  colord("rgb(0,0,75)"),
  colord("rgb(0,0,85)"),
  colord("rgb(0,0,95)"),
  colord("rgb(0,0,105)"),
  colord("rgb(0,0,115)"),
  colord("rgb(0,0,125)"),
  colord("rgb(0,0,135)"),
  colord("rgb(0,0,145)"),
  colord("rgb(0,0,155)"),
  colord("rgb(0,0,165)"),
  colord("rgb(0,0,175)"),
  colord("rgb(0,0,185)"),
  colord("rgb(5,0,195)"),
  colord("rgb(10,0,205)"),
  colord("rgb(15,0,215)"),
  colord("rgb(20,0,225)"),
  colord("rgb(25,0,235)"),
  colord("rgb(30,0,245)"),
  colord("rgb(35,0,255)"),
  colord("rgb(45,10,255)"),
  colord("rgb(55,20,255)"),
  colord("rgb(65,30,255)"),
  colord("rgb(75,40,255)"),
  colord("rgb(85,50,255)"),
  colord("rgb(95,60,255)"),
  colord("rgb(105,70,255)"),
  colord("rgb(115,80,255)"),
  colord("rgb(125,90,255)"),
  colord("rgb(135,100,255)"),
  colord("rgb(145,110,255)"),
  colord("rgb(155,120,255)"),
  colord("rgb(165,130,255)"),
  colord("rgb(175,140,255)"),
  colord("rgb(185,150,255)"),
  colord("rgb(195,160,255)"),
  colord("rgb(205,170,255)"),
  colord("rgb(215,180,255)"),
  colord("rgb(225,190,255)"),
  colord("rgb(235,200,255)"),
  colord("rgb(35,0,35)"),
  colord("rgb(45,0,45)"),
  colord("rgb(55,0,55)"),
  colord("rgb(65,0,65)"),
  colord("rgb(75,0,75)"),
  colord("rgb(85,0,85)"),
  colord("rgb(95,0,95)"),
  colord("rgb(105,0,105)"),
  colord("rgb(115,0,115)"),
  colord("rgb(125,0,125)"),
  colord("rgb(135,0,135)"),
  colord("rgb(145,0,145)"),
  colord("rgb(155,0,155)"),
  colord("rgb(165,0,165)"),
  colord("rgb(175,0,175)"),
  colord("rgb(185,0,185)"),
  colord("rgb(195,5,195)"),
  colord("rgb(205,10,205)"),
  colord("rgb(215,15,215)"),
  colord("rgb(225,20,225)"),
  colord("rgb(235,25,235)"),
  colord("rgb(245,30,245)"),
  colord("rgb(255,35,255)"),
  colord("rgb(255,45,255)"),
  colord("rgb(255,55,255)"),
  colord("rgb(255,65,255)"),
  colord("rgb(255,75,255)"),
  colord("rgb(255,85,255)"),
  colord("rgb(255,95,255)"),
  colord("rgb(255,105,255)"),
  colord("rgb(255,115,255)"),
  colord("rgb(255,125,255)"),
  colord("rgb(255,135,255)"),
  colord("rgb(255,145,255)"),
  colord("rgb(255,155,255)"),
  colord("rgb(255,165,255)"),
  colord("rgb(255,175,255)"),
  colord("rgb(255,185,255)"),
  colord("rgb(255,195,255)"),
  colord("rgb(255,205,255)"),
  colord("rgb(255,215,255)"),
  colord("rgb(0,35,35)"),
  colord("rgb(0,45,45)"),
  colord("rgb(0,55,55)"),
  colord("rgb(0,65,65)"),
  colord("rgb(0,75,75)"),
  colord("rgb(0,85,85)"),
  colord("rgb(0,95,95)"),
  colord("rgb(0,105,105)"),
  colord("rgb(0,115,115)"),
  colord("rgb(0,125,125)"),
  colord("rgb(0,135,135)"),
  colord("rgb(0,145,145)"),
  colord("rgb(0,155,155)"),
  colord("rgb(0,165,165)"),
  colord("rgb(0,175,175)"),
  colord("rgb(0,185,185)"),
  colord("rgb(5,195,195)"),
  colord("rgb(10,205,205)"),
  colord("rgb(15,215,215)"),
  colord("rgb(20,225,225)"),
  colord("rgb(25,235,235)"),
  colord("rgb(30,245,245)"),
  colord("rgb(35,255,255)"),
  colord("rgb(45,255,255)"),
  colord("rgb(55,255,255)"),
  colord("rgb(65,255,255)"),
  colord("rgb(75,255,255)"),
  colord("rgb(85,255,255)"),
  colord("rgb(95,255,255)"),
  colord("rgb(105,255,255)"),
  colord("rgb(115,255,255)"),
  colord("rgb(125,255,255)"),
  colord("rgb(135,255,255)"),
  colord("rgb(145,255,255)"),
  colord("rgb(155,255,255)"),
  colord("rgb(165,255,255)"),
  colord("rgb(175,255,255)"),
  colord("rgb(185,255,255)"),
  colord("rgb(195,255,255)"),
  colord("rgb(205,255,255)"),
  colord("rgb(215,255,255)"),
  colord("rgb(35,35,0)"),
  colord("rgb(45,45,0)"),
  colord("rgb(55,55,0)"),
  colord("rgb(65,65,0)"),
  colord("rgb(75,75,0)"),
  colord("rgb(85,85,0)"),
  colord("rgb(95,95,0)"),
  colord("rgb(105,105,0)"),
  colord("rgb(115,115,0)"),
  colord("rgb(125,125,0)"),
  colord("rgb(135,135,0)"),
  colord("rgb(145,145,0)"),
  colord("rgb(155,155,0)"),
  colord("rgb(165,165,0)"),
  colord("rgb(175,175,0)"),
  colord("rgb(185,185,0)"),
  colord("rgb(195,195,5)"),
  colord("rgb(205,205,10)"),
  colord("rgb(215,215,15)"),
  colord("rgb(225,225,20)"),
  colord("rgb(235,235,25)"),
  colord("rgb(245,245,30)"),
  colord("rgb(255,255,35)"),
  colord("rgb(255,255,45)"),
  colord("rgb(255,255,55)"),
  colord("rgb(255,255,65)"),
  colord("rgb(255,255,75)"),
  colord("rgb(255,255,85)"),
  colord("rgb(255,255,95)"),
  colord("rgb(255,255,105)"),
  colord("rgb(255,255,115)"),
  colord("rgb(255,255,125)"),
  colord("rgb(255,255,135)"),
  colord("rgb(255,255,145)"),
  colord("rgb(255,255,155)"),
  colord("rgb(255,255,165)"),
  colord("rgb(255,255,175)"),
  colord("rgb(255,255,185)"),
  colord("rgb(255,255,195)"),
  colord("rgb(255,255,205)"),
  colord("rgb(255,255,215)"),
  colord("rgb(215,255,200)"), // Fresh Mint
  colord("rgb(225,255,175)"), // Soft Lime
  colord("rgb(240,250,160)"), // Citrus Wash
  colord("rgb(245,245,175)"), // Lemon Mist
  colord("rgb(150,200,255)"), // Cornflower Mist
  colord("rgb(160,215,255)"), // Powder Blue
  colord("rgb(170,225,255)"), // Baby Sky
  colord("rgb(180,235,250)"), // Aqua Pastel
  colord("rgb(190,245,240)"), // Ice Mint
  colord("rgb(210,255,245)"), // Sea Mist
  colord("rgb(220,255,255)"), // Pale Aqua
  colord("rgb(230,250,255)"), // Sky Haze
  colord("rgb(240,240,255)"), // Frosted Lilac
  colord("rgb(250,230,255)"), // Misty Mauve
  colord("rgb(170,190,255)"), // Periwinkle Ice
  colord("rgb(180,180,255)"), // Pale Indigo
  colord("rgb(200,170,255)"), // Lilac Bloom
  colord("rgb(190,140,195)"), // Fuchsia Tint
  colord("rgb(195,145,200)"), // Dusky Rose
  colord("rgb(200,150,205)"), // Plum Frost
  colord("rgb(205,155,210)"), // Berry Foam
  colord("rgb(210,160,215)"), // Grape Cloud
  colord("rgb(215,165,220)"), // Light Bloom
  colord("rgb(220,170,225)"), // Cherry Blossom
  colord("rgb(225,175,230)"), // Faded Rose
  colord("rgb(230,180,235)"), // Dreamy Mauve
  colord("rgb(235,185,240)"), // Powder Violet
  colord("rgb(240,190,245)"), // Pastel Violet
  colord("rgb(245,195,250)"), // Soft Magenta
  colord("rgb(250,200,255)"), // Lilac Cream
  colord("rgb(255,205,255)"), // Violet Bloom
  colord("rgb(255,210,255)"), // Orchid Mist
  colord("rgb(255,210,250)"), // Lavender Mist
  colord("rgb(255,205,245)"), // Pastel Orchid
  colord("rgb(255,215,245)"), // Rose Whisper
  colord("rgb(220,160,255)"), // Violet Mist
  colord("rgb(235,150,255)"), // Orchid Glow
  colord("rgb(245,160,240)"), // Rose Lilac
  colord("rgb(255,170,225)"), // Bubblegum Pink
  colord("rgb(255,185,215)"), // Blush Mist
  colord("rgb(255,195,235)"), // Faded Fuchsia
  colord("rgb(255,200,220)"), // Cotton Rose
  colord("rgb(255,210,230)"), // Pastel Blush
  colord("rgb(255,220,235)"), // Pink Mist
  colord("rgb(255,220,250)"), // Powder Petal
  colord("rgb(255,225,255)"), // Petal Mist
  colord("rgb(255,230,245)"), // Light Rose
  colord("rgb(255,235,235)"), // Blushed Petal
  colord("rgb(255,215,195)"), // Apricot Glow
  colord("rgb(255,225,180)"), // Butter Peach
  colord("rgb(255,230,190)"),
  colord("rgb(255,235,200)"), // Cream Peach
  colord("rgb(255,245,210)"), // Soft Banana
  colord("rgb(255,240,220)"), // Pastel Sand
];
