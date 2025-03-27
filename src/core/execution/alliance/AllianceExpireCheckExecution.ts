import { Execution, Game, Player } from "../../game/Game";

/**
 * Expiration check for alliances.
 */
export class AllianceExpireCheckExecution implements Execution {
  private active = true;
  private mg: Game = null;

  constructor() {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number) {
    for (const player of this.mg.players()) {
      player.expiredAlliances().length = 0; // clear expired alliances
    }

    for (const alliance of this.mg.alliances()) {
      if (
        this.mg.ticks() - alliance.createdAt() >
        this.mg.config().allianceDuration()
      ) {
        alliance.expire();

        alliance.requestor().expiredAlliances().push(alliance);
        alliance.recipient().expiredAlliances().push(alliance);
      }
    }
  }

  owner(): Player {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
