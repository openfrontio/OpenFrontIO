import { PlayerType, UnitType } from "../../../../core/game/Game";
import type { ColumnId, StatsTableKind } from "../../../StatsConstants";
import {
  formatPercentage,
  renderNumber,
  renderTroops,
  translateText,
} from "../../../Utils";
import type { GameView, PlayerView } from "../../../view";
import {
  allianceIcon,
  cityIcon,
  claimIcon,
  factoryIcon,
  goldCoinIcon,
  guildIcon,
  missileSiloIcon,
  portIcon,
  profileIcon,
  samLauncherIcon,
  soldierIcon,
  teamIcon,
  traitorIcon,
  upperLimitIcon,
  warshipIcon,
} from "../../HotbarIcons";
import { goldRateTracker } from "./GoldRateTracker";

export {
  COLUMN_IDS,
  DEFAULT_STATS_COLUMNS,
  type ColumnId,
} from "../../../StatsConstants";

export type ColumnHeaderVisual =
  | {
      readonly kind: "icon";
      readonly src: string;
      readonly white?: true;
      /** Small icon or text rendered as a superscript on the main icon. */
      readonly superscript?:
        | { readonly src: string; readonly white?: true }
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
  /** Grid track: a fixed width, or "auto" to share the row's spare width. */
  readonly width: string;
  readonly align: ColumnAlignment;
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
  icon: string,
): ColumnDef {
  return defineColumn({
    id,
    labelKey,
    headerVisual: { kind: "icon", src: icon },
    align: "center",
    value: (player) => player.totalUnitLevels(unitType),
    cell: (row) => renderNumber(row.value),
  });
}

const troopHeaderVisual = {
  kind: "icon",
  src: soldierIcon,
  white: true,
} as const satisfies ColumnHeaderVisual;

// This registry is the source of truth for column IDs and display order.
export const COLUMN_DEFS: readonly ColumnDef[] = [
  defineColumn({
    id: "rank",
    labelKey: "leaderboard.rank",
    headerVisual: { kind: "text", text: "#" },
    width: "34px",
    align: "center",
    isHideable: false,
    cell: (row) => String(row.position),
  }),
  defineColumn({
    id: "clan",
    labelKey: "leaderboard.clan",
    headerVisual: { kind: "icon", src: guildIcon },
    // Fits "WWWWW" — the widest 5-character tag — in the row font.
    width: "80px",
    align: "center",
    kinds: ["player"],
    cell: (row) => row.clanTag ?? "",
  }),
  defineColumn({
    id: "player",
    labelKey: "leaderboard.player",
    headerVisual: { kind: "icon", src: profileIcon },
    width: "100px",
    align: "start",
    kinds: ["player"],
    isHideable: false,
    cell: (row) => row.name,
  }),
  defineColumn({
    id: "playerType",
    labelKey: "leaderboard.playerType",
    headerVisual: { kind: "text", text: "leaderboard.type" },
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
    headerVisual: { kind: "icon", src: teamIcon },
    width: "100px",
    align: "start",
    kinds: ["team"],
    isHideable: false,
    cell: (row) => row.name,
  }),
  defineColumn({
    id: "tiles",
    labelKey: "leaderboard.owned",
    headerVisual: { kind: "icon", src: claimIcon, white: true },
    value: (player) => player.numTilesOwned(),
    cell: (row, game) => {
      const validTiles = game.numLandTiles() - game.numTilesWithFallout();
      return formatPercentage(validTiles > 0 ? row.value / validTiles : 0);
    },
  }),
  defineColumn({
    id: "gold",
    labelKey: "leaderboard.gold",
    headerVisual: { kind: "icon", src: goldCoinIcon },
    // Gold is a bigint, but game values remain safely below Number.MAX_SAFE_INTEGER.
    value: (player) => Number(player.gold()),
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "goldIncomePerMin",
    labelKey: "leaderboard.goldIncomePerMin",
    headerVisual: {
      kind: "icon",
      src: goldCoinIcon,
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
      src: portIcon,
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
      src: warshipIcon,
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
      src: factoryIcon,
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
      superscript: { src: upperLimitIcon, white: true },
    },
    value: (player, game) => game.config().maxTroops(player),
    cell: (row) => renderTroops(row.value),
  }),
  unitColumn("cities", "leaderboard.cities", UnitType.City, cityIcon),
  unitColumn("ports", "leaderboard.ports", UnitType.Port, portIcon),
  unitColumn(
    "factories",
    "leaderboard.factories",
    UnitType.Factory,
    factoryIcon,
  ),
  unitColumn(
    "silos",
    "leaderboard.launchers",
    UnitType.MissileSilo,
    missileSiloIcon,
  ),
  unitColumn("sams", "leaderboard.sams", UnitType.SAMLauncher, samLauncherIcon),
  unitColumn("warships", "leaderboard.warships", UnitType.Warship, warshipIcon),
  defineColumn({
    id: "allies",
    labelKey: "leaderboard.allies",
    headerVisual: { kind: "icon", src: allianceIcon },
    align: "center",
    value: (player) => player.allies().length,
    cell: (row) => renderNumber(row.value),
  }),
  defineColumn({
    id: "betrayals",
    labelKey: "leaderboard.betrayals",
    headerVisual: { kind: "icon", src: traitorIcon },
    align: "center",
    value: (player) => player.betrayals(),
    cell: (row) => renderNumber(row.value),
  }),
];

export function columnsFor(kind: StatsTableKind): readonly ColumnDef[] {
  return COLUMN_DEFS.filter((column) => column.kinds.includes(kind));
}

/**
 * Feed the gold-rate tracker with a player's current cumulative values.
 * Must be called at least once per player per refresh by every table kind
 * (player rows and team aggregation) — the rate columns read back from it.
 */
export function recordGoldRates(player: PlayerView, game: GameView): void {
  // Extra calls per tick (e.g. player + team tables) just append
  // near-identical samples; rates compare first vs last sample, so
  // duplicates don't skew the result.
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

export function columnValues(
  player: PlayerView,
  game: GameView,
  columns: readonly ColumnDef[],
): ReadonlyMap<ColumnId, number> {
  recordGoldRates(player, game);

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
