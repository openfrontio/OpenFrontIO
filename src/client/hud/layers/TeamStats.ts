import { customElement } from "lit/decorators.js";
import type { Team } from "../../../core/game/Game";
import type { ColumnId } from "../../../core/game/StatsConstants";
import { translateText } from "../../Utils";
import type { GameView, PlayerView } from "../../view";
import type { ColumnDef } from "./StatsColumns";
import { type StatsRow, StatsTable } from "./StatsTable";

export function aggregateTeamValues(
  players: readonly PlayerView[],
  columns: readonly ColumnDef[],
  game: GameView,
): ReadonlyMap<ColumnId, number> {
  const values = new Map<ColumnId, number>(
    columns.map((column) => [column.id, 0]),
  );

  for (const player of players) {
    if (!player.isAlive()) continue;
    for (const column of columns) {
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
  protected readonly nameLabelKey = "leaderboard.team";

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
      const labelKey = `team_colors.${team.toLowerCase()}`;
      const translatedName = translateText(labelKey);

      return {
        key: team,
        name: translatedName === labelKey ? team : translatedName,
        values: aggregateTeamValues(players, columns, game),
        emphasized: team === myTeam,
        pinned: team === myTeam,
      };
    });
  }
}
