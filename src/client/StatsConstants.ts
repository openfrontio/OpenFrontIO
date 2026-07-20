export const COLUMN_IDS = [
  "tiles",
  "gold",
  "troops",
  "maxtroops",
  "cities",
  "ports",
  "factories",
  "silos",
  "sams",
  "warships",
  "allies",
  "betrayals",
] as const;

export type ColumnId = (typeof COLUMN_IDS)[number];

export const DEFAULT_STATS_COLUMNS = [
  "tiles",
  "gold",
  "maxtroops",
] as const satisfies readonly ColumnId[];

export type StatsTableKind = "player" | "team";
