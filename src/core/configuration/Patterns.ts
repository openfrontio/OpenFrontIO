import { Team } from "../game/Game";

export enum PatternType {
  DiagonalRight = "diagonal_right",
  Horizontal = "horizontal",
  Vertical = "vertical",
  Crosshatch = "crosshatch",
  Dots = "dots",
  DiagonalLeft = "diagonal_left",
  Grid = "grid",
  None = "none",
}

const TEAM_PATTERN_MAP: Record<string, PatternType> = {
  Red: PatternType.DiagonalRight,
  Blue: PatternType.Horizontal,
  Teal: PatternType.Vertical,
  Purple: PatternType.Crosshatch,
  Yellow: PatternType.Dots,
  Orange: PatternType.DiagonalLeft,
  Green: PatternType.Grid,
  Bot: PatternType.None,
  Humans: PatternType.DiagonalRight,
  Nations: PatternType.Horizontal,
};

export function getTeamPattern(team: Team | null): PatternType {
  if (team === null) return PatternType.None;
  return TEAM_PATTERN_MAP[team] ?? PatternType.None;
}

const PATTERN_CYCLE: PatternType[] = [
  PatternType.DiagonalRight,
  PatternType.Horizontal,
  PatternType.Vertical,
  PatternType.Crosshatch,
  PatternType.Dots,
  PatternType.DiagonalLeft,
  PatternType.Grid,
];

export function getPatternByIndex(index: number): PatternType {
  const len = PATTERN_CYCLE.length;
  return PATTERN_CYCLE[((index % len) + len) % len];
}

export function isPatternPixel(
  x: number,
  y: number,
  type: PatternType,
): boolean {
  switch (type) {
    case PatternType.DiagonalRight:
      return ((x + y) & 3) === 0;
    case PatternType.Horizontal:
      return (y & 3) === 0;
    case PatternType.Vertical:
      return (x & 3) === 0;
    case PatternType.Crosshatch:
      return ((x + y) & 3) === 0 || ((x - y + 256) & 3) === 0;
    case PatternType.Dots:
      return (x & 3) === 1 && (y & 3) === 1;
    case PatternType.DiagonalLeft:
      return ((x - y + 256) & 3) === 0;
    case PatternType.Grid:
      return (x & 3) === 0 || (y & 3) === 0;
    case PatternType.None:
      return false;
  }
}

const LUT_SIZE = 16;

export class PatternLUT {
  private tables: Map<PatternType, Uint8Array> = new Map();

  constructor() {
    for (const type of Object.values(PatternType)) {
      if (type === PatternType.None) continue;
      const lut = new Uint8Array(LUT_SIZE * LUT_SIZE);
      for (let y = 0; y < LUT_SIZE; y++) {
        for (let x = 0; x < LUT_SIZE; x++) {
          lut[y * LUT_SIZE + x] = isPatternPixel(x, y, type) ? 1 : 0;
        }
      }
      this.tables.set(type, lut);
    }
  }

  isPattern(x: number, y: number, type: PatternType): boolean {
    if (type === PatternType.None) return false;
    const lut = this.tables.get(type);
    if (!lut) return false;
    return lut[(y & 15) * LUT_SIZE + (x & 15)] === 1;
  }
}

export function applyPatternDarken(
  r: number,
  g: number,
  b: number,
  opacity: number,
): [number, number, number] {
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  if (luminance > 160) {
    const factor = 1.0 - opacity;
    return [
      Math.round(r * factor),
      Math.round(g * factor),
      Math.round(b * factor),
    ];
  }
  return [
    Math.min(255, Math.round(r + (255 - r) * opacity)),
    Math.min(255, Math.round(g + (255 - g) * opacity)),
    Math.min(255, Math.round(b + (255 - b) * opacity)),
  ];
}
