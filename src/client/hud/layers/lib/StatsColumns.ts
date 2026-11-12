import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { renderNumber, renderTroops } from "@openfront/engine-lib/Format";
import type { OfIconName } from "../../../components/OfIcon";
import type { ColumnId, StatsTableKind } from "../../../StatsConstants";
import { formatPercentage, translateText } from "../../../Utils";
import type { GameView, PlayerView } from "../../../view";
import { goldRateTracker } from "./GoldRateTracker";

export { type ColumnId } from "../../../StatsConstants";

export type ColumnHeaderVisual =
  | {
      readonly kind: "icon";
      readonly icon: OfIconName;
      /** Text colour class for icons whose colour carries meaning. */
      readonly color?: string;
      /** Small icon or text rendered as a superscript on the main icon. */
      readonly superscript?:
        | { readonly icon: OfIconName }
        | { readonly text: string };
    }
  // Text is a translation key ("leaderboard.type") or a literal symbol
  // ("#" reads the same in every language and falls back to itself).
  | { readonly kind: "text"; readonly text: string };
export type ColumnAlignment = "start" | "center" | "end";

/** One row as a column sees it. `value` is that column's own number. */
export interface ColumnRow {
  readonly position: number;
  readonly name: string;
  readonly clanTag?: string | null;
  readonly value: number;
}

export type ValueGetter = (player: PlayerView, game: GameView) => number;

export interface ColumnDef {
  readonly id: ColumnId;
  /** Tooltip copy, and the header text when there is no headerVisual. */
  readonly labelKey: string;
  readonly headerVisual?: ColumnHeaderVisual;
  /** The column menu's icon, for a column whose header is a word. */
  readonly menuIcon?: OfIconName;
  /** Grid track: a fixed width, or "auto" to share the row's spare width. */
  readonly width: string;
  /**
   * Texts as wide as anything this column shows. A hidden row of them sizes
   * the track, so widths hold while values change and rows scroll. Empty
   * for a fixed track.
   */
  readonly widest: () => readonly string[];
  readonly align: ColumnAlignment;
  /** The header's own alignment, when it reads better than `align`'s. */
  readonly headerAlign?: ColumnAlignment;
  /** Tables this column appears on. */
  readonly kinds: readonly StatsTableKind[];
  /** Offered in the ⚙️ menu; non-hideable columns always render. */
  readonly isHideable: boolean;
  /** Header is a sort button. True exactly when `value` is set. */
  readonly isOrderable: boolean;
  /** Number behind the column — sorting and team totals. */
  readonly value?: ValueGetter;
  readonly cell: (row: ColumnRow, game: GameView) => string;
}

type ColumnInput = Pick<ColumnDef, "id" | "labelKey" | "cell"> &
  Partial<Omit<ColumnDef, "id" | "labelKey" | "cell" | "isOrderable">>;

function defineColumn(input: ColumnInput): ColumnDef {
  return {
    width: "auto",
    widest: () => ["88.8M"],
    align: "end",
    kinds: ["player", "team"],
    isHideable: true,
    ...input,
    isOrderable: input.value !== undefined,
  };
}

function unitColumn(
  id: ColumnId,
  labelKey: string,
  unitType: UnitType,
  icon: OfIconName,
): ColumnDef {
  return defineColumn({
    id,
    labelKey,
    headerVisual: { kind: "icon", icon },
    widest: () => ["888"],
    align: "center",
    value: (player) => player.totalUnitLevels(unitType),
    cell: (row) => renderNumber(row.value),
  });
}

const troopHeaderVisual = {
  kind: "icon",
  icon: "troops",
} as const satisfies ColumnHeaderVisual;

// This registry is the source of truth for column IDs and display order.
export const COLUMN_DEFS: readonly ColumnDef[] = [
  defineColumn({
    id: "rank",
    labelKey: "leaderboard.rank",
    headerVisual: { kind: "text", text: "#" },
    // Three-digit ranks at 11px, with the cell's padding.
    width: "30px",
    widest: () => [],
    align: "center",
    isHideable: false,
    cell: (row) => String(row.position),
  }),
  defineColumn({
    id: "clan",
    labelKey: "leaderboard.clan",
    headerVisual: { kind: "icon", icon: "clan" },
    // Fits "WWWWW" — the widest 5-character tag — in the row font.
    width: "80px",
    widest: () => [],
    align: "center",
    kinds: ["player"],
    cell: (row) => row.clanTag ?? "",
  }),
  defineColumn({
    id: "player",
    labelKey: "leaderboard.player",
    headerVisual: { kind: "icon", icon: "player" },
    // The table widens it on large windows (--stats-name) and adds the
    // colour chip's room (--stats-chip), so names keep theirs. It gives up
    // the room a host leaves at the table's end (--stats-end-track), so the
    // table keeps its width.
    width:
      "calc(var(--stats-name, 100px) + var(--stats-chip, 0.75rem) - var(--stats-end-track, 0px))",
    widest: () => [],
    align: "start",
    headerAlign: "center",
    kinds: ["player"],
    isHideable: false,
    cell: (row) => row.name,
  }),
  defineColumn({
    id: "playerType",
    labelKey: "leaderboard.playerType",
    headerVisual: { kind: "text", text: "leaderboard.type" },
    menuIcon: "player-type",
    // Player-table only: a team has no single type, and aggregating the
    // per-player type codes would be meaningless.
    kinds: ["player"],
    widest: () => [
      translateText("player_type.player"),
      translateText("player_type.nation"),
      translateText("player_type.bot"),
    ],
    // Shared track: the cell reads row.value, so this column needs a value
    // getter — and the registry ties "auto" width to having one.
    align: "center",
    value: (player) => {
      switch (player.type()) {
        case PlayerType.Human:
          return 0;
        case PlayerType.Nation:
          return 1;
        case PlayerType.Bot:
          return 2;
        default:
          return 3;
      }
    },
    cell: (row) => {
      // Reuses the player_type.* keys so the Type column matches the
      // player info overlay (bots are called "Tribes" in the UI).
      switch (row.value) {
        case 0:
          return translateText("player_type.player");
        case 1:
          return translateText("player_type.nation");
        case 2:
          return translateText("player_type.bot");
        default:
          return "?";
      }
    },
  }),
  defineColumn({
    id: "team",
    labelKey: "leaderboard.team",
    headerVisual: { kind: "icon", icon: "team" },
    // Gives up the room a host leaves at the table's end (--stats-end-track),
    // so the table keeps its width.
    width: "calc(var(--stats-name, 100px) - var(--stats-end-track, 0px))",
    widest: () => [],
    align: "start",
    headerAlign: "center",
    kinds: ["team"],
    isHideable: false,
    cell: (row) => row.name,
  }),
  defineColumn({
    id: "tiles",
    labelKey: "leaderboard.owned",
    headerVisual: { kind: "icon", icon: "land" },
    // A full 100.0% only shows once the game is over.
    widest: () => ["99.9%"],
    value: (player) => player.numTilesOwned(),
    cell: (row, game) => {
      const validTiles = game.numLandTiles() - game.numTilesWithFallout();
      return formatPercentage(validTiles > 0 ? row.value / validTiles : 0);
    },
  }),
  defineColumn({
    id: "gold",
    labelKey: "leaderboard.gold",
    headerVisual: { kind: "icon", icon: "gold" },
    headerAlign: "center",
    // Gold is a bigint, but game values remain safely below Number.MAX_SAFE_INTEGER.
    value: (player) => Number(player.gold()),
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "goldIncomePerMin",
    labelKey: "leaderboard.goldIncomePerMin",
    headerVisual: {
      kind: "icon",
      icon: "gold",
      superscript: { text: "/m" },
    },
    value: (player) => goldRateTracker.goldIncomePerMin(player.smallID()),
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "shipTradeGoldPerMin",
    labelKey: "leaderboard.shipTradeGoldPerMin",
    headerVisual: {
      kind: "icon",
      icon: "port",
      superscript: { text: "/m" },
    },
    value: (player) => goldRateTracker.shipTradeGoldPerMin(player.smallID()),
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "piracyGoldPerMin",
    labelKey: "leaderboard.piracyGoldPerMin",
    headerVisual: {
      kind: "icon",
      icon: "warship",
      superscript: { text: "/m" },
    },
    value: (player) => goldRateTracker.piracyGoldPerMin(player.smallID()),
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "trainTradeGoldPerMin",
    labelKey: "leaderboard.trainTradeGoldPerMin",
    headerVisual: {
      kind: "icon",
      icon: "factory",
      superscript: { text: "/m" },
    },
    value: (player) => goldRateTracker.trainTradeGoldPerMin(player.smallID()),
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "troops",
    labelKey: "leaderboard.troops",
    headerVisual: troopHeaderVisual,
    value: (player) => player.troops(),
    cell: (row) => renderTroops(row.value),
  }),
  defineColumn({
    id: "maxtroops",
    labelKey: "leaderboard.maxtroops",
    headerVisual: {
      ...troopHeaderVisual,
      superscript: { icon: "max" },
    },
    headerAlign: "center",
    value: (player, game) => game.config().maxTroops(player),
    cell: (row) => renderTroops(row.value),
  }),
  unitColumn("cities", "leaderboard.cities", UnitType.City, "city"),
  unitColumn("ports", "leaderboard.ports", UnitType.Port, "port"),
  unitColumn("factories", "leaderboard.factories", UnitType.Factory, "factory"),
  unitColumn(
    "silos",
    "leaderboard.launchers",
    UnitType.MissileSilo,
    "missile-silo",
  ),
  unitColumn("sams", "leaderboard.sams", UnitType.SAMLauncher, "sam-launcher"),
  unitColumn("warships", "leaderboard.warships", UnitType.Warship, "warship"),
  defineColumn({
    id: "allies",
    labelKey: "leaderboard.allies",
    headerVisual: { kind: "icon", icon: "alliance", color: "text-green-400" },
    widest: () => ["88"],
    align: "center",
    value: (player) => player.allies().length,
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "betrayals",
    labelKey: "leaderboard.betrayals",
    headerVisual: { kind: "icon", icon: "traitor", color: "text-red-400" },
    widest: () => ["88"],
    align: "center",
    value: (player) => player.betrayals(),
    cell: (row) => renderNumber(row.value),
  }),
];

export function columnsFor(kind: StatsTableKind): readonly ColumnDef[] {
  return COLUMN_DEFS.filter((column) => column.kinds.includes(kind));
}

/**
 * Feed the gold-rate tracker with every living player's cumulative values and
 * drop the history of the dead. Call once per refresh: the rate columns of
 * both tables read back from it.
 */
export function recordGoldRates(game: GameView): void {
  for (const player of game.playerViews()) {
    if (!player.isAlive()) {
      goldRateTracker.forget(player.smallID());
      continue;
    }
    goldRateTracker.record(
      player.smallID(),
      {
        income: player.goldEarned(),
        trade: player.tradeGold(),
        train: player.trainGold(),
        piracy: player.piracyGold(),
      },
      game.ticks(),
    );
  }
}

export function columnValues(
  player: PlayerView,
  game: GameView,
  columns: readonly ColumnDef[],
): ReadonlyMap<ColumnId, number> {
  const values = new Map<ColumnId, number>();
  for (const column of columns) {
    if (column.value === undefined) continue;
    values.set(column.id, column.value(player, game));
  }
  return values;
}

const COLUMNS_BY_ID = new Map<ColumnId, ColumnDef>(
  COLUMN_DEFS.map((column) => [column.id, column] as const),
);

export function columnById(id: ColumnId): ColumnDef {
  return COLUMNS_BY_ID.get(id)!;
}
