import { AllianceImpl } from "../../game/AllianceImpl";
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
    const promptOffset = 300; // 30 seconds before expiration (assuming 10 ticks per second)

    for (const player of this.mg.players()) {
      player.expiredAlliances().length = 0;
    }

    console.warn(
      `[ALLIANCE DEBUG] tick=${this.mg.ticks()}, totalAlliances=${this.mg.alliances().length}`,
    );

    for (const alliance of this.mg.alliances()) {
      const timeSinceCreation = this.mg.ticks() - alliance.createdAt();
      const ticksLeft = duration - timeSinceCreation;

      const key = `${alliance.requestor().id()}-${alliance.recipient().id()}-${alliance.createdAt()}`;

      if (ticksLeft === promptOffset && !this.promptedAlliances.has(key)) {
        this.promptedAlliances.add(key);

        const requestor = alliance.requestor();
        const recipient = alliance.recipient();

        console.warn(
          `[ALLIANCE PROMPT] Prompting ${requestor.id()} <-> ${recipient.id()} at tick ${this.mg.ticks()}`,
        );
        this.mg.sendAllianceExtensionPrompt(requestor, recipient, alliance);
        this.mg.sendAllianceExtensionPrompt(recipient, requestor, alliance);
      }

      if (timeSinceCreation > duration) {
        const requestor = alliance.requestor();
        const recipient = alliance.recipient();

        if (alliance.wantsExtension()) {
          const wantsFromRequestor = requestor
            .allianceWith(recipient)
            ?.wantsExtension();
          const wantsFromRecipient = recipient
            .allianceWith(requestor)
            ?.wantsExtension();

          if (wantsFromRequestor && wantsFromRecipient) {
            console.warn(
              `[ALLIANCE RENEW] Renewing alliance ${requestor.id()} <-> ${recipient.id()} at tick ${this.mg.ticks()}`,
            );
            const newAlliance = new AllianceImpl(
              this.mg,
              requestor,
              recipient,
              this.mg.ticks(),
              this.mg.getNextAllianceID(),
            );
            this.mg.alliances().push(newAlliance);
            return;
          }
        }

        console.warn(
          `[ALLIANCE EXPIRE] Expiring alliance ${requestor.id()} <-> ${recipient.id()} at tick ${this.mg.ticks()}`,
        );
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
