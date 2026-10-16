import type { Team } from "@openfront/engine-api/game/GameTypes";
import { customElement } from "lit/decorators.js";
import { type StatsRow, StatsTable } from "../../components/StatsTable";
import type { ColumnId } from "../../StatsConstants";
import { getTranslatedPlayerTeamLabel } from "../../Utils";
import type { GameView, PlayerView } from "../../view";
import {
  type ColumnDef,
  type ValueGetter,
  recordGoldRates,
} from "./lib/StatsColumns";

export function aggregateTeamValues(
  players: readonly PlayerView[],
  columns: readonly ColumnDef[],
  game: GameView,
): ReadonlyMap<ColumnId, number> {
  // Only columns with a number behind them have anything to add up.
  const totalled = columns.filter(
    (column): column is ColumnDef & { value: ValueGetter } =>
      column.value !== undefined,
  );
  const values = new Map<ColumnId, number>(
    totalled.map((column) => [column.id, 0]),
  );

  for (const player of players) {
    if (!player.isAlive()) continue;
    // Keep the gold-rate tracker fed even when only the team table renders,
    // otherwise its rate columns read back 0.
    recordGoldRates(player, game);
    for (const column of totalled) {
      values.set(
        column.id,
        (values.get(column.id) ?? 0) + column.value(player, game),
      );
    }
  }

  return values;
}

@customElement("team-stats")
export class TeamStats extends StatsTable {
  protected readonly tableKind = "team";

  protected buildRows(
    game: GameView,
    columns: readonly ColumnDef[],
  ): StatsRow[] {
    const teams = new Map<Team, PlayerView[]>();
    const myTeam = game.myPlayer()?.team() ?? null;

    for (const player of game.playerViews()) {
      const team = player.team();
      if (team === null) continue;
      const players = teams.get(team) ?? [];
      players.push(player);
      teams.set(team, players);
    }

    return [...teams.entries()].map(([team, players]) => {
      return {
        key: team,
        name: getTranslatedPlayerTeamLabel(team),
        values: aggregateTeamValues(players, columns, game),
        emphasized: team === myTeam,
        pinned: team === myTeam,
      };
    });
  }
}
