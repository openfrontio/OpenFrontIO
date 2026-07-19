import { customElement } from "lit/decorators.js";
import type { EventBus } from "../../../core/EventBus";
import { GoToPlayerEvent } from "../../TransformHandler";
import type { GameView } from "../../view";
import { type ColumnDef, columnValues } from "./StatsColumns";
import { type StatsRow, StatsTable } from "./StatsTable";

@customElement("player-stats")
export class PlayerStats extends StatsTable {
  public eventBus: EventBus | null = null;

  protected readonly tableKind = "player";
  protected readonly nameLabelKey = "leaderboard.player";

  protected buildRows(
    game: GameView,
    columns: readonly ColumnDef[],
  ): StatsRow[] {
    const myPlayer = game.myPlayer();

    return game
      .playerViews()
      .filter((player) => player.isAlive())
      .map((player) => ({
        key: player.id(),
        name: player.displayName(),
        values: columnValues(player, game, columns),
        emphasized:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
        pinned: player === myPlayer,
        onClick: () => {
          if (this.eventBus !== null) {
            this.eventBus.emit(new GoToPlayerEvent(player));
          }
        },
      }));
  }
}
