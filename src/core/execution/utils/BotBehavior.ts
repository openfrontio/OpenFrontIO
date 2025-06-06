import {
  AllianceRequest,
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
} from "../../game/Game";
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

  private emoji(player: Player, emoji: number) {
    if (player.type() !== PlayerType.Human) return;
    this.game.addExecution(new EmojiExecution(this.player, player.id(), emoji));
  }

  forgetOldEnemies() {
    // Forget old enemies
    if (this.game.ticks() - this.enemyUpdated > 100) {
      this.enemy = null;
    }
  }

  private checkIncomingAttacks() {
    // Switch enemies if we're under attack
    const incomingAttacks = this.player.incomingAttacks();
    if (incomingAttacks.length > 0) {
      this.enemy = incomingAttacks
        .sort((a, b) => b.troops() - a.troops())[0]
        .attacker();
      this.enemyUpdated = this.game.ticks();
    }
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
        this.enemy = target;
        this.enemyUpdated = this.game.ticks();
        this.emoji(ally, this.assistAcceptEmoji);
        break outer;
      }
    }
  }

  selectEnemy(): Player | null {
    if (this.enemy === null) {
      // Save up troops until we reach the trigger ratio
      const maxPop = this.game.config().maxPopulation(this.player);
      const ratio = this.player.population() / maxPop;
      if (ratio < this.triggerRatio) return null;
    }

    // Prefer neighboring bots
    if (this.enemy === null) {
      const bots = this.player
        .neighbors()
        .filter((n) => n.isPlayer() && n.type() === PlayerType.Bot) as Player[];
      if (bots.length > 0) {
        const density = (p: Player) => p.troops() / p.numTilesOwned();
        this.enemy = bots.sort((a, b) => density(a) - density(b))[0];
        this.enemyUpdated = this.game.ticks();
      }
    }

    // Retaliate against incoming attacks
    if (this.enemy === null) {
      this.checkIncomingAttacks();
    }

    // Select the most hated player
    if (this.enemy === null) {
      const mostHated = this.player.allRelationsSorted()[0];
      if (mostHated !== undefined && mostHated.relation === Relation.Hostile) {
        this.enemy = mostHated.player;
        this.enemyUpdated = this.game.ticks();
      }
    }

    // Sanity check, don't attack our allies or teammates
    if (this.enemy && this.player.isFriendly(this.enemy)) {
      this.enemy = null;
    }
    return this.enemy;
  }

  selectRandomEnemy(): Player | TerraNullius | null {
    if (this.enemy === null) {
      // Save up troops until we reach the trigger ratio
      const maxPop = this.game.config().maxPopulation(this.player);
      const ratio = this.player.population() / maxPop;
      if (ratio < this.triggerRatio) return null;

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
        this.enemy = neighbor;
        this.enemyUpdated = this.game.ticks();
      }
    }

    // Retaliate against incoming attacks
    if (this.enemy === null) {
      this.checkIncomingAttacks();
    }

    // Select a traitor as an enemy
    if (this.enemy === null) {
      const traitors = this.player
        .neighbors()
        .filter((n) => n.isPlayer() && n.isTraitor()) as Player[];
      if (traitors.length > 0) {
        const toAttack = this.random.randElement(traitors);
        const odds = this.player.isFriendly(toAttack) ? 6 : 3;
        if (this.random.chance(odds)) {
          this.enemy = toAttack;
          this.enemyUpdated = this.game.ticks();
        }
      }
    }

    // Sanity check, don't attack our allies or teammates
    if (this.enemy && this.player.isFriendly(this.enemy)) {
      this.enemy = null;
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
  const isTraitor = request.requestor().isTraitor();
  const hasMalice = player.relation(request.requestor()) < Relation.Neutral;
  const requestorIsMuchLarger =
    request.requestor().numTilesOwned() > player.numTilesOwned() * 3;
  const tooManyAlliances = request.requestor().alliances().length >= 3;
  return (
    !isTraitor && !hasMalice && (requestorIsMuchLarger || !tooManyAlliances)
  );
}
