import {
  Difficulty,
  Game,
  Player,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import {
  boundingBoxCenter,
  calculateBoundingBoxCenter,
  flattenedEmojiTable,
} from "../../Util";
import { AttackExecution } from "../AttackExecution";
import { EmojiExecution } from "../EmojiExecution";
import { TransportShipExecution } from "../TransportShipExecution";
import { closestTwoTiles } from "../Util";

const emojiId = (e: (typeof flattenedEmojiTable)[number]) =>
  flattenedEmojiTable.indexOf(e);
const EMOJI_ASSIST_ACCEPT = (["👍", "⛵", "🤝", "🎯"] as const).map(emojiId);
const EMOJI_RELATION_TOO_LOW = (["🥱", "🤦‍♂️"] as const).map(emojiId);
const EMOJI_TARGET_ME = (["🥺", "💀"] as const).map(emojiId);
const EMOJI_TARGET_ALLY = (["🕊️", "👎"] as const).map(emojiId);
const EMOJI_HECKLE = (["🤡", "😡"] as const).map(emojiId);

export class BotBehavior {
  private botAttackTroopsSent: number = 0;
  private readonly lastEmojiSent = new Map<Player, Tick>();

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
    private expandRatio: number,
  ) {}

  private emoji(player: Player, emoji: number) {
    if (player.type() !== PlayerType.Human) return;
    this.game.addExecution(new EmojiExecution(this.player, player.id(), emoji));
  }

  // Prevent attacking of humans on lower difficulties (or if we are a bot)
  private shouldAttack(other: Player | TerraNullius): boolean {
    // Always attack Terra Nullius, non-humans and traitors
    if (
      other.isPlayer() === false ||
      other.type() !== PlayerType.Human ||
      other.isTraitor() ||
      this.player.type() === PlayerType.Bot
    ) {
      return true;
    }

    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy && this.random.chance(4)) {
      return false;
    }
    if (difficulty === Difficulty.Medium && this.random.chance(2)) {
      return false;
    }
    return true;
  }

  private betray(target: Player): void {
    const alliance = this.player.allianceWith(target);
    if (!alliance) return;
    this.player.breakAlliance(alliance);
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

  private findIncomingAttackPlayer(): Player | null {
    // Ignore bot attacks if we are not a bot.
    let incomingAttacks = this.player.incomingAttacks();
    if (this.player.type() !== PlayerType.Bot) {
      incomingAttacks = incomingAttacks.filter(
        (attack) => attack.attacker().type() !== PlayerType.Bot,
      );
    }
    let largestAttack = 0;
    let largestAttacker: Player | undefined;
    for (const attack of incomingAttacks) {
      if (attack.troops() <= largestAttack) continue;
      largestAttack = attack.troops();
      largestAttacker = attack.attacker();
    }
    if (largestAttacker !== undefined) {
      return largestAttacker;
    }
    return null;
  }

  getNeighborTraitorToAttack(): Player | null {
    const traitors = this.player
      .neighbors()
      .filter(
        (n): n is Player =>
          n.isPlayer() && this.player.isFriendly(n) === false && n.isTraitor(),
      );
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
        if (this.player.isFriendly(target)) {
          this.emoji(ally, this.random.randElement(EMOJI_TARGET_ALLY));
          continue;
        }
        // All checks passed, assist them
        this.player.updateRelation(ally, -20);
        this.sendAttack(target);
        this.emoji(ally, this.random.randElement(EMOJI_ASSIST_ACCEPT));
        return;
      }
    }
  }

  attackBestTarget(borderingFriends: Player[], borderingEnemies: Player[]) {
    // Save up troops until we reach the reserve ratio
    if (!this.hasReserveRatioTroops()) return;

    // Maybe save up troops until we reach the trigger ratio
    if (!this.hasTriggerRatioTroops() && !this.random.chance(10)) return;

    // Retaliate against incoming attacks (Most important!)
    const incomingAttackPlayer = this.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      this.sendAttack(incomingAttackPlayer, true);
      return;
    }

    // Attack bots
    if (this.attackBots()) return;

    // Maybe betray and attack
    if (this.maybeBetrayAndAttack(borderingFriends)) return;

    // Attack nuked territory
    if (this.isBorderingNukedTerritory()) {
      this.sendAttack(this.game.terraNullius());
      return;
    }

    // Attack the most hated player with hostile relation
    const mostHated = this.player.allRelationsSorted()[0];
    if (
      mostHated !== undefined &&
      mostHated.relation === Relation.Hostile &&
      this.player.isFriendly(mostHated.player) === false
    ) {
      this.sendAttack(mostHated.player);
      return;
    }

    // Attack the weakest player
    if (borderingEnemies.length > 0) {
      this.sendAttack(borderingEnemies[0]);
      return;
    }

    // If we don't have bordering enemies, attack someone on an island next to us
    if (borderingEnemies.length === 0) {
      const nearestIslandEnemy = this.findNearestIslandEnemy();
      if (nearestIslandEnemy) {
        this.sendAttack(nearestIslandEnemy);
        return;
      }
    }
  }

  // Sort neighboring bots by density (troops / tiles) and attempt to attack many of them (Parallel attacks)
  // sendAttack will do nothing if we don't have enough reserve troops left
  attackBots(): boolean {
    const bots = this.player
      .neighbors()
      .filter(
        (n): n is Player =>
          n.isPlayer() &&
          this.player.isFriendly(n) === false &&
          n.type() === PlayerType.Bot,
      );

    if (bots.length === 0) {
      return false;
    }

    this.botAttackTroopsSent = 0;

    const density = (p: Player) => p.troops() / p.numTilesOwned();
    const sortedBots = bots.slice().sort((a, b) => density(a) - density(b));
    const reducedBots = sortedBots.slice(0, this.getBotAttackMaxParallelism());

    for (const bot of reducedBots) {
      this.sendAttack(bot);
    }

    // Only short-circuit the rest of the targeting pipeline if we actually
    // allocated some troops to bot attacks.
    return this.botAttackTroopsSent > 0;
  }

  getBotAttackMaxParallelism(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 1;
      case Difficulty.Medium:
        return 2;
      case Difficulty.Hard:
        return 4;
      // On impossible difficulty, attack as much bots as possible in parallel
      default:
        return 100;
    }
  }

  // Betray friends if we have 10 times more troops than them
  // TODO: Implement better and deeper strategies, for example:
  // Check impact on relations with other players
  // Check value of targets territory
  // Check if target is distracted
  // Check the targets territory size
  maybeBetrayAndAttack(borderingFriends: Player[]): boolean {
    if (borderingFriends.length > 0) {
      for (const friend of borderingFriends) {
        if (
          this.player.isAlliedWith(friend) &&
          this.player.troops() >= friend.troops() * 10
        ) {
          this.betray(friend);
          this.sendAttack(friend, true);
          return true;
        }
      }
    }
    return false;
  }

  // TODO: Nuke the crown if it's far enough ahead of everybody else (based on difficulty)
  findBestNukeTarget(borderingEnemies: Player[]): Player | null {
    // Retaliate against incoming attacks (Most important!)
    const incomingAttackPlayer = this.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      return incomingAttackPlayer;
    }

    // Find the most hated player with hostile relation
    const mostHated = this.player.allRelationsSorted()[0];
    if (
      mostHated !== undefined &&
      mostHated.relation === Relation.Hostile &&
      this.player.isFriendly(mostHated.player) === false
    ) {
      return mostHated.player;
    }

    // Find the weakest player
    if (borderingEnemies.length > 0) {
      return borderingEnemies[0];
    }

    // If we don't have bordering enemies, find someone on an island next to us
    if (borderingEnemies.length === 0) {
      const nearestIslandEnemy = this.findNearestIslandEnemy();
      if (nearestIslandEnemy) {
        return nearestIslandEnemy;
      }
    }

    return null;
  }

  getPlayerCenter(player: Player) {
    if (player.largestClusterBoundingBox) {
      return boundingBoxCenter(player.largestClusterBoundingBox);
    }
    return calculateBoundingBoxCenter(this.game, player.borderTiles());
  }

  findNearestIslandEnemy(): Player | null {
    const myBorder = this.player.borderTiles();
    if (myBorder.size === 0) return null;

    const filteredPlayers = this.game.players().filter((p) => {
      if (p === this.player) return false;
      if (!p.isAlive()) return false;
      if (p.borderTiles().size === 0) return false;
      if (this.player.isFriendly(p)) return false;
      // Don't spam boats into players more than 2x our troops
      return p.troops() <= this.player.troops() * 2;
    });

    if (filteredPlayers.length > 0) {
      const playerCenter = this.getPlayerCenter(this.player);

      const sortedPlayers = filteredPlayers
        .map((filteredPlayer) => {
          const filteredPlayerCenter = this.getPlayerCenter(filteredPlayer);

          const playerCenterTile = this.game.ref(
            playerCenter.x,
            playerCenter.y,
          );
          const filteredPlayerCenterTile = this.game.ref(
            filteredPlayerCenter.x,
            filteredPlayerCenter.y,
          );

          const distance = this.game.manhattanDist(
            playerCenterTile,
            filteredPlayerCenterTile,
          );
          return { player: filteredPlayer, distance };
        })
        .sort((a, b) => a.distance - b.distance); // Sort by distance (ascending)

      // Select the nearest or second-nearest enemy (So our boat doesn't always run into the same warship, if there is one)
      let selectedEnemy: Player | null;
      if (sortedPlayers.length > 1 && this.random.chance(2)) {
        selectedEnemy = sortedPlayers[1].player;
      } else {
        selectedEnemy = sortedPlayers[0].player;
      }

      if (selectedEnemy !== null) {
        return selectedEnemy;
      }
    }
    return null;
  }

  attackRandomTarget() {
    // Save up troops until we reach the trigger ratio
    if (!this.hasTriggerRatioTroops()) return;

    // Retaliate against incoming attacks
    const incomingAttackPlayer = this.findIncomingAttackPlayer();
    if (incomingAttackPlayer) {
      this.sendAttack(incomingAttackPlayer, true);
      return;
    }

    // Select a traitor as an enemy
    const toAttack = this.getNeighborTraitorToAttack();
    if (toAttack !== null) {
      if (this.random.chance(3)) {
        this.sendAttack(toAttack);
        return;
      }
    }

    // Choose a new enemy randomly
    const neighbors = this.player.neighbors();
    for (const neighbor of this.random.shuffleArray(neighbors)) {
      if (!neighbor.isPlayer()) continue;
      if (this.player.isFriendly(neighbor)) continue;
      if (
        neighbor.type() === PlayerType.FakeHuman ||
        neighbor.type() === PlayerType.Human
      ) {
        if (this.random.chance(2)) {
          continue;
        }
      }
      this.sendAttack(neighbor);
      return;
    }
  }

  isBorderingNukedTerritory(): boolean {
    for (const tile of this.player.borderTiles()) {
      for (const neighbor of this.game.neighbors(tile)) {
        if (
          this.game.isLand(neighbor) &&
          !this.game.hasOwner(neighbor) &&
          this.game.hasFallout(neighbor)
        ) {
          return true;
        }
      }
    }
    return false;
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

  sendAttack(target: Player | TerraNullius, force = false) {
    if (!force && !this.shouldAttack(target)) return;

    if (this.player.sharesBorderWith(target)) {
      this.sendLandAttack(target);
    } else if (target.isPlayer()) {
      this.sendBoatAttack(target);
    }
  }

  sendLandAttack(target: Player | TerraNullius) {
    const maxTroops = this.game.config().maxTroops(this.player);
    const reserveRatio = target.isPlayer()
      ? this.reserveRatio
      : this.expandRatio;
    const targetTroops = maxTroops * reserveRatio;

    let troops;
    if (
      target.isPlayer() &&
      target.type() === PlayerType.Bot &&
      this.player.type() !== PlayerType.Bot
    ) {
      troops = this.calculateBotAttackTroops(
        target,
        this.player.troops() - targetTroops - this.botAttackTroopsSent,
      );
    } else {
      troops = this.player.troops() - targetTroops;
    }

    if (troops < 1) {
      return;
    }

    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
      ),
    );

    if (target.isPlayer()) {
      this.maybeSendEmoji(target);
    }
  }

  sendBoatAttack(other: Player) {
    const closest = closestTwoTiles(
      this.game,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isOceanShore(t),
      ),
      Array.from(other.borderTiles()).filter((t) => this.game.isOceanShore(t)),
    );
    if (closest === null) {
      return;
    }

    let troops;
    if (other.type() === PlayerType.Bot) {
      troops = this.calculateBotAttackTroops(other, this.player.troops() / 5);
    } else {
      troops = this.player.troops() / 5;
    }

    if (troops < 1) {
      return;
    }

    this.game.addExecution(
      new TransportShipExecution(
        this.player,
        other.id(),
        closest.y,
        troops,
        null,
      ),
    );

    this.maybeSendEmoji(other);
  }

  calculateBotAttackTroops(target: Player, maxTroops: number): number {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) {
      this.botAttackTroopsSent += maxTroops;
      return maxTroops;
    }
    let troops = target.troops() * 4;

    // Don't send more troops than maxTroops (Keep reserve)
    if (troops > maxTroops) {
      // If we haven't enough troops left to do a big enough bot attack, skip it
      if (maxTroops < target.troops() * 2) {
        troops = 0;
      } else {
        troops = maxTroops;
      }
    }
    this.botAttackTroopsSent += troops;
    return troops;
  }

  maybeSendEmoji(enemy: Player) {
    if (this.player.type() === PlayerType.Bot) return;
    if (enemy.type() !== PlayerType.Human) return;
    const lastSent = this.lastEmojiSent.get(enemy) ?? -300;
    if (this.game.ticks() - lastSent <= 300) return;
    this.lastEmojiSent.set(enemy, this.game.ticks());
    this.game.addExecution(
      new EmojiExecution(
        this.player,
        enemy.id(),
        this.random.randElement(EMOJI_HECKLE),
      ),
    );
  }
}
