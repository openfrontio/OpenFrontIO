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
  type ColumnId,
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
    // The gauge is drawn in a troop column, so only when one is shown.
    const gauge = columns.some(
      (column) => column.id === "troops" || column.id === "maxtroops",
    );

    return game
      .playerViews()
      .filter((player) => player.isAlive())
      .map((player) => {
        const values = columnValues(player, game, columns);
        return {
          key: player.id(),
          name: player.name(),
          clanTag: player.clanTag(),
          color: player.territoryColor().toRgbString(),
          values,
          emphasized:
            myPlayer !== null &&
            (player === myPlayer || player.isOnSameTeam(myPlayer)),
          pinned: player === myPlayer,
          marks: this.marks(player, myPlayer, attackers),
          troopFill: gauge ? this.troopFill(player, game, values) : undefined,
          onClick: () => {
            if (this.eventBus !== null) {
              this.eventBus.emit(new GoToPlayerEvent(player));
            }
          },
        };
      });
  }

  // How full the player's troops are. The troop columns already read one or
  // both numbers; only a missing one is read again.
  private troopFill(
    player: PlayerView,
    game: GameView,
    values: ReadonlyMap<ColumnId, number>,
  ): number {
    const troops = values.get("troops") ?? player.troops();
    const max = values.get("maxtroops") ?? game.config().maxTroops(player);
    return Math.min(1, troops / Math.max(max, 1));
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
