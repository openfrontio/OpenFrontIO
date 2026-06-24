import { EventBus } from "../../core/EventBus";
import { LiveStats, PlayerLiveStats } from "../../core/Schemas";
import { Controller } from "../Controller";
import { SendLiveStatsEvent } from "../Transport";
import { GameView } from "../view";

// Clients each report a live stats snapshot to the server every ~10s (turns are
// 100ms), which the server reaches consensus on so the admin bot can observe a
// running game. Opt-in per game (GameConfig.liveStatsEnabled) since it adds
// per-client traffic; the admin bot sets it for tournaments. See
// GameServer.handleLiveStats.
const LIVE_STATS_INTERVAL_TURNS = 100;

export class LiveStatsController implements Controller {
  // Only report when the game opted in, and never for replays (which have no
  // server to report to).
  private readonly enabled: boolean;

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {
    this.enabled =
      game.config().gameConfig().liveStatsEnabled === true &&
      !game.config().isReplay();
  }

  // Report a live snapshot of the game so the server can reach consensus and
  // serve it to the admin bot. Only deterministic sim values are sent, with
  // players sorted by clientID, so in-sync clients produce an identical payload
  // that the server can vote on.
  tick(): void {
    if (!this.enabled) {
      return;
    }
    const turn = this.game.ticks();
    if (turn <= 0 || turn % LIVE_STATS_INTERVAL_TURNS !== 0) {
      return;
    }
    const players: PlayerLiveStats[] = this.game
      .players()
      .flatMap((p) => {
        const clientID = p.clientID();
        if (clientID === null) {
          return [];
        }
        return [
          {
            clientID,
            tilesOwned: p.numTilesOwned(),
            troops: p.troops(),
            gold: p.gold().toString(),
            isAlive: p.isAlive(),
            team: p.team(),
          },
        ];
      })
      .sort((a, b) => a.clientID.localeCompare(b.clientID));
    const stats: LiveStats = { turn, players };
    this.eventBus.emit(new SendLiveStatsEvent(stats));
  }
}
