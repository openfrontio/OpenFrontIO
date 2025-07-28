import {
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  PlayerType,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { GameID } from "../../Schemas";
import { simpleHash } from "../../Util";

export class AllianceExtensionExecution implements Execution {
  private random: PseudoRandom;

  constructor(
    gameID: GameID,
    private readonly from: Player,
    private readonly toID: PlayerID,
  ) {
    this.random = new PseudoRandom(simpleHash(toID) + simpleHash(gameID));
  }

  init(mg: Game, ticks: number): void {
    if (!mg.hasPlayer(this.toID)) {
      console.warn(
        `[AllianceExtensionExecution] Player ${this.toID} not found`,
      );
      return;
    }
    const to = mg.player(this.toID);

    if (!this.from.isAlive() || !to.isAlive()) {
      console.info(
        `[AllianceExtensionExecution] Player ${this.from.id()} or ${this.toID} is not alive`,
      );
      return;
    }

    const alliance = this.from.allianceWith(to);
    if (!alliance) {
      console.warn(
        `[AllianceExtensionExecution] No alliance to extend between ${this.from.id()} and ${this.toID}`,
      );
      return;
    }

    if (to.type() !== PlayerType.Human) {
      if (!this.random.chance(1.3)) return;
    } else {
      // Mark this player's intent to extend
      alliance.addExtensionRequest(this.from);
      if (!alliance.canExtend()) return;
    }

    alliance.extend();

    mg.displayMessage(
      "events_display.alliance_renewed",
      MessageType.ALLIANCE_ACCEPTED,
      this.from.id(),
    );
    mg.displayMessage(
      "events_display.alliance_renewed",
      MessageType.ALLIANCE_ACCEPTED,
      this.toID,
    );
  }

  tick(ticks: number): void {
    // No-op
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
