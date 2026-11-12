import type { EventBus } from "@openfront/shared/EventBus";
import { customElement } from "lit/decorators.js";
import {
  type RowMark,
  type StatsRow,
  StatsTable,
} from "../../components/StatsTable";
import { GoToPlayerEvent } from "../../TransformHandler";
import type { GameView, PlayerView } from "../../view";
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
    // A retreating attack is over as far as the board is concerned.
    const attackers = new Set(
      (myPlayer?.incomingAttacks() ?? [])
        .filter((attack) => !attack.retreating)
        .map((attack) => attack.attackerID),
    );

    return game
      .playerViews()
      .filter((player) => player.isAlive())
      .map((player) => ({
        key: player.id(),
        name: player.name(),
        clanTag: player.clanTag(),
        color: player.territoryColor().toRgbString(),
        values: columnValues(player, game, columns),
        emphasized:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
        pinned: player === myPlayer,
        marks: this.marks(player, myPlayer, attackers),
        onClick: () => {
          if (this.eventBus !== null) {
            this.eventBus.emit(new GoToPlayerEvent(player));
          }
        },
      }));
  }

  /** What a player is to you, most urgent first, two at most. */
  private marks(
    player: PlayerView,
    me: PlayerView | null,
    attackers: ReadonlySet<number>,
  ): RowMark[] {
    if (player === me) return [];
    const marks: RowMark[] = [];
    if (attackers.has(player.smallID())) marks.push("attack");
    if (player.isTraitor()) marks.push("traitor");
    if (me !== null) {
      if (player.isAlliedWith(me)) marks.push("ally");
      else if (player.hasEmbargoAgainst(me)) marks.push("embargo");
    }
    if (player.isDisconnected()) marks.push("offline");
    return marks.slice(0, 2);
  }
}
