import type { EventBus } from "@openfront/shared/EventBus";
import { customElement } from "lit/decorators.js";
import { type StatsRow, StatsTable } from "../../components/StatsTable";
import { GoToPlayerEvent } from "../../TransformHandler";
import type { GameView } from "../../view";
import {
  type ColumnDef,
  columnValues,
  recordGoldRates,
} from "./lib/StatsColumns";

@customElement("player-stats")
export class PlayerStats extends StatsTable {
  public eventBus: EventBus | null = null;

  protected readonly tableKind = "player";

  refresh() {
    // Both tables read this history, and the player table is refreshed in
    // both hosts whether it is open or not.
    if (this.game !== null) recordGoldRates(this.game);
    super.refresh();
  }

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
        name: player.name(),
        clanTag: player.clanTag(),
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
