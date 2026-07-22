import { UnitType } from "../../../../core/game/Game";
import type { ColumnId } from "../../../StatsConstants";
import { formatPercentage, renderNumber, renderTroops } from "../../../Utils";
import type { GameView, PlayerView } from "../../../view";
import {
  allianceIcon,
  cityIcon,
  factoryIcon,
  goldCoinIcon,
  missileSiloIcon,
  portIcon,
  samLauncherIcon,
  soldierIcon,
  traitorIcon,
  upperLimitIcon,
  warshipIcon,
} from "../../HotbarIcons";

export {
  COLUMN_IDS,
  DEFAULT_STATS_COLUMNS,
  type ColumnId,
} from "../../../StatsConstants";

type ValueGetter = (player: PlayerView, game: GameView) => number;
type ValueRenderer = (value: number, game: GameView) => string;
export type ColumnHeaderVisual =
  | {
      readonly kind: "icon";
      readonly src: string;
      readonly white?: true;
      /** Small icon rendered as a superscript exponent on the main icon. */
      readonly superscript?: { readonly src: string; readonly white?: true };
    }
  | { readonly kind: "emoji"; readonly text: string };
export type ColumnValueAlignment = "center" | "end";

interface ColumnOptions {
  readonly headerVisual?: ColumnHeaderVisual;
  readonly valueAlignment?: ColumnValueAlignment;
}

const troopHeaderVisual = {
  kind: "icon",
  src: soldierIcon,
  white: true,
} as const satisfies ColumnHeaderVisual;

export interface ColumnDef {
  readonly id: ColumnId;
  readonly labelKey: string;
  readonly headerVisual?: ColumnHeaderVisual;
  readonly valueAlignment: ColumnValueAlignment;
  /** Raw numeric value used for sorting and team totals. */
  readonly value: ValueGetter;
  /** Formats either a player's value or an aggregated team total. */
  readonly renderValue: ValueRenderer;
}

// renderNumber's second parameter is fixedPoints, so it cannot be a
// ValueRenderer directly (which passes GameView second).
const renderNum: ValueRenderer = (value) => renderNumber(value);

function column(
  id: ColumnId,
  labelKey: string,
  value: ValueGetter,
  renderValue: ValueRenderer,
  options: ColumnOptions = {},
): ColumnDef {
  return {
    id,
    labelKey,
    ...options,
    valueAlignment: options.valueAlignment ?? "end",
    value,
    renderValue,
  };
}

function unitColumn(
  id: ColumnId,
  labelKey: string,
  unitType: UnitType,
  icon: string,
): ColumnDef {
  return column(
    id,
    labelKey,
    (player) => player.totalUnitLevels(unitType),
    renderNum,
    { headerVisual: { kind: "icon", src: icon }, valueAlignment: "center" },
  );
}

// This registry is the source of truth for column IDs and display order.
export const COLUMN_DEFS = [
  {
    id: "tiles",
    labelKey: "leaderboard.owned",
    valueAlignment: "end",
    value: (player) => player.numTilesOwned(),
    renderValue: (tiles, game) => {
      const validTiles = game.numLandTiles() - game.numTilesWithFallout();
      return formatPercentage(validTiles > 0 ? tiles / validTiles : 0);
    },
  },
  column(
    "gold",
    "leaderboard.gold",
    // Gold is a bigint, but game values remain safely below Number.MAX_SAFE_INTEGER.
    (player) => Number(player.gold()),
    renderNum,
    { headerVisual: { kind: "icon", src: goldCoinIcon } },
  ),
  column(
    "troops",
    "leaderboard.troops",
    (player) => player.troops(),
    renderTroops,
    { headerVisual: troopHeaderVisual },
  ),
  column(
    "maxtroops",
    "leaderboard.maxtroops",
    (player, game) => game.config().maxTroops(player),
    renderTroops,
    {
      headerVisual: {
        ...troopHeaderVisual,
        superscript: { src: upperLimitIcon, white: true },
      },
    },
  ),
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
  column(
    "allies",
    "leaderboard.allies",
    (player) => player.allies().length,
    renderNum,
    {
      headerVisual: { kind: "icon", src: allianceIcon },
      valueAlignment: "center",
    },
  ),
  column(
    "betrayals",
    "leaderboard.betrayals",
    (player) => player.betrayals(),
    renderNum,
    {
      headerVisual: { kind: "icon", src: traitorIcon },
      valueAlignment: "center",
    },
  ),
] as const satisfies readonly ColumnDef[];

export function columnValues(
  player: PlayerView,
  game: GameView,
  columns: readonly ColumnDef[],
): ReadonlyMap<ColumnId, number> {
  return new Map(
    columns.map((column) => [column.id, column.value(player, game)] as const),
  );
}

const COLUMNS_BY_ID = new Map<ColumnId, ColumnDef>(
  COLUMN_DEFS.map((column) => [column.id, column] as const),
);

export function columnById(id: ColumnId): ColumnDef {
  return COLUMNS_BY_ID.get(id)!;
}
