import {
  AllianceRequest,
  Difficulty,
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { flattenedEmojiTable } from "../../Util";
import { AllianceExtensionExecution } from "../alliance/AllianceExtensionExecution";
import { AttackExecution } from "../AttackExecution";
import { EmojiExecution } from "../EmojiExecution";

const emojiId = (e: (typeof flattenedEmojiTable)[number]) =>
  flattenedEmojiTable.indexOf(e);
const EMOJI_ASSIST_ACCEPT = (["👍", "⛵", "🤝", "🎯"] as const).map(emojiId);
const EMOJI_RELATION_TOO_LOW = (["🥱", "🤦‍♂️"] as const).map(emojiId);
const EMOJI_TARGET_ME = (["🥺", "💀"] as const).map(emojiId);
const EMOJI_TARGET_ALLY = (["🕊️", "👎"] as const).map(emojiId);
export const EMOJI_HECKLE = (["🤡", "😡"] as const).map(emojiId);

export class BotBehavior {
  private enemy: Player | null = null;
  private enemyUpdated: Tick | undefined;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
    private expandRatio: number,
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

  handleAllianceExtensionRequests() {
    for (const alliance of this.player.alliances()) {
      // Alliance expiration tracked by Events Panel, only human ally can click Request to Renew
      // Skip if no expiration yet/ ally didn't request extension yet/ bot already agreed to extend
      if (!alliance.onlyOneAgreedToExtend()) continue;

      // Nation is either Friendly or Neutral as an ally. Bot has no attitude
      // If Friendly or Bot, always agree to extend. If Neutral, have random chance decide
      const human = alliance.other(this.player);
      if (
        this.player.type() === PlayerType.FakeHuman &&
        this.player.relation(human) === Relation.Neutral
      ) {
        if (!this.random.chance(1.5)) continue;
      }

      this.game.addExecution(
        new AllianceExtensionExecution(this.player, human.id()),
      );
    }
  }

  private emoji(player: Player, emoji: number) {
    if (player.type() !== PlayerType.Human) return;
    this.game.addExecution(new EmojiExecution(this.player, player.id(), emoji));
  }

  private setNewEnemy(newEnemy: Player | null, force = false) {
    if (newEnemy !== null && !force && !this.shouldAttack(newEnemy)) return;
    this.enemy = newEnemy;
    this.enemyUpdated = this.game.ticks();
  }

  private shouldAttack(other: Player): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (this.player.isOnSameTeam(other)) {
      return false;
    }
    const shouldAttack = this.attackChance(other);
    if (shouldAttack && this.player.isAlliedWith(other)) {
      this.betray(other);
      return true;
    }
    return shouldAttack;
  }

  private betray(target: Player): void {
    if (this.player === null) throw new Error("not initialized");
    const alliance = this.player.allianceWith(target);
    if (!alliance) return;
    this.player.breakAlliance(alliance);
  }

  private attackChance(other: Player): boolean {
    if (this.player === null) throw new Error("not initialized");

    if (this.player.isAlliedWith(other)) {
      return this.shouldDiscourageAttack(other)
        ? this.random.chance(200)
        : this.random.chance(50);
    } else {
      return this.shouldDiscourageAttack(other) ? this.random.chance(4) : true;
    }
  }

  private shouldDiscourageAttack(other: Player) {
    if (other.isTraitor()) {
      return false;
    }
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty === Difficulty.Hard ||
      difficulty === Difficulty.Impossible
    ) {
      return false;
    }
    if (other.type() !== PlayerType.Human) {
      return false;
    }
    // Only discourage attacks on Humans who are not traitors on easy or medium difficulty.
    return true;
  }

  private clearEnemy() {
    this.enemy = null;
  }

  forgetOldEnemies() {
    // Forget old enemies
    if (this.game.ticks() - (this.enemyUpdated ?? 0) > 100) {
      this.clearEnemy();
    }
  }

  private hasReserveRatioTroops(): boolean {
    const maxTroops = this.game.config().maxTroops(this.player);
    const ratio = this.player.troops() / maxTroops;
    return ratio >= this.reserveRatio;
  }

  private hasTriggerRatioTroops(): boolean {
    const maxTroops = this.game.config().maxTroops(this.player);
    const ratio = this.player.troops() / maxTroops;
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
      this.setNewEnemy(largestAttacker, true);
    }
  }

  getNeighborTraitorToAttack(): Player | null {
    const traitors = this.player
      .neighbors()
      .filter((n): n is Player => n.isPlayer() && n.isTraitor());
    return traitors.length > 0 ? this.random.randElement(traitors) : null;
  }

  assistAllies() {
    for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) {
        this.emoji(ally, this.random.randElement(EMOJI_RELATION_TOO_LOW));
        continue;
      }
      for (const target of ally.targets()) {
        if (target === this.player) {
          this.emoji(ally, this.random.randElement(EMOJI_TARGET_ME));
          continue;
        }
        if (this.player.isAlliedWith(target)) {
          this.emoji(ally, this.random.randElement(EMOJI_TARGET_ALLY));
          continue;
        }
        // All checks passed, assist them
        this.player.updateRelation(ally, -20);
        this.setNewEnemy(target);
        this.emoji(ally, this.random.randElement(EMOJI_ASSIST_ACCEPT));
        return;
      }
    }
  }

  selectEnemy(enemies: Player[]): Player | null {
    if (this.enemy === null) {
      // Save up troops until we reach the reserve ratio
      if (!this.hasReserveRatioTroops()) return null;

      // Maybe save up troops until we reach the trigger ratio
      if (!this.hasTriggerRatioTroops() && !this.random.chance(10)) return null;

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
        // Only after clearing bots
        this.checkIncomingAttacks();
      }

      // Select the most hated player
      if (this.enemy === null && this.random.chance(2)) {
        // 50% chance
        const mostHated = this.player.allRelationsSorted()[0];
        if (
          mostHated !== undefined &&
          mostHated.relation === Relation.Hostile
        ) {
          this.setNewEnemy(mostHated.player);
        }
      }

      // Select the weakest player
      if (this.enemy === null && enemies.length > 0) {
        this.setNewEnemy(enemies[0]);
      }

      // Select a random player
      if (this.enemy === null && enemies.length > 0) {
        this.setNewEnemy(this.random.randElement(enemies));
      }
    }

    // Sanity check, don't attack our allies or teammates
    return this.enemySanityCheck();
  }

  selectRandomEnemy(): Player | TerraNullius | null {
    if (this.enemy === null) {
      // Save up troops until we reach the trigger ratio
      if (!this.hasTriggerRatioTroops()) return null;

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

  forceSendAttack(target: Player | TerraNullius) {
    this.game.addExecution(
      new AttackExecution(
        this.player.troops() / 2,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
      ),
    );
  }

  sendAttack(target: Player | TerraNullius) {
    // Skip attacking friendly targets (allies or teammates) - decision to break alliances should be made by caller
    if (target.isPlayer() && this.player.isFriendly(target)) return;

    const maxTroops = this.game.config().maxTroops(this.player);
    const reserveRatio = target.isPlayer()
      ? this.reserveRatio
      : this.expandRatio;
    const targetTroops = maxTroops * reserveRatio;
    const troops = this.player.troops() - targetTroops;
    if (troops < 1) return;
    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
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
