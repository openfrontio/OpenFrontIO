import { z } from "zod";
import {
  Cell,
  Difficulty,
  Game,
  GameMode,
  GameType,
  HumansVsNations,
  Player,
  PlayerID,
  PlayerType,
  Relation,
  Structures,
  TerraNullius,
  Unit,
  UnitType,
} from "../../game/Game";
import { TileRef } from "../../game/GameMap";
import {
  canBuildTransportShip,
  targetTransportTile,
} from "../../game/TransportShipUtils";
import { PathFinding } from "../../pathfinding/PathFinder";
import { PseudoRandom } from "../../PseudoRandom";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../../snapshot/SnapshotContext";
import {
  readVersioned,
  snapshotType,
  Versioned,
  zNum,
} from "../../snapshot/SnapshotType";
import {
  assertNever,
  boundingBoxCenter,
  calculateBoundingBoxCenter,
} from "../../Util";
import { AttackExecution } from "../AttackExecution";
import { DonateTroopsExecution } from "../DonateTroopExecution";
import { NationAllianceBehavior } from "../nation/NationAllianceBehavior";
import {
  EMOJI_ASSIST_ACCEPT,
  EMOJI_ASSIST_RELATION_TOO_LOW,
  EMOJI_ASSIST_TARGET_ALLY,
  EMOJI_ASSIST_TARGET_ME,
  NationEmojiBehavior,
} from "../nation/NationEmojiBehavior";
import { findJuiciestTarget, findRunawayLeader } from "../nation/NationUtils";
import type { NationWarshipBehavior } from "../nation/NationWarshipBehavior";
import { TransportShipExecution } from "../TransportShipExecution";
import { closestTwoTiles } from "../Util";

// Reusable neighbor buffer for hot loops; the simulation is single-threaded.
const NEIGHBOR_SCRATCH: TileRef[] = [0, 0, 0, 0];

// A planned boat attack: where it lands, how many tiles it sails, what would sink it
interface BoatRoute {
  landing: TileRef;
  length: number;
  blocker: Unit | null;
}

type Box = { min: Cell; max: Cell } | null | undefined;

// Fewest tiles between two boxes (unknown boxes count as touching)
function boxGap(a: Box, b: Box): number {
  if (!a || !b) return 0;
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  return dx + dy;
}

export class AiAttackBehavior {
  private botAttackTroopsSent: number = 0;
  // Only set during a maybeAttack call: our land neighbors, and each boat route planned
  private landNeighbors: Set<Player> | null = null;
  private boatRoutes: Map<Player, BoatRoute | null> | null = null;

  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private triggerRatio: number,
    private reserveRatio: number,
    private expandRatio: number,
    private allianceBehavior?: NationAllianceBehavior,
    private emojiBehavior?: NationEmojiBehavior,
    private warshipBehavior?: NationWarshipBehavior,
  ) {}

  /** The owner supplies the shared PRNG, player and nation behaviors. */
  snapshot(w: SnapshotWriter): Versioned {
    return w.versioned(AiAttackBehaviorSnapshot, {
      botAttackTroopsSent: this.botAttackTroopsSent,
      triggerRatio: this.triggerRatio,
      reserveRatio: this.reserveRatio,
      expandRatio: this.expandRatio,
    });
  }

  /** Fills a prototype-only shell; only assigns (see README). */
  restoreSnapshot(
    raw: unknown,
    r: SnapshotReader,
    random: PseudoRandom,
    player: Player,
    allianceBehavior?: NationAllianceBehavior,
    emojiBehavior?: NationEmojiBehavior,
    warshipBehavior?: NationWarshipBehavior,
  ): void {
    const s = readVersioned(AiAttackBehaviorSnapshot, raw);
    this.random = random;
    this.game = r.game;
    this.player = player;
    this.allianceBehavior = allianceBehavior;
    this.emojiBehavior = emojiBehavior;
    this.warshipBehavior = warshipBehavior;
    // Only set during a maybeAttack call, so always null between ticks.
    this.landNeighbors = null;
    this.boatRoutes = null;
    this.botAttackTroopsSent = s.botAttackTroopsSent;
    this.triggerRatio = s.triggerRatio;
    this.reserveRatio = s.reserveRatio;
    this.expandRatio = s.expandRatio;
    // Scratch buffer: always written before it is read.
    this.nbuf = [0, 0, 0, 0];
  }

  maybeAttack() {
    const routes = new Map<Player, BoatRoute | null>();
    this.boatRoutes = routes;
    try {
      this.chooseAttack();
    } finally {
      this.landNeighbors = null;
      this.boatRoutes = null;
    }
    this.clearBlockedLane(routes);
  }

  private chooseAttack() {
    if (this.player === null || this.allianceBehavior === undefined) {
      throw new Error("not initialized");
    }

    // Neighbor visit order matters here: the set's insertion order feeds the
    // stable troop-count sort below, so ties keep border-discovery order.
    const borderingPlayerSet = new Set<Player>();
    let borderHasNonNukedTerraNullius = false;
    const smallID = this.player.smallID();
    const visit = (t: number) => {
      if (!this.game.isLand(t) || this.game.isImpassable(t)) return;
      if (this.game.ownerID(t) === smallID) return;
      const owner = this.game.playerBySmallID(this.game.ownerID(t));
      if (owner.isPlayer()) borderingPlayerSet.add(owner);
      if (!this.game.hasOwner(t) && !this.game.hasFallout(t)) {
        borderHasNonNukedTerraNullius = true;
      }
    };
    // forEach, not for..of: TileSet.values() is a generator.
    this.player.borderTiles().forEach((t) => {
      this.game.forEachNeighbor(t, visit);
    });
    this.landNeighbors = new Set(borderingPlayerSet);
    const playerNeighbors = this.player.nearby();
    for (const n of playerNeighbors) {
      if (n.isPlayer()) borderingPlayerSet.add(n);
    }
    const borderingPlayers = [...borderingPlayerSet].sort(
      (a, b) => a.troops() - b.troops(),
    );
    const borderingFriends = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === true,
    );
    const borderingEnemies = borderingPlayers.filter(
      (o) => this.player?.isFriendly(o) === false,
    );

    // Attack TerraNullius but not nuked territory (direct border or across a river)
    const hasNonNukedTerraNullius =
      borderHasNonNukedTerraNullius ||
      playerNeighbors.some((n) => !n.isPlayer());
    if (hasNonNukedTerraNullius) {
      if (this.sendAttack(this.game.terraNullius())) return;
    }

    const holdBoats = this.holdsBoatsUnderAttack();
    if (borderingEnemies.length === 0) {
      if (!holdBoats && this.random.chance(5)) {
        this.attackWithRandomBoat();
      }
    } else {
      if (!holdBoats && this.random.chance(10)) {
        this.attackWithRandomBoat(borderingEnemies);
        return;
      }

      this.allianceBehavior.maybeSendAllianceRequests(borderingEnemies);
    }

    this.attackBestTarget(borderingFriends, borderingEnemies);
  }

  private attackWithRandomBoat(borderingEnemies: Player[] = []) {
    if (this.player === null) throw new Error("not initialized");

    if (this.game.config().isUnitDisabled(UnitType.TransportShip)) {
      return;
    }

    // Check if we've already sent out the maximum number of transport ships
    if (
      this.player.unitCount(UnitType.TransportShip) >=
      this.game.config().boatMaxNumber()
    ) {
      return;
    }

    // Check if we have any shore tiles to launch from
    const shore = this.shoreTiles(this.player);
    if (shore.length === 0) {
      return;
    }

    const src = this.random.randElement(shore);

    // First look for high-interest targets (unowned or bot-owned). Mainly relevant for earlygame
    let found = this.findRandomBoatTarget(src, borderingEnemies, true);
    if (found === null) {
      // None found? Then look for players
      found = this.findRandomBoatTarget(src, borderingEnemies, false);
      if (found === null) {
        return;
      }
    }
    const { tile: dst, launch } = found;
    if (this.sail(launch, dst).blocker !== null) return;

    const owner = this.game.owner(dst);
    const cap = owner.isPlayer()
      ? this.troopSendCap()
      : this.troopSendCapForExpansion();
    const troops = Math.min(this.player.troops() / 5, cap);
    if (troops < 1) return;

    // Hard & Impossible: don't attack if we'd send less than 20% of target's troops
    if (owner.isPlayer() && this.isAttackTooWeak(troops, owner)) {
      return;
    }

    this.game.addExecution(
      new TransportShipExecution(this.player, dst, troops),
    );
  }

  private findRandomBoatTarget(
    tile: TileRef,
    borderingEnemies: Player[],
    highInterestOnly: boolean = false,
  ): { tile: TileRef; launch: TileRef } | null {
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
      if (this.game.isImpassable(randTile)) {
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
      // Don't spam boats into players which are stronger than us (FFA only)
      if (
        this.isFFA() &&
        owner.isPlayer() &&
        owner.troops() > this.player.troops()
      ) {
        continue;
      }

      let matchesCriteria: boolean;
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
      const launch = canBuildTransportShip(this.game, this.player, randTile);
      if (launch === false) {
        if (owner.isPlayer()) {
          unreachablePlayers.add(owner.id());
        }
        continue;
      }

      return { tile: randTile, launch };
    }
    return null;
  }

  // attackBestTarget is called with borderingFriends and borderingEnemies sorted by troops (ascending)
  private attackBestTarget(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ) {
    const { difficulty } = this.game.config().gameConfig();

    // Hard & Impossible: answer attacks right away, even below the reserve and trigger ratios
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      this.retaliate()
    ) {
      return;
    }

    // In games with high starting gold, nations will quickly build a lot of cities
    // This causes them to expand slowly (cities increase max troops), and bots will steal their structures
    // In this case: Attack bots before ratio checks
    if (this.hasNeighboringBotWithStructures()) {
      if (this.attackBots()) return;
    }

    // Save up troops until we reach the reserve ratio
    if (!this.hasReserveRatioTroops()) return;

    // Medium: answer attacks without saving up to the trigger ratio first
    if (difficulty === Difficulty.Medium && this.retaliate()) return;

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

    // Target groups, tried in order and each sorted by troops (ascending). Hard & Impossible
    // without a land front weigh every enemy within boat range across the water alongside
    // the bordering ones; Impossible with a land front turns to them once it finds nothing there.
    let groups: Player[][] | null = null;
    const targetGroups = (): Player[][] => {
      if (groups !== null) return groups;
      const byTroops = (a: Player, b: Player) => a.troops() - b.troops();
      const landFront = borderingEnemies.some((enemy) =>
        this.bordersByLand(enemy),
      );
      if (difficulty === Difficulty.Impossible && landFront) {
        groups = [
          borderingEnemies,
          this.overseasTargets(borderingEnemies).sort(byTroops),
        ];
      } else if (
        (difficulty === Difficulty.Hard ||
          difficulty === Difficulty.Impossible) &&
        !landFront
      ) {
        groups = [
          [...borderingEnemies, ...this.overseasTargets(borderingEnemies)].sort(
            byTroops,
          ),
        ];
      } else {
        groups = [borderingEnemies];
      }
      return groups;
    };

    // What `find` picks among the targets we can reach right now, from the first group
    // where it picks anything (Easy doesn't check). Only its picks get a boat route planned.
    const pick = (
      find: (enemies: Player[]) => Player | null,
    ): Player | null => {
      for (const group of targetGroups()) {
        let pool = group;
        for (;;) {
          const target = find(pool);
          if (target === null) break;
          if (difficulty === Difficulty.Easy || this.canReach(target)) {
            return target;
          }
          pool = pool.filter((enemy) => enemy !== target);
        }
      }
      return null;
    };

    // Define all strategies as functions that return true if they attacked
    const retaliate = (): boolean => this.retaliate();

    const bots = (): boolean => this.attackBots();

    const assist = (): boolean => this.assistAllies();

    const traitor = (): boolean => {
      const traitor = pick((enemies) => this.findTraitor(enemies));
      if (traitor) {
        return this.sendAttack(traitor);
      }
      return false;
    };

    const afk = (): boolean => {
      // Groups are sorted by troops (ascending), so the first match is the weakest afk enemy
      const afk = pick(
        (enemies) =>
          enemies.find(
            (enemy) =>
              enemy.isDisconnected() &&
              (!this.isFFA() || enemy.troops() < this.player.troops() * 3),
          ) ?? null,
      );
      if (afk) {
        return this.sendAttack(afk);
      }
      return false;
    };

    const betray = (): boolean =>
      this.maybeBetrayAndAttack(borderingFriends, borderingEnemies);

    const nuked = (): boolean => {
      if (this.isBorderingNukedTerritory()) {
        return this.sendAttack(this.game.terraNullius());
      }
      return false;
    };

    const victim = (): boolean => {
      const victim = pick((enemies) => this.findVictim(enemies));
      if (victim) {
        return this.sendAttack(victim);
      }
      return false;
    };

    const juicy = (): boolean => {
      const target = pick((enemies) => this.findJuicyTarget(enemies));
      return target !== null ? this.sendAttack(target) : false;
    };

    const hated = (): boolean => {
      for (const relation of this.player.allRelationsSorted()) {
        if (relation.relation !== Relation.Hostile) continue;
        const other = relation.player;
        if (this.player.isFriendly(other)) continue;
        if (this.isFFA() && other.troops() > this.player.troops() * 3) continue;
        if (difficulty !== Difficulty.Easy && !this.canReach(other)) continue;
        return this.sendAttack(other);
      }
      return false;
    };

    const veryWeak = (): boolean => {
      const veryWeak = pick((enemies) => this.findVeryWeakEnemy(enemies));
      if (veryWeak) {
        return this.sendAttack(veryWeak);
      }
      return false;
    };

    const weakest = (): boolean => {
      // Groups are sorted by troops (ascending), so the first match is the weakest.
      // In FFA, don't attack if they have more troops than us
      const weakest = pick(
        (enemies) =>
          enemies.find(
            (enemy) => !this.isFFA() || enemy.troops() < this.player.troops(),
          ) ?? null,
      );
      return weakest !== null ? this.sendAttack(weakest) : false;
    };

    const island = (): boolean => {
      if (pick((enemies) => enemies[0] ?? null) === null) {
        const enemy = this.findNearestIslandEnemy();
        if (enemy) {
          return this.sendAttack(enemy);
        }
      }
      return false;
    };

    const donate = (): boolean => this.donateTroops();

    const crown = (): boolean => {
      const leader = this.findCrownTarget(borderingEnemies);
      return (
        leader !== null &&
        this.shouldAttack(leader) &&
        this.sendLandAttack(leader, undefined, leader)
      );
    };

    // Return strategies in order based on difficulty
    // Easy nations get the dumbest order, impossible nations get the smartest order
    // Medium and up retaliate in attackBestTarget, ahead of the ratio checks
    switch (difficulty) {
      case Difficulty.Easy:
        // So dumb, they cant even find islanders
        // prettier-ignore
        return [nuked, bots, retaliate, assist, betray, hated, weakest];
      case Difficulty.Medium:
        // prettier-ignore
        return [bots, nuked, assist, betray, hated, afk, traitor, crown, weakest, island, donate];
      case Difficulty.Hard:
        // Strong veryWeak and juicy strats after the distracting hated strat, to make the nations weaker than impossible
        // prettier-ignore
        return [bots, assist, betray, nuked, traitor, afk, hated, veryWeak, juicy, victim, crown, weakest, island, donate];
      case Difficulty.Impossible:
        // prettier-ignore
        return [bots, veryWeak, betray, assist, victim, crown, traitor, juicy, afk, nuked, hated, weakest, island, donate];
      default:
        assertNever(difficulty);
    }
  }

  private hasNeighboringBotWithStructures(): boolean {
    return this.player
      .nearby()
      .some(
        (n) =>
          n.isPlayer() &&
          n.type() === PlayerType.Bot &&
          !this.player.isFriendly(n) &&
          n.units().some((u) => Structures.has(u.type())),
      );
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
    let incomingAttacks = this.player
      .incomingAttacks()
      .filter((attack) => !this.player.isFriendly(attack.attacker()));
    // Ignore bot attacks if we are not a bot.
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

  private retaliate(): boolean {
    const attacker = this.findIncomingAttackPlayer();
    if (attacker === null) return false;
    const { difficulty } = this.game.config().gameConfig();
    if (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      this.isFFA() &&
      this.player.sharesBorderWith(attacker)
    ) {
      return this.sendRetaliation(attacker);
    }
    return this.sendAttack(attacker, true);
  }

  // Hard & Impossible keep their troops home while under attack, Medium only sometimes
  private holdsBoatsUnderAttack(): boolean {
    if (this.findIncomingAttackPlayer() === null) return false;
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return false;
      case Difficulty.Medium:
        return this.random.chance(2);
      case Difficulty.Hard:
      case Difficulty.Impossible:
        return true;
      default:
        assertNever(difficulty);
    }
  }

  // Cancels the attacker's incoming troops. If we can also match its home army
  // while keeping back what troopSendCap wants for every other neighbor, pushes
  // into its land with at least that much (the attacker isn't a threat then,
  // its army is busy with us). Otherwise only cancels, as far as the reserve allows.
  // Never dips below the expand ratio: troop growth nearly stops near zero.
  private sendRetaliation(attacker: Player): boolean {
    let incoming = 0;
    for (const attack of this.player.incomingAttacks()) {
      if (attack.attacker() === attacker) incoming += attack.troops();
    }
    let pressing = 0;
    for (const attack of this.player.outgoingAttacks()) {
      if (attack.target() === attacker) pressing += attack.troops();
    }
    const troops = this.player.troops();
    const maxTroops = this.game.config().maxTroops(this.player);
    const spare = Math.min(
      troops - maxTroops * this.expandRatio,
      this.neighborTroopCap(attacker),
    );
    const aboveReserve = troops - maxTroops * this.reserveRatio;
    const counter = incoming + Math.max(0, attacker.troops() - pressing);
    const send =
      spare >= counter
        ? Math.max(counter, Math.min(aboveReserve, spare))
        : Math.min(incoming, Math.max(spare, aboveReserve));
    return this.sendLandAttack(attacker, () => send, attacker);
  }

  // A bordering runaway leader. Hard & Impossible always consider it: the
  // too-weak check in calculateAttackTroops decides whether our stack, plus
  // the troops already attacking it, is worth it. Medium only joins attacks
  // already under way.
  private findCrownTarget(borderingEnemies: Player[]): Player | null {
    const leader = findRunawayLeader(this.game);
    if (
      leader === null ||
      !borderingEnemies.includes(leader) ||
      !this.player.sharesBorderWith(leader)
    ) {
      return null;
    }
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty === Difficulty.Hard ||
      difficulty === Difficulty.Impossible
    ) {
      return leader;
    }
    return this.troopsAttacking(leader) >= leader.troops() * 0.1
      ? leader
      : null;
  }

  private troopsAttacking(target: Player): number {
    return target.incomingAttacks().reduce((sum, a) => sum + a.troops(), 0);
  }

  // Sort neighboring bots by density (troops / tiles) and attempt to attack many of them (Parallel attacks)
  // sendAttack will do nothing if we don't have enough reserve troops left
  // Bots that own structures are prioritized as targets (they might have stolen our structures and they will delete them!)
  private attackBots(): boolean {
    const bots = this.player
      .nearby()
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
    const ownsStructures = (p: Player) =>
      p.units().some((u) => Structures.has(u.type()));
    const sortedBots = bots.slice().sort((a, b) => {
      const aHasStructures = ownsStructures(a);
      const bHasStructures = ownsStructures(b);
      if (aHasStructures !== bHasStructures) {
        return aHasStructures ? -1 : 1;
      }
      return density(a) - density(b);
    });
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

    if (this.game.config().disableAlliances()) return false;

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
        if (!this.sendAttack(target)) continue;
        this.player.updateRelation(ally, -20);
        this.emojiBehavior.sendEmoji(ally, EMOJI_ASSIST_ACCEPT);
        return true;
      }
    }
    return false;
  }

  // Find a traitor who isn't significantly stronger than us
  private findTraitor(enemies: Player[]): Player | null {
    if (this.game.config().disableAlliances()) return null;

    // enemies is already sorted by troops (ascending), so first match is weakest traitor
    return (
      enemies.find(
        (enemy) =>
          enemy.isTraitor() &&
          (!this.isFFA() || enemy.troops() < this.player.troops() * 1.2),
      ) ?? null
    );
  }

  private maybeBetrayAndAttack(
    borderingFriends: Player[],
    borderingEnemies: Player[],
  ): boolean {
    if (this.allianceBehavior === undefined) throw new Error("not initialized");

    if (this.game.config().disableAlliances()) return false;

    if (borderingFriends.length > 0) {
      // Computed once here, not per friend below - it doesn't depend on which one.
      const juiciestAlly =
        this.allianceBehavior.findJuiciestAlly(borderingFriends);
      for (const friend of borderingFriends) {
        if (
          this.allianceBehavior.maybeBetray(
            friend,
            juiciestAlly,
            borderingFriends,
            borderingEnemies,
          )
        ) {
          return this.sendAttack(friend, true);
        }
      }
    }
    return false;
  }

  private isBorderingNukedTerritory(): boolean {
    if (this.game.config().isUnitDisabled(UnitType.MissileSilo)) {
      return false;
    }

    // Boolean result, so neighbor order doesn't matter; a reused scratch
    // buffer keeps this allocation-free and allows early exit.
    const nbuf = NEIGHBOR_SCRATCH;
    for (const tile of this.player.borderTiles()) {
      const n = this.game.neighbors4(tile, nbuf);
      for (let i = 0; i < n; i++) {
        const neighbor = nbuf[i];
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
  private findVictim(enemies: Player[]): Player | null {
    // enemies is already sorted by troops (ascending), so first match is weakest victim
    return (
      enemies.find((enemy) => {
        if (this.isFFA() && enemy.troops() > this.player.troops() * 1.2) {
          return false;
        }

        const totalIncomingTroops = enemy
          .incomingAttacks()
          .reduce((sum, attack) => sum + attack.troops(), 0);

        return totalIncomingTroops > enemy.troops() * 0.5;
      }) ?? null
    );
  }

  // Find very weak (less than 15% of their maxTroops) enemies
  // which also don't have significantly more troops than us (to target MIRVed players)
  private findVeryWeakEnemy(enemies: Player[]): Player | null {
    const veryWeakEnemies = enemies.filter((enemy) => {
      const enemyMaxTroops = this.game.config().maxTroops(enemy);
      return (
        enemy.troops() < enemyMaxTroops * 0.15 &&
        (!this.isFFA() || enemy.troops() < this.player.troops() * 1.2)
      );
    });

    // enemies is already sorted by troops (ascending), so first match is weakest very weak enemy
    return veryWeakEnemies.length > 0 ? veryWeakEnemies[0] : null;
  }

  // Juiciest enemy (Hard & Impossible only) we could plausibly beat (troops <= 75% of ours)
  private findJuicyTarget(enemies: Player[]): Player | null {
    const candidates = enemies.filter(
      (enemy) => enemy.troops() <= this.player.troops() * 0.75,
    );
    return findJuiciestTarget(this.game, candidates);
  }

  private findNearestIslandEnemy(): Player | null {
    if (this.game.config().isUnitDisabled(UnitType.TransportShip)) {
      return null;
    }

    // Check if we've already sent out the maximum number of transport ships
    if (
      this.player.unitCount(UnitType.TransportShip) >=
      this.game.config().boatMaxNumber()
    ) {
      return null;
    }

    // Check if we have any shore tiles to launch from
    const hasShore = Array.from(this.player.borderTiles()).some((t) =>
      this.game.isShore(t),
    );
    if (!hasShore) return null;

    const filteredPlayers = this.game.players().filter((p) => {
      if (p === this.player) return false;
      if (this.player.isFriendly(p)) return false;
      // In FFA, don't spam boats into players with more troops
      return !this.isFFA() || p.troops() < this.player.troops();
    });

    if (filteredPlayers.length === 0) return null;

    const playerCenter = this.getPlayerCenter(this.player);

    const sortedPlayers = filteredPlayers
      .map((filteredPlayer) => {
        const filteredPlayerCenter = this.getPlayerCenter(filteredPlayer);

        const playerCenterTile = this.game.ref(playerCenter.x, playerCenter.y);
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

    // Try players in order of distance until we find reachable candidates
    const reachablePlayers: Player[] = [];
    for (const entry of sortedPlayers) {
      if (this.canReach(entry.player)) {
        reachablePlayers.push(entry.player);
        // We only need up to 2 reachable candidates
        if (reachablePlayers.length >= 2) break;
      }
    }

    if (reachablePlayers.length === 0) return null;

    // 33% chance to pick the second-nearest player if available
    if (reachablePlayers.length >= 2 && this.random.chance(3)) {
      return reachablePlayers[1];
    }

    return reachablePlayers[0];
  }

  // In team games, nations should be willing to attack/boat into stronger
  // enemies - they can rely on teammates to donate. In FFA, going after
  // someone significantly stronger is usually a losing proposition.
  private isFFA(): boolean {
    return this.game.config().gameConfig().gameMode === GameMode.FFA;
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

  getNeighborTraitorToAttack(): Player | null {
    if (this.game.config().disableAlliances()) return null;

    const traitors = this.player
      .nearby()
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

  sendAttack(target: Player | TerraNullius, force = false): boolean {
    if (!force && !this.shouldAttack(target)) return false;

    if (target.isPlayer()) {
      if (this.player.sharesBorderWith(target)) {
        return this.sendLandAttack(target);
      } else {
        return this.sendBoatAttack(target);
      }
    } else {
      // sharesBorderWith(TerraNullius) counts water tiles as TN (ownerID 0 = TN smallID),
      // so use a land-only adjacency check to decide land vs boat attack.
      if (this.hasLandBorderWithTerraNullius()) {
        return this.sendLandAttack(target);
      } else {
        return this.sendBoatAttackToNearbyTerraNullius();
      }
    }
  }

  private hasLandBorderWithTerraNullius(): boolean {
    // Allocation-free (neighbors() built an array per border tile and this
    // runs on every terra-nullius attack decision of every nation) — but
    // through for...of, not forEach: the dominant caller path answers true,
    // and the early exit matters more than the generator's overhead.
    const map = this.game.map();
    const nbuf = this.nbuf;
    for (const border of this.player.borderTiles()) {
      const n = map.neighbors4(border, nbuf);
      for (let i = 0; i < n; i++) {
        const neighbor = nbuf[i];
        if (
          map.isLand(neighbor) &&
          !map.isImpassable(neighbor) &&
          !map.hasOwner(neighbor)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private nbuf: TileRef[] = [0, 0, 0, 0];

  /** The player's shore border tiles, in border-set order (one pass, no copy of the whole set). */
  private shoreTiles(player: Player): TileRef[] {
    const game = this.game;
    const out: TileRef[] = [];
    player.borderTiles().forEach((t) => {
      if (game.isShore(t)) out.push(t);
    });
    return out;
  }

  // Scans shore border tiles (every 10th) for unowned land within 5 water tiles
  // in each cardinal direction, then sends a transport ship to the first match.
  private sendBoatAttackToNearbyTerraNullius(): boolean {
    if (this.game.config().isUnitDisabled(UnitType.TransportShip)) return false;
    if (
      this.player.unitCount(UnitType.TransportShip) >=
      this.game.config().boatMaxNumber()
    )
      return false;

    const directions: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
    const shores = this.shoreTiles(this.player);

    for (let i = 0; i < shores.length; i += 10) {
      const border = shores[i];

      const bx = this.game.x(border);
      const by = this.game.y(border);

      for (const [dx, dy] of directions) {
        const x1 = bx + dx;
        const y1 = by + dy;
        if (!this.game.isValidCoord(x1, y1)) continue;
        if (!this.game.isWater(this.game.ref(x1, y1))) continue;

        const nx = bx + dx * 5;
        const ny = by + dy * 5;
        if (!this.game.isValidCoord(nx, ny)) continue;
        const tile = this.game.ref(nx, ny);
        if (!this.game.isLand(tile)) continue;
        if (this.game.isImpassable(tile)) continue;
        if (this.game.hasOwner(tile)) continue;
        if (this.game.hasFallout(tile)) continue;
        const launch = canBuildTransportShip(this.game, this.player, tile);
        if (launch === false) continue;
        if (this.sail(launch, tile).blocker !== null) continue;

        const troops = Math.min(
          this.player.troops() / 5,
          this.troopSendCapForExpansion(),
        );
        if (troops < 1) return false;

        this.game.addExecution(
          new TransportShipExecution(this.player, tile, troops),
        );
        return true;
      }
    }
    return false;
  }

  shouldAttack(other: Player | TerraNullius): boolean {
    if (
      // Always attack Terra Nullius, non-humans and traitors
      other.isPlayer() === false ||
      other.type() !== PlayerType.Human ||
      other.isTraitor() ||
      // Always attack if we are a bot or in an HvN game
      this.player.type() === PlayerType.Bot ||
      this.game.config().gameConfig().playerTeams === HumansVsNations
    ) {
      return true;
    }

    // Prevent attacking of humans on lower difficulties
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy && this.random.nextInt(0, 4) !== 0) {
      return false;
    }
    if (difficulty === Difficulty.Medium && this.random.chance(4)) {
      return false;
    }
    return true;
  }

  /**
   * For Hard & Impossible nations in FFA: returns true if `troops` is less
   * than 20% of the target's troop count, meaning the attack is too weak to
   * be worthwhile.  Bots and team games are exempt.
   */
  private isAttackTooWeak(troops: number, target: Player): boolean {
    if (this.player.type() === PlayerType.Bot) return false;
    if (this.game.config().gameConfig().gameMode === GameMode.Team)
      return false;
    // Nations under attack may retaliate freely
    if (this.player.incomingAttacks().length > 0) return false;
    const { difficulty } = this.game.config().gameConfig();
    return (
      (difficulty === Difficulty.Hard ||
        difficulty === Difficulty.Impossible) &&
      troops < target.troops() * 0.2
    );
  }

  /**
   * For Hard & Impossible nations in FFA: computes the max troops this nation
   * can send in an attack without letting its troop count drop below a
   * fraction of its strongest non-allied neighbor's troop count (Hard: 75%,
   * Impossible: 90%). Allied players and bot neighbors are not considered
   * threats. Bots and team games are entirely exempt. Returns Infinity when
   * no cap applies.
   *
   * Nations under attack may retaliate with at least the total incoming
   * attack troops, even if that exceeds the neighbor-based cap. `ignore` is
   * left out of the neighbor threat (the player being retaliated against).
   */
  private troopSendCap(ignore?: Player): number {
    let cap = this.neighborTroopCap(ignore);

    // Nations under attack may retaliate with at least the incoming troops
    const incoming = this.player.incomingAttacks();
    if (incoming.length > 0) {
      const totalIncoming = incoming.reduce((sum, a) => sum + a.troops(), 0);
      cap = Math.max(cap, totalIncoming);
    }

    return cap;
  }

  // troopSendCap() without the allowance for nations under attack
  private neighborTroopCap(ignore?: Player): number {
    if (this.player.type() === PlayerType.Bot) return Infinity;
    if (this.game.config().gameConfig().gameMode === GameMode.Team)
      return Infinity;

    const { difficulty } = this.game.config().gameConfig();
    let retainFraction: number;
    switch (difficulty) {
      case Difficulty.Hard:
        retainFraction = 0.75;
        break;
      case Difficulty.Impossible:
        retainFraction = 0.9;
        break;
      default:
        return Infinity;
    }

    let maxNeighborTroops = 0;
    for (const n of this.player.nearby()) {
      if (
        n.isPlayer() &&
        n !== ignore &&
        !this.player.isFriendly(n) &&
        n.type() !== PlayerType.Bot &&
        n.troops() > maxNeighborTroops
      ) {
        maxNeighborTroops = n.troops();
      }
    }

    if (maxNeighborTroops === 0) return Infinity;
    const minRetained = Math.ceil(maxNeighborTroops * retainFraction);
    return Math.max(0, this.player.troops() - minRetained);
  }

  // Like troopSendCap(), but floored above 0 — TerraNullius can't fight back, so it's throttled, not frozen.
  private troopSendCapForExpansion(): number {
    const cap = this.troopSendCap();
    if (cap > 0) return cap;
    return Math.ceil(this.player.troops() * 0.05);
  }

  // `opponent` is a player we take on on purpose (retaliation, runaway leader):
  // it doesn't count toward troopSendCap's threats, and troops already
  // attacking it count toward the too-weak check
  private calculateAttackTroops(
    target: Player | TerraNullius,
    nonBotTroops: (targetTroops: number) => number,
    opponent?: Player,
  ): number | null {
    const maxTroops = this.game.config().maxTroops(this.player);
    const botWithStructures =
      target.isPlayer() &&
      target.type() === PlayerType.Bot &&
      target.units().some((u) => Structures.has(u.type()));
    // Use the expand ratio when attacking a bot that owns structures — we need to
    // recapture those structures ASAP, even before reaching the normal reserve.
    const useReserve = target.isPlayer() && !botWithStructures;
    const reserveRatio = useReserve ? this.reserveRatio : this.expandRatio;
    const targetTroops = maxTroops * reserveRatio;

    let troops;
    const isBotAttack =
      target.isPlayer() &&
      target.type() === PlayerType.Bot &&
      this.player.type() !== PlayerType.Bot;
    if (isBotAttack) {
      troops = this.calculateBotAttackTroops(
        target,
        this.player.troops() - targetTroops - this.botAttackTroopsSent,
      );
    } else {
      troops = nonBotTroops(targetTroops);
    }

    // Hard & Impossible: don't drop below neighbor troop threshold (also applies to TerraNullius/fallout).
    troops = Math.min(
      troops,
      target.isPlayer()
        ? this.troopSendCap(opponent)
        : this.troopSendCapForExpansion(),
    );

    if (troops < 1) {
      return null;
    }

    // Hard & Impossible: don't attack if we'd send less than 20% of target's troops
    const pileOn =
      target.isPlayer() && target === opponent
        ? this.troopsAttacking(target)
        : 0;
    if (target.isPlayer() && this.isAttackTooWeak(troops + pileOn, target)) {
      return null;
    }

    if (target.isPlayer() && this.player.type() === PlayerType.Nation) {
      if (this.emojiBehavior === undefined) throw new Error("not initialized");
      this.emojiBehavior.maybeSendAttackEmoji(target);
    }

    // Only count troops that will actually be sent, post-cap.
    if (isBotAttack) {
      this.botAttackTroopsSent += troops;
    }

    return troops;
  }

  private sendLandAttack(
    target: Player | TerraNullius,
    nonBotTroops = (targetTroops: number) =>
      this.player.troops() - targetTroops,
    opponent?: Player,
  ): boolean {
    const troops = this.calculateAttackTroops(target, nonBotTroops, opponent);
    if (troops === null) {
      return false;
    }

    this.game.addExecution(
      new AttackExecution(
        troops,
        this.player,
        target.isPlayer() ? target.id() : this.game.terraNullius().id(),
      ),
    );
    return true;
  }

  private sendBoatAttack(target: Player): boolean {
    const route = this.boatRoute(target);
    if (route === null || route.blocker !== null) {
      return false;
    }

    const troops = this.calculateAttackTroops(
      target,
      () => this.player.troops() / 5,
    );
    if (troops === null) {
      return false;
    }

    this.game.addExecution(
      new TransportShipExecution(this.player, route.landing, troops),
    );
    return true;
  }

  private bordersByLand(target: Player): boolean {
    return (
      this.landNeighbors?.has(target) ?? this.player.sharesBorderWith(target)
    );
  }

  // By land, or by a boat that passes no hostile warship and isn't sailing too far
  private canReach(target: Player): boolean {
    if (this.bordersByLand(target)) return true;
    const route = this.boatRoute(target);
    return (
      route !== null &&
      route.blocker === null &&
      route.length <= this.maxBoatRoute()
    );
  }

  private boatRoute(target: Player): BoatRoute | null {
    const known = this.boatRoutes?.get(target);
    if (known !== undefined) return known;
    const route = this.planBoatRoute(target);
    this.boatRoutes?.set(target, route);
    return route;
  }

  // The direct crossing, or if a warship blocks it, the shortest safe one landing elsewhere
  private planBoatRoute(target: Player): BoatRoute | null {
    if (
      this.game.config().isUnitDisabled(UnitType.TransportShip) ||
      this.player.unitCount(UnitType.TransportShip) >=
        this.game.config().boatMaxNumber()
    ) {
      return null;
    }
    const ours = this.shoreTiles(this.player);
    const theirs = this.shoreTiles(target);
    const closest = closestTwoTiles(this.game, ours, theirs);
    if (closest === null) return null;
    const warships = this.hostileWarships();
    const direct = this.routeTo(closest.y, warships);
    if (direct !== null && direct.blocker === null) return direct;

    let best: BoatRoute | null = null;
    for (const landing of this.otherLandings(
      ours,
      theirs,
      closest.y,
      warships,
    )) {
      const route = this.routeTo(landing, warships);
      if (
        route !== null &&
        route.blocker === null &&
        (best === null || route.length < best.length)
      ) {
        best = route;
      }
    }
    return best ?? direct;
  }

  // The launch follows from the landing: our shore closest to it by water
  private routeTo(landing: TileRef, warships: Unit[]): BoatRoute | null {
    const launch = canBuildTransportShip(this.game, this.player, landing);
    if (launch === false) return null;
    return { landing, ...this.sail(launch, landing, warships) };
  }

  // Landing spots on their coast apart from `tried` and clear of hostile warships, nearest to
  // our coast first: Medium tries 1, Hard 2, Impossible 4
  private otherLandings(
    ours: TileRef[],
    theirs: TileRef[],
    tried: TileRef,
    warships: Unit[],
  ): TileRef[] {
    const { difficulty } = this.game.config().gameConfig();
    let count: number;
    switch (difficulty) {
      case Difficulty.Easy:
        return [];
      case Difficulty.Medium:
        count = 1;
        break;
      case Difficulty.Hard:
        count = 2;
        break;
      case Difficulty.Impossible:
        count = 4;
        break;
      default:
        assertNever(difficulty);
    }
    const rangeSquared = this.dangerRange() ** 2;
    const ourStep = Math.max(1, Math.floor(ours.length / 32));
    const ourSample = ours.filter((_, i) => i % ourStep === 0);
    const candidates: { tile: TileRef; dist: number }[] = [];
    const theirStep = Math.max(1, Math.floor(theirs.length / 32));
    for (let i = 0; i < theirs.length; i += theirStep) {
      const tile = theirs[i];
      if (
        warships.some(
          (w) => this.game.euclideanDistSquared(w.tile(), tile) <= rangeSquared,
        )
      ) {
        continue;
      }
      let dist = Infinity;
      for (const s of ourSample) {
        dist = Math.min(dist, this.game.manhattanDist(s, tile));
      }
      candidates.push({ tile, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const picked = [tried];
    for (const { tile } of candidates) {
      if (picked.length > count) break;
      if (picked.some((p) => this.game.manhattanDist(p, tile) < 50)) continue;
      picked.push(tile);
    }
    return picked.slice(1);
  }

  private hostileWarships(): Unit[] {
    return this.game
      .units(UnitType.Warship)
      .filter(
        (w) =>
          w.owner() !== this.player &&
          !w.isUnderConstruction() &&
          w.warshipState().state !== "docked" &&
          w.owner().canAttackPlayer(this.player, true),
      );
  }

  // Warship targeting range, plus what it may move while our boat approaches
  private dangerRange(): number {
    return this.game.config().warshipTargettingRange() + 20;
  }

  // Tiles a boat sails from launch to the shore at target, and the hostile warship that sinks it.
  // A warship fires once the boat comes in range; the shell covers 3 tiles a tick (the boat 1),
  // so a boat landing before the shell can catch it is safe.
  // Easy doesn't look, Medium checks both shores, Hard & Impossible pathfind.
  private sail(
    launch: TileRef,
    target: TileRef,
    warships: Unit[] = this.hostileWarships(),
  ): { length: number; blocker: Unit | null } {
    const landing =
      targetTransportTile(this.game, this.player, target) ?? target;
    const direct = this.game.manhattanDist(launch, landing);
    const { difficulty } = this.game.config().gameConfig();
    if (
      this.player.type() === PlayerType.Bot ||
      difficulty === Difficulty.Easy
    ) {
      return { length: direct, blocker: null };
    }

    const path =
      difficulty === Difficulty.Medium || direct <= 20
        ? null
        : PathFinding.Water(this.game).findPath(launch, landing);
    const route = path ?? [launch, landing];
    const length = path?.length ?? direct;
    // Without a path, assume the warship can fire as soon as we launch
    const sailed = (i: number) => (path === null ? 0 : i);

    const range = this.dangerRange();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const t of route) {
      minX = Math.min(minX, this.game.x(t));
      maxX = Math.max(maxX, this.game.x(t));
      minY = Math.min(minY, this.game.y(t));
      maxY = Math.max(maxY, this.game.y(t));
    }
    for (const w of warships) {
      const wx = this.game.x(w.tile());
      const wy = this.game.y(w.tile());
      if (
        wx < minX - range ||
        wx > maxX + range ||
        wy < minY - range ||
        wy > maxY + range
      ) {
        continue;
      }
      for (let i = 0; i < route.length; i++) {
        if (
          this.game.euclideanDistSquared(w.tile(), route[i]) >
          range * range
        ) {
          continue;
        }
        // Shell and boat close in by at most 4 tiles a tick; 10 tiles spare for its reaction
        const ticksLeft = length - sailed(i);
        if (4 * ticksLeft >= this.game.manhattanDist(w.tile(), route[i]) - 10) {
          return { length, blocker: w };
        }
        break;
      }
    }
    return { length, blocker: null };
  }

  // Hard & Impossible don't sail further than this to attack someone
  private maxBoatRoute(): number {
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
      case Difficulty.Medium:
        return Infinity;
      case Difficulty.Hard:
        return 300;
      case Difficulty.Impossible:
        return 500;
      default:
        assertNever(difficulty);
    }
  }

  // Enemies across the water (not bordering us) whose main territory is within boat range
  // of ours; whether a boat really gets there is left to canReach
  private overseasTargets(borderingEnemies: Player[]): Player[] {
    if (
      this.player.unitCount(UnitType.TransportShip) >=
      this.game.config().boatMaxNumber()
    ) {
      return [];
    }
    const range = this.maxBoatRoute();
    const ours = this.player.largestClusterBoundingBox;
    return this.game
      .players()
      .filter(
        (p) =>
          p !== this.player &&
          p.type() !== PlayerType.Bot &&
          !this.player.isFriendly(p) &&
          !borderingEnemies.includes(p) &&
          (!this.isFFA() || p.troops() < this.player.troops()) &&
          boxGap(ours, p.largestClusterBoundingBox) <= range,
      );
  }

  // Hard & Impossible send warships at whatever blocks the juiciest target they couldn't reach
  private clearBlockedLane(routes: Map<Player, BoatRoute | null>): void {
    if (this.warshipBehavior === undefined) return;
    const { difficulty } = this.game.config().gameConfig();
    if (
      difficulty !== Difficulty.Hard &&
      difficulty !== Difficulty.Impossible
    ) {
      return;
    }
    const maxRoute = this.maxBoatRoute();
    const blocked = new Map<Player, Unit>();
    for (const [target, route] of routes) {
      if (
        route?.blocker &&
        route.length <= maxRoute &&
        (!this.isFFA() || target.troops() < this.player.troops())
      ) {
        blocked.set(target, route.blocker);
      }
    }
    const target = findJuiciestTarget(this.game, [...blocked.keys()]);
    if (target !== null) {
      this.warshipBehavior.clearSeaLane(blocked.get(target)!);
    }
  }

  private calculateBotAttackTroops(target: Player, maxTroops: number): number {
    const { difficulty } = this.game.config().gameConfig();
    if (difficulty === Difficulty.Easy) {
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
    return troops;
  }

  private donateTroops(): boolean {
    // Only donate in team games
    if (this.game.config().gameConfig().gameMode !== GameMode.Team) {
      return false;
    }

    // Don't donate in public games (To balance HvN)
    if (this.game.config().gameConfig().gameType === GameType.Public) {
      return false;
    }

    // Check if donating troops is allowed
    if (this.game.config().donateTroops() === false) {
      return false;
    }

    // Don't donate if the game has a winner
    if (this.game.getWinner() !== null) {
      return false;
    }

    // Skip donating based on difficulty
    const { difficulty } = this.game.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        // Easy nations don't donate
        return false;
      case Difficulty.Medium:
        // Medium nations donate 25% of the time
        if (!this.random.chance(4)) {
          return false;
        }
        break;
      case Difficulty.Hard:
        // Hard nations donate 50% of the time
        if (!this.random.chance(2)) {
          return false;
        }
        break;
      case Difficulty.Impossible:
        // Impossible nations always try to donate
        break;
      default:
        assertNever(difficulty);
    }

    // Find teammates who are currently in combat
    const teammates = this.game
      .players()
      .filter((p) => this.player.isOnSameTeam(p))
      .filter(
        (p) => p.incomingAttacks().length > 0 || p.outgoingAttacks().length > 0,
      );

    if (teammates.length === 0) {
      return false;
    }

    // Find teammate with lowest troop percentage (troops / maxTroops)
    const teammatesWithTroopPercentage = teammates
      .map((teammate) => {
        const maxTroops = this.game.config().maxTroops(teammate);
        const troopPercentage = teammate.troops() / Math.max(maxTroops, 1);
        return { teammate, troopPercentage };
      })
      .sort((a, b) => a.troopPercentage - b.troopPercentage);

    // Try to donate to teammates in order of lowest troop percentage
    let selectedTeammate: Player | null = null;
    for (const entry of teammatesWithTroopPercentage) {
      if (this.player.canDonateTroops(entry.teammate)) {
        selectedTeammate = entry.teammate;
        break;
      }
    }

    if (selectedTeammate === null) {
      return false;
    }

    // Donate a portion of our troops (keeping reserve)
    const maxTroops = this.game.config().maxTroops(this.player);
    const troopsToKeep = maxTroops * this.reserveRatio;
    const availableTroops = this.player.troops() - troopsToKeep;

    if (availableTroops < 1) {
      return false;
    }

    this.game.addExecution(
      new DonateTroopsExecution(
        this.player,
        selectedTeammate.id(),
        availableTroops,
      ),
    );

    return true;
  }
}

export const AiAttackBehaviorSnapshot = snapshotType({
  name: "AiAttackBehavior",
  version: 1,
  schema: z.object({
    botAttackTroopsSent: zNum(),
    triggerRatio: zNum(),
    reserveRatio: zNum(),
    expandRatio: zNum(),
  }),
});
