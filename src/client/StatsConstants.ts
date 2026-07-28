export const COLUMN_IDS = [
  "rank",
  "clan",
  "player",
  "team",
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

export const DEFAULT_STATS_COLUMNS = {
  player: ["clan", "tiles", "gold", "maxtroops"],
  team: ["tiles", "gold", "maxtroops"],
} as const satisfies Record<StatsTableKind, readonly ColumnId[]>;

export type StatsTableKind = "player" | "team";
