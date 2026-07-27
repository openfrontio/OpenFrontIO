import { UnitType } from "../../../../core/game/Game";
import type { ColumnId, StatsTableKind } from "../../../StatsConstants";
import { formatPercentage, renderNumber, renderTroops } from "../../../Utils";
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
      /** Small icon rendered as a superscript exponent on the main icon. */
      readonly superscript?: { readonly src: string; readonly white?: true };
    }
  // A literal symbol, not copy — "#" reads the same in every language.
  | { readonly kind: "text"; readonly text: string };
export type ColumnAlignment = "start" | "center" | "end";

/** One row as a column sees it. `value` is that column's own number. */
export interface ColumnRow {
  readonly position: number;
  readonly name: string;
  readonly clanTag?: string | null;
  readonly value: number;
}

type ValueGetter = (player: PlayerView, game: GameView) => number;

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
