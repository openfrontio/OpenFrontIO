import {
  AllianceRequest,
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
} from "../../game/Game";
import { GameImpl } from "../../game/GameImpl";
import { PseudoRandom } from "../../PseudoRandom";
import { flattenedEmojiTable } from "../../Util";
import { AttackExecution } from "../AttackExecution";
import { EmojiExecution } from "../EmojiExecution";

export class BotBehavior {
  private enemy: Player | null = null;
  private enemyUpdated: Tick;

  private assistAcceptEmoji = flattenedEmojiTable.indexOf("👍");

  private firstAttackSent = false;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
  ) {}

  handleAllianceRequests() {
    for (const req of this.player.incomingAllianceRequests()) {
      if (shouldAcceptAllianceRequest(this.player, req)) {
        req.accept();
      } else {
        req.reject();
      }
    }
  }

  handleAllianceWinVotes() {
    const gameImpl = this.game as GameImpl;
    if (gameImpl.currentVote !== null) {
      const vote = gameImpl.currentVote;
      // Change this later to be dynamic, maybe a bot is feeling cocky enough to break alliance
      // after this and go for it.
      const current = vote?.results.get(this.player.id());
      if (current !== true) {
        gameImpl.castVote(this.player, true);
      }
    }
  }

  private emoji(player: Player, emoji: number) {
    if (player.type() !== PlayerType.Human) return;
    this.game.addExecution(new EmojiExecution(this.player, player.id(), emoji));
  }

  private setNewEnemy(newEnemy: Player | null) {
    this.enemy = newEnemy;
    this.enemyUpdated = this.game.ticks();
  }

  private clearEnemy() {
    this.enemy = null;
  }

  forgetOldEnemies() {
    // Forget old enemies
    if (this.game.ticks() - this.enemyUpdated > 100) {
      this.clearEnemy();
    }
  }

  private hasSufficientTroops(): boolean {
    const maxPop = this.game.config().maxPopulation(this.player);
    const ratio = this.player.population() / maxPop;
    return ratio >= this.triggerRatio;
  }

  private checkIncomingAttacks() {
    // Switch enemies if we're under attack
    const incomingAttacks = this.player.incomingAttacks();
    let largestAttack = 0;
    let largestAttacker: Player | undefined;
    for (const attack of incomingAttacks) {
      if (attack.troops() <= largestAttack) continue;
      largestAttack = attack.troops();
      largestAttacker = attack.attacker();
    }
    if (largestAttacker !== undefined) {
      this.setNewEnemy(largestAttacker);
    }
  }

  getNeighborTraitorToAttack(): Player | null {
    const traitors = this.player
      .neighbors()
      .filter((n): n is Player => n.isPlayer() && n.isTraitor());
    return traitors.length > 0 ? this.random.randElement(traitors) : null;
  }

  assistAllies() {
    outer: for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) {
        // this.emoji(ally, "🤦");
        continue;
      }
      for (const target of ally.targets()) {
        if (target === this.player) {
          // this.emoji(ally, "💀");
          continue;
        }
        if (this.player.isAlliedWith(target)) {
          // this.emoji(ally, "👎");
          continue;
        }
        // All checks passed, assist them
        this.player.updateRelation(ally, -20);
        this.setNewEnemy(target);
        this.emoji(ally, this.assistAcceptEmoji);
        break outer;
      }
    }
  }

  selectEnemy(): Player | null {
    if (this.enemy === null) {
      // Save up troops until we reach the trigger ratio
      if (!this.hasSufficientTroops()) return null;

      // Prefer neighboring bots
      const bots = this.player
        .neighbors()
        .filter(
          (n): n is Player => n.isPlayer() && n.type() === PlayerType.Bot,
        );
      if (bots.length > 0) {
        const density = (p: Player) => p.troops() / p.numTilesOwned();
        let lowestDensityBot: Player | undefined;
        let lowestDensity = Infinity;

        for (const bot of bots) {
          const currentDensity = density(bot);
          if (currentDensity < lowestDensity) {
            lowestDensity = currentDensity;
            lowestDensityBot = bot;
          }
        }

        if (lowestDensityBot !== undefined) {
          this.setNewEnemy(lowestDensityBot);
        }
      }

      // Retaliate against incoming attacks
      if (this.enemy === null) {
        this.checkIncomingAttacks();
      }

      // Select the most hated player
      if (this.enemy === null) {
        const mostHated = this.player.allRelationsSorted()[0];
        if (
          mostHated !== undefined &&
          mostHated.relation === Relation.Hostile
        ) {
          this.setNewEnemy(mostHated.player);
        }
      }
    }

    // Sanity check, don't attack our allies or teammates
    return this.enemySanityCheck();
  }

  selectRandomEnemy(): Player | TerraNullius | null {
    if (this.enemy === null) {
      // Save up troops until we reach the trigger ratio
      if (!this.hasSufficientTroops()) return null;

      // Choose a new enemy randomly
      const neighbors = this.player.neighbors();
      for (const neighbor of this.random.shuffleArray(neighbors)) {
        if (!neighbor.isPlayer()) continue;
        if (this.player.isFriendly(neighbor)) continue;
        if (neighbor.type() === PlayerType.FakeHuman) {
          if (this.random.chance(2)) {
            continue;
          }
        }
        this.setNewEnemy(neighbor);
      }

      // Retaliate against incoming attacks
      if (this.enemy === null) {
        this.checkIncomingAttacks();
      }

      // Select a traitor as an enemy
      if (this.enemy === null) {
        const toAttack = this.getNeighborTraitorToAttack();
        if (toAttack !== null) {
          if (!this.player.isFriendly(toAttack) && this.random.chance(3)) {
            this.setNewEnemy(toAttack);
          }
        }
      }
    }

    // Sanity check, don't attack our allies or teammates
    return this.enemySanityCheck();
  }

  private enemySanityCheck(): Player | null {
    if (this.enemy && this.player.isFriendly(this.enemy)) {
      this.clearEnemy();
    }
    return this.enemy;
  }

  sendAttack(target: Player | TerraNullius) {
    if (target.isPlayer() && this.player.isOnSameTeam(target)) return;
    const maxPop = this.game.config().maxPopulation(this.player);
    const maxTroops = maxPop * this.player.targetTroopRatio();
    const targetTroops = maxTroops * this.reserveRatio;
    // Don't wait until it has sufficient reserves to send the first attack
    // to prevent the bot from waiting too long at the start of the game.
    const troops = this.firstAttackSent
      ? this.player.troops() - targetTroops
      : this.player.troops() / 5;
    if (troops < 1) return;
    this.firstAttackSent = true;
    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.isPlayer() ? target.id() : null,
      ),
    );
  }
}

function shouldAcceptAllianceRequest(player: Player, request: AllianceRequest) {
  if (player.relation(request.requestor()) < Relation.Neutral) {
    return false; // Reject if hasMalice
  }
  if (request.requestor().isTraitor()) {
    return false; // Reject if isTraitor
  }
  if (request.requestor().numTilesOwned() > player.numTilesOwned() * 3) {
    return true; // Accept if requestorIsMuchLarger
  }
  if (request.requestor().alliances().length >= 3) {
    return false; // Reject if tooManyAlliances
  }
  return true; // Accept otherwise
}
