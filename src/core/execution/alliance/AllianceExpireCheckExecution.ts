import { Execution, Game, Player } from "../../game/Game";

/**
 * Expiration check for alliances, including pre-expiry extension prompt.
 */
export class AllianceExpireCheckExecution implements Execution {
  private active = true;
  private mg: Game | null = null;
  private promptedAlliances: Set<string> = new Set(); // Track prompted alliances to avoid duplicates

  constructor() {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (!this.mg) return;

    const duration = this.mg.config().allianceDuration();
    const promptOffset = this.mg.config().allianceExtensionPromptOffset();

    for (const alliance of this.mg.alliances()) {
      const timeSinceCreation = this.mg.ticks() - alliance.createdAt();
      const ticksLeft = duration - timeSinceCreation;

      const key = `${alliance.requestor().id()}-${alliance.recipient().id()}-${alliance.createdAt()}`;

      if (ticksLeft === promptOffset && !this.promptedAlliances.has(key)) {
        this.promptedAlliances.add(key);

        const requestor = alliance.requestor();
        const recipient = alliance.recipient();

        this.mg.sendAllianceExtensionPrompt(requestor, recipient, alliance);
        this.mg.sendAllianceExtensionPrompt(recipient, requestor, alliance);
      }

      if (timeSinceCreation > duration) {
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
