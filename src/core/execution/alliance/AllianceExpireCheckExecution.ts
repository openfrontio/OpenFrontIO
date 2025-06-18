import { Execution, Game, Player } from "../../game/Game";

/**
 * Expiration check for alliances.
 */
export class AllianceExpireCheckExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (!this.mg) return;

    const duration = this.mg.config().allianceDuration();

    for (const alliance of this.mg.alliances()) {
      const timeSinceCreation = this.mg.ticks() - alliance.createdAt();
      const key = `${alliance.requestor().id()}-${alliance.recipient().id()}-${alliance.createdAt()}`;

      if (timeSinceCreation >= duration) {
        const requestor = alliance.requestor();
        const recipient = alliance.recipient();

        if (alliance.wantsExtension()) {
          alliance.extendDuration(this.mg.ticks());
          continue;
        }
        alliance.expire();

        requestor.expiredAlliances().push(alliance);
        recipient.expiredAlliances().push(alliance);
      }
    }
  }

  owner(): Player | null {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
