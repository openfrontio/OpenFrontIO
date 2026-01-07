import { TileRef } from "src/core/game/GameMap";
import { canBuildTransportShip } from "src/core/game/TransportShipUtils";
import {
  Difficulty,
  Game,
  Player,
  PlayerID,
  PlayerType,
  Relation,
  TerraNullius,
} from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import {
  assertNever,
  boundingBoxCenter,
  calculateBoundingBoxCenter,
} from "../../Util";
import { AttackExecution } from "../AttackExecution";
import { NationAllianceBehavior } from "../nation/NationAllianceBehavior";
import {
  EMOJI_ASSIST_ACCEPT,
  EMOJI_ASSIST_RELATION_TOO_LOW,
  EMOJI_ASSIST_TARGET_ALLY,
  EMOJI_ASSIST_TARGET_ME,
  NationEmojiBehavior,
} from "../nation/NationEmojiBehavior";
import { TransportShipExecution } from "../TransportShipExecution";
import { closestTwoTiles } from "../Util";

export class AiAttackBehavior {
  private botAttackTroopsSent: number = 0;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
    private expandRatio: number,
    private allianceBehavior?: NationAllianceBehavior,
    private emojiBehavior?: NationEmojiBehavior,
  ) {}

  maybeAttack() {
    if (this.player === null || this.allianceBehavior === undefined) {
      throw new Error("not initialized");
    }

    const border = Array.from(this.player.borderTiles())
      .flatMap((t) => this.game.neighbors(t))
      .filter(
        (t) =>
          this.game.isLand(t) &&
          this.game.ownerID(t) !== this.player?.smallID(),
      );
    const borderingPlayers = [
      ...new Set(
        border
          .map((t) => this.game.playerBySmallID(this.game.ownerID(t)))
          .filter((o): o is Player => o.isPlayer()),
      ),
    ].sort((a, b) => a.troops() - b.troops());
    const borderingFriends = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === true,
    );
    const borderingEnemies = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === false,
    );

    // Attack TerraNullius but not nuked territory
    const hasNonNukedTerraNullius = border.some(
      (t) => !this.game.hasOwner(t) && !this.game.hasFallout(t),
    );
    if (hasNonNukedTerraNullius) {
      this.sendAttack(this.game.terraNullius());
      return;
    }

    if (borderingEnemies.length === 0) {
      if (this.random.chance(5)) {
        this.attackWithRandomBoat();
      }
    } else {
      if (this.random.chance(10)) {
        this.attackWithRandomBoat(borderingEnemies);
        return;
      }

      this.allianceBehavior.maybeSendAllianceRequests(borderingEnemies);
    }

    this.attackBestTarget(borderingFriends, borderingEnemies);
  }

  private attackWithRandomBoat(borderingEnemies: Player[] = []) {
    if (this.player === null) throw new Error("not initialized");
    const oceanShore = Array.from(this.player.borderTiles()).filter((t) =>
      this.game.isOceanShore(t),
    );
    if (oceanShore.length === 0) {
      return;
    }

    const src = this.random.randElement(oceanShore);

    // First look for high-interest targets (unowned or bot-owned). Mainly relevant for earlygame
    let dst = this.findRandomBoatTarget(src, borderingEnemies, true);
    if (dst === null) {
      // None found? Then look for players
      dst = this.findRandomBoatTarget(src, borderingEnemies, false);
      if (dst === null) {
        return;
      }
    }

    this.game.addExecution(
      new TransportShipExecution(
        this.player,
        this.game.owner(dst).id(),
        dst,
        this.player.troops() / 5,
        null,
      ),
    );
    return;
  }

  private findRandomBoatTarget(
    tile: TileRef,
    borderingEnemies: Player[],
    highInterestOnly: boolean = false,
  ): TileRef | null {
    if (this.player === null) throw new Error("not initialized");
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    const unreachablePlayers = new Set<PlayerID>();
    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - 150, x + 150);
      const randY = this.random.nextInt(y - 150, y + 150);
      if (!this.game.isValidCoord(randX, randY)) {
        continue;
      }
      const randTile = this.game.ref(randX, randY);
      if (!this.game.isLand(randTile)) {
        continue;
      }
      const owner = this.game.owner(randTile);
      if (owner === this.player) {
        continue;
      }
      // Skip players we already know are unreachable (Performance optimization)
      if (owner.isPlayer() && unreachablePlayers.has(owner.id())) {
        continue;
      }
      // Don't send boats to players with which we share a border, that usually looks stupid
      if (owner.isPlayer() && borderingEnemies.includes(owner)) {
        continue;
      }
      // Don't spam boats into players which are stronger than us
      if (owner.isPlayer() && owner.troops() > this.player.troops()) {
        continue;
      }

      let matchesCriteria = false;
      if (highInterestOnly) {
        // High-interest targeting: prioritize unowned tiles or tiles owned by bots
        matchesCriteria = !owner.isPlayer() || owner.type() === PlayerType.Bot;
      } else {
        // Normal targeting: return unowned tiles or tiles owned by non-friendly players
        matchesCriteria = !owner.isPlayer() || !owner.isFriendly(this.player);
      }
      if (!matchesCriteria) {
        continue;
      }

      // Validate that we can actually build a transport ship to this target
      if (canBuildTransportShip(this.game, this.player, randTile) === false) {
        if (owner.isPlayer()) {
          unreachablePlayers.add(owner.id());
        }
        continue;
      }

      return randTile;
    }
    return null;
  }

  // attackBestTarget is called with borderingFriends and borderingEnemies sorted by troops (ascending)
  private attackBestTarget(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ) {
    // Save up troops until we reach the reserve ratio
    if (!this.hasReserveRatioTroops()) return;

    // Maybe save up troops until we reach the trigger ratio
    if (!this.hasTriggerRatioTroops() && !this.random.chance(10)) return;

    // Get attack strategies in priority order based on difficulty
    const strategies = this.getAttackStrategies(
      borderingFriends,
      borderingEnemies,
    );

    for (const strategy of strategies) {
      if (strategy()) return;
    }
  }

  private getAttackStrategies(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): Array<() => boolean> {
    const { difficulty } = this.game.config().gameConfig();

    // Define all strategies as functions that return true if they attacked
    const retaliate = (): boolean => {
      const attacker = this.findIncomingAttackPlayer();
      if (attacker) {
        this.sendAttack(attacker, true);
        return true;
      }
      return false;
    };

    const bots = (): boolean => this.attackBots();

    const assist = (): boolean => this.assistAllies();

    const traitor = (): boolean => {
      const traitor = this.findTraitor(borderingEnemies);
      if (traitor) {
        this.sendAttack(traitor);
        return true;
      }
      return false;
    };

    const afk = (): boolean => {
      // borderingEnemies is already sorted by troops (ascending), so first match is weakest afk enemy
      const afk = borderingEnemies.find(
        (enemy) =>
          enemy.isDisconnected() && enemy.troops() < this.player.troops() * 3,
      );
      if (afk) {
        this.sendAttack(afk);
        return true;
      }
      return false;
    };

    const betray = (): boolean =>
      this.maybeBetrayAndAttack(borderingFriends, borderingEnemies);

    const nuked = (): boolean => {
      if (this.isBorderingNukedTerritory()) {
        this.sendAttack(this.game.terraNullius());
        return true;
      }
      return false;
    };

    const victim = (): boolean => {
      const victim = this.findVictim(borderingEnemies);
      if (victim) {
        this.sendAttack(victim);
        return true;
      }
      return false;
    };

    const hated = (): boolean => {
      for (const relation of this.player.allRelationsSorted()) {
        if (relation.relation !== Relation.Hostile) continue;
        const other = relation.player;
        if (this.player.isFriendly(other)) continue;
        if (other.troops() > this.player.troops() * 3) continue;
        this.sendAttack(other);
        return true;
      }
      return false;
    };

    const veryWeak = (): boolean => {
      const veryWeak = this.findVeryWeakEnemy(borderingEnemies);
      if (veryWeak) {
        this.sendAttack(veryWeak);
        return true;
      }
      return false;
    };

    const weakest = (): boolean => {
      if (borderingEnemies.length > 0) {
        // borderingEnemies is already sorted by troops (ascending), so first match is weakest
        const weakest = borderingEnemies[0];
        // Don't attack if they have more troops than us
        if (weakest.troops() < this.player.troops()) {
          this.sendAttack(weakest);
          return true;
        }
      }
      return false;
    };

    const island = (): boolean => {
      if (borderingEnemies.length === 0) {
        const enemy = this.findNearestIslandEnemy();
        if (enemy) {
          this.sendAttack(enemy);
          return true;
        }
      }
      return false;
    };

    // Return strategies in order based on difficulty
    // Easy nations get the dumbest order, impossible nations get the smartest order
    switch (difficulty) {
      case Difficulty.Easy:
        // prettier-ignore
        return [nuked, bots, retaliate, assist, betray, hated, weakest];
      case Difficulty.Medium:
        // prettier-ignore
        return [bots, nuked, retaliate, assist, betray, hated, afk, traitor, weakest, island];
      case Difficulty.Hard:
        // prettier-ignore
        return [bots, retaliate, assist, betray, nuked, traitor, afk, hated, veryWeak, victim, weakest, island];
      case Difficulty.Impossible:
        // prettier-ignore
        return [retaliate, bots, veryWeak, assist, traitor, afk, betray, victim, nuked, hated, weakest, island];
      default:
        assertNever(difficulty);
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

  findIncomingAttackPlayer(): Player | null {
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

  // Sort neighboring bots by density (troops / tiles) and attempt to attack many of them (Parallel attacks)
  // sendAttack will do nothing if we don't have enough reserve troops left
  private attackBots(): boolean {
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

  private getBotAttackMaxParallelism(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 1;
      case Difficulty.Medium:
        return this.random.chance(2) ? 1 : 2;
      case Difficulty.Hard:
        return 3;
      // On impossible difficulty, attack as much bots as possible in parallel
      case Difficulty.Impossible: {
        return 100;
      }
      default:
        assertNever(difficulty);
    }
  }

  private assistAllies(): boolean {
    if (this.emojiBehavior === undefined) throw new Error("not initialized");

    for (const ally of this.player.allies()) {
      if (ally.targets().length === 0) continue;
      if (this.player.relation(ally) < Relation.Friendly) {
        this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_RELATION_TOO_LOW);
        continue;
      }
      for (const target of ally.targets()) {
        if (target === this.player) {
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ME);
          continue;
        }
        if (this.player.isFriendly(target)) {
          this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_TARGET_ALLY);
          continue;
        }
        // All checks passed, assist them
        this.player.updateRelation(ally, -20);
        this.sendAttack(target);
        this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_ACCEPT);
        return true;
      }
    }
    return false;
  }

  // Find a traitor who isn't significantly stronger than us
  private findTraitor(borderingEnemies: Player[]): Player | null {
    // borderingEnemies is already sorted by troops (ascending), so first match is weakest traitor
    return (
      borderingEnemies.find(
        (enemy) =>
          enemy.isTraitor() && enemy.troops() < this.player.troops() * 1.2,
      ) ?? null
    );
  }

  private maybeBetrayAndAttack(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): boolean {
    if (this.allianceBehavior === undefined) throw new Error("not initialized");

    if (borderingFriends.length > 0) {
      for (const friend of borderingFriends) {
        if (
          this.allianceBehavior.maybeBetray(
            friend,
            borderingFriends.length + borderingEnemies.length,
          )
        ) {
          this.sendAttack(friend, true);
          return true;
        }
      }
    }
    return false;
  }

  private isBorderingNukedTerritory(): boolean {
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

  // Find someone who isn't significantly stronger than us and is under big attack from others (50%+ of their troops incoming)
  private findVictim(borderingEnemies: Player[]): Player | null {
    // borderingEnemies is already sorted by troops (ascending), so first match is weakest victim
    return (
      borderingEnemies.find((enemy) => {
        if (enemy.troops() > this.player.troops() * 1.2) return false;

        const totalIncomingTroops = enemy
          .incomingAttacks()
          .reduce((sum, attack) => sum + attack.troops(), 0);

        return totalIncomingTroops > enemy.troops() * 0.5;
      }) ?? null
    );
  }

  // Find very weak (less than 15% of their maxTroops) enemies
  // which also don't have significantly more troops than us (to target MIRVed players)
  private findVeryWeakEnemy(borderingEnemies: Player[]): Player | null {
    const veryWeakEnemies = borderingEnemies.filter((enemy) => {
      const enemyMaxTroops = this.game.config().maxTroops(enemy);
      return (
        enemy.troops() < enemyMaxTroops * 0.15 &&
        enemy.troops() < this.player.troops() * 1.2
      );
    });

    // borderingEnemies is already sorted by troops (ascending), so first match is weakest very weak enemy
    return veryWeakEnemies.length > 0 ? veryWeakEnemies[0] : null;
  }

  private findNearestIslandEnemy(): Player | null {
    const myBorder = this.player.borderTiles();
    if (myBorder.size === 0) return null;

    const filteredPlayers = this.game.players().filter((p) => {
      if (p === this.player) return false;
      if (!p.isAlive()) return false;
      if (p.borderTiles().size === 0) return false;
      if (this.player.isFriendly(p)) return false;
      // Don't spam boats into players with more troops
      return p.troops() < this.player.troops();
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

  private getPlayerCenter(player: Player) {
    if (player.largestClusterBoundingBox) {
      return boundingBoxCenter(player.largestClusterBoundingBox);
    }
    return calculateBoundingBoxCenter(this.game, player.borderTiles());
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
        neighbor.type() === PlayerType.Nation ||
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

  getNeighborTraitorToAttack(): Player | null {
    const traitors = this.player
      .neighbors()
      .filter(
        (n): n is Player =>
          n.isPlayer() && this.player.isFriendly(n) === false && n.isTraitor(),
      );
    return traitors.length > 0 ? this.random.randElement(traitors) : null;
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

  shouldAttack(other: Player | TerraNullius): boolean {
    // Always attack Terra Nullius, non-humans and traitors (or if we are a bot)
    if (
      other.isPlayer() === false ||
      other.type() !== PlayerType.Human ||
      other.isTraitor() ||
      this.player.type() === PlayerType.Bot
    ) {
      return true;
    }

    // Prevent attacking of humans on lower difficulties
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy && this.random.chance(2)) {
      return false;
    }
    if (difficulty === Difficulty.Medium && this.random.chance(4)) {
      return false;
    }
    return true;
  }

  private sendLandAttack(target: Player | TerraNullius) {
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

    if (target.isPlayer() && this.player.type() === PlayerType.Nation) {
      if (this.emojiBehavior === undefined) throw new Error("not initialized");
      this.emojiBehavior.maybeSendAttackEmoji(target);
    }

    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
      ),
    );
  }

  private sendBoatAttack(target: Player) {
    const closest = closestTwoTiles(
      this.game,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.game.isOceanShore(t),
      ),
      Array.from(target.borderTiles()).filter((t) => this.game.isOceanShore(t)),
    );
    if (closest === null) {
      return;
    }

    let troops;
    if (target.type() === PlayerType.Bot) {
      troops = this.calculateBotAttackTroops(target, this.player.troops() / 5);
    } else {
      troops = this.player.troops() / 5;
    }

    if (troops < 1) {
      return;
    }

    if (target.isPlayer() && this.player.type() === PlayerType.Nation) {
      if (this.emojiBehavior === undefined) throw new Error("not initialized");
      this.emojiBehavior.maybeSendAttackEmoji(target);
    }

    this.game.addExecution(
      new TransportShipExecution(
        this.player,
        target.id(),
        closest.y,
        troops,
        null,
      ),
    );
  }

  private calculateBotAttackTroops(target: Player, maxTroops: number): number {
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
}
