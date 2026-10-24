import { PlayerType } from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Versioned } from "@openfront/engine-lib/snapshot/SnapshotType";
import { Player } from "../game/Game";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";

export class TribeAttackBehavior extends AiAttackBehavior {
  snapshot(w: SnapshotWriter): Versioned {
    return this.writeRecord(w, 0, []);
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
  ): void {
    this.restoreRecord(raw, r, random, player);
  }

  attackRandomTarget() {
    // Save up troops until we reach the trigger ratio
    if (!this.hasTriggerRatioTroops()) return;

    // Retaliate against incoming attacks
    const incomingAttackPlayer = this.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      if (this.sendAttack(incomingAttackPlayer, true)) return;
    }

    // Select a traitor as an enemy
    const toAttack = this.getNeighborTraitorToAttack();
    if (toAttack !== null) {
      if (this.random.chance(3)) {
        if (this.sendAttack(toAttack)) return;
      }
    }

    // Choose a new enemy randomly
    const neighbors = this.player.nearby();
    for (const neighbor of this.random.shuffleArray(neighbors)) {
      if (!neighbor.isPlayer()) continue;
      if (this.player.isFriendly(neighbor)) continue;
      if (
        neighbor.type() === PlayerType.Nation ||
        neighbor.type() === PlayerType.Human
      ) {
        if (this.random.chance(2)) {
          continue;
        }
      }
      if (this.sendAttack(neighbor)) return;
    }
  }

  // Allies only for a caller that breaks the alliance before attacking
  getNeighborTraitorToAttack(includeAllies = false): Player | null {
    if (this.game.config().disableAlliances()) return null;

    const traitors = this.player
      .nearby()
      .filter(
        (n): n is Player =>
          n.isPlayer() &&
          (includeAllies || !this.player.isFriendly(n)) &&
          n.isTraitor(),
      );
    return traitors.length > 0 ? this.random.randElement(traitors) : null;
  }
}
