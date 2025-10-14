import {
  Cell,
  Execution,
  Game,
  Gold,
  Nation,
  Player,
  PlayerID,
  PlayerType,
  Relation,
  TerrainType,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef, euclDistFN } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { boundingBoxTiles, calculateBoundingBox, simpleHash } from "../Util";
import { ConstructionExecution } from "./ConstructionExecution";
import { EmojiExecution } from "./EmojiExecution";
import { structureSpawnTileValue } from "./nation/structureSpawnTileValue";
import { NukeExecution } from "./NukeExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { UpgradeStructureExecution } from "./UpgradeStructureExecution";
import { closestTwoTiles } from "./Util";
import { BotBehavior, EMOJI_HECKLE } from "./utils/BotBehavior";

/**
 * Drives AI-controlled nations that imitate human play by making periodic build,
 * upgrade, diplomacy, and attack decisions based on heuristics.
 */
export class FakeHumanExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behavior: BotBehavior | null = null;
  private mg: Game;
  private player: Player | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  private readonly lastEmojiSent = new Map<Player, Tick>();
  private readonly lastNukeSent: [Tick, TileRef][] = [];
  private readonly embargoMalusApplied = new Set<PlayerID>();

  constructor(
    gameID: GameID,
    private nation: Nation,
  ) {
    this.random = new PseudoRandom(
      simpleHash(nation.playerInfo.id) + simpleHash(gameID),
    );
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
  }

  init(mg: Game) {
    this.mg = mg;
    if (this.random.chance(10)) {
      // this.isTraitor = true
    }
  }

  private updateRelationsFromEmbargos() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasEmbargoAgainst(player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasEmbargoAgainst(player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations() {
    const player = this.player;
    if (player === null) return;
    const others = this.mg.players().filter((p) => p.id() !== player.id());

    others.forEach((other: Player) => {
      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        player.relation(other) <= Relation.Hostile &&
        !player.hasEmbargoAgainst(other) &&
        !player.isOnSameTeam(other)
      ) {
        player.addEmbargo(other, false);
      } else if (
        player.relation(other) >= Relation.Neutral &&
        player.hasEmbargoAgainst(other)
      ) {
        player.stopEmbargo(other);
      }
    });
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (this.mg.inSpawnPhase()) {
      const rl = this.randomSpawnLand();
      if (rl === null) {
        console.warn(`cannot spawn ${this.nation.playerInfo.name}`);
        return;
      }
      this.mg.addExecution(new SpawnExecution(this.nation.playerInfo, rl));
      return;
    }

    if (this.player === null) {
      this.player =
        this.mg.players().find((p) => p.id() === this.nation.playerInfo.id) ??
        null;
      if (this.player === null) {
        return;
      }
    }

    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    if (this.behavior === null) {
      // Player is unavailable during init()
      this.behavior = new BotBehavior(
        this.random,
        this.mg,
        this.player,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
      );

      // Send an attack on the first tick
      this.behavior.forceSendAttack(this.mg.terraNullius());
      return;
    }

    this.updateRelationsFromEmbargos();
    this.behavior.handleAllianceRequests();
    this.behavior.handleAllianceExtensionRequests();
    this.handleUnits();
    this.handleEmbargoesToHostileNations();
    this.maybeAttack();
  }

  /**
   * TODO: Implement strategic betrayal logic
   * Currently this just breaks alliances without strategic consideration.
   * Future implementation should consider:
   * - Relative strength (troop count, territory size) compared to target
   * - Risk vs reward of betrayal
   * - Potential impact on relations with other players
   * - Timing (don't betray when already fighting other enemies)
   * - Strategic value of target's territory
   * - If target is distracted
   */
  private maybeConsiderBetrayal(target: Player): boolean {
    if (this.player === null) throw new Error("not initialized");

    const alliance = this.player.allianceWith(target);

    if (!alliance) return false;

    this.player.breakAlliance(alliance);

    return true;
  }

  private maybeAttack() {
    if (this.player === null || this.behavior === null) {
      throw new Error("not initialized");
    }
    const enemyborder = Array.from(this.player.borderTiles())
      .flatMap((t) => this.mg.neighbors(t))
      .filter(
        (t) =>
          this.mg.isLand(t) && this.mg.ownerID(t) !== this.player?.smallID(),
      );

    if (enemyborder.length === 0) {
      if (this.random.chance(10)) {
        this.sendBoatRandomly();
      }
      return;
    }
    if (this.random.chance(20)) {
      this.sendBoatRandomly();
      return;
    }

    const borderPlayers = enemyborder.map((t) =>
      this.mg.playerBySmallID(this.mg.ownerID(t)),
    );
    if (borderPlayers.some((o) => !o.isPlayer())) {
      this.behavior.sendAttack(this.mg.terraNullius());
      return;
    }

    const enemies = borderPlayers
      .filter((o) => o.isPlayer())
      .sort((a, b) => a.troops() - b.troops());

    // 5% chance to send a random alliance request
    if (this.random.chance(20)) {
      const toAlly = this.random.randElement(enemies);
      if (this.player.canSendAllianceRequest(toAlly)) {
        this.player.createAllianceRequest(toAlly);
      }
    }

    this.behavior.forgetOldEnemies();
    this.behavior.assistAllies();
    const enemy = this.behavior.selectEnemy(enemies);
    if (!enemy) return;
    this.maybeSendEmoji(enemy);
    this.maybeSendNuke(enemy);
    if (this.player.sharesBorderWith(enemy)) {
      this.behavior.sendAttack(enemy);
    } else {
      this.maybeSendBoatAttack(enemy);
    }
  }

  private maybeSendEmoji(enemy: Player) {
    if (this.player === null) throw new Error("not initialized");
    if (enemy.type() !== PlayerType.Human) return;
    const lastSent = this.lastEmojiSent.get(enemy) ?? -300;
    if (this.mg.ticks() - lastSent <= 300) return;
    this.lastEmojiSent.set(enemy, this.mg.ticks());
    this.mg.addExecution(
      new EmojiExecution(
        this.player,
        enemy.id(),
        this.random.randElement(EMOJI_HECKLE),
      ),
    );
  }

  private maybeSendNuke(other: Player) {
    if (this.player === null) throw new Error("not initialized");
    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length === 0 ||
      this.player.gold() < this.cost(UnitType.AtomBomb) ||
      other.type() === PlayerType.Bot ||
      this.player.isOnSameTeam(other)
    ) {
      return;
    }

    const nukeType =
      this.player.gold() > this.cost(UnitType.HydrogenBomb)
        ? UnitType.HydrogenBomb
        : UnitType.AtomBomb;
    const range = nukeType === UnitType.HydrogenBomb ? 60 : 15;

    const structures = other.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
    );
    const structureTiles = structures.map((u) => u.tile());
    const randomTiles = this.randTerritoryTileArray(10);
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile: TileRef | null = null;
    let bestValue = 0;
    this.removeOldNukeEvents();
    outer: for (const tile of new Set(allTiles)) {
      if (tile === null) continue;
      const boundingBox = boundingBoxTiles(this.mg, tile, range)
        // Add radius / 2 in case there is a piece of unwanted territory inside the outer radius that we miss.
        .concat(boundingBoxTiles(this.mg, tile, Math.floor(range / 2)));
      for (const t of boundingBox) {
        // Make sure we nuke away from the border
        if (this.mg.owner(t) !== other) {
          continue outer;
        }
      }
      if (!this.player.canBuild(nukeType, tile)) continue;
      const value = this.nukeTileScore(tile, silos, structures);
      if (value > bestValue) {
        bestTile = tile;
        bestValue = value;
      }
    }
    if (bestTile !== null) {
      this.sendNuke(bestTile, nukeType);
    }
  }

  private removeOldNukeEvents() {
    const maxAge = 500;
    const tick = this.mg.ticks();
    while (
      this.lastNukeSent.length > 0 &&
      this.lastNukeSent[0][0] + maxAge < tick
    ) {
      this.lastNukeSent.shift();
    }
  }

  private sendNuke(
    tile: TileRef,
    nukeType: UnitType.AtomBomb | UnitType.HydrogenBomb,
  ) {
    if (this.player === null) throw new Error("not initialized");
    const tick = this.mg.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.mg.addExecution(new NukeExecution(nukeType, this.player, tile));
  }

  private nukeTileScore(tile: TileRef, silos: Unit[], targets: Unit[]): number {
    // Potential damage in a 25-tile radius
    const dist = euclDistFN(tile, 25, false);
    let tileValue = targets
      .filter((unit) => dist(this.mg, unit.tile()))
      .map((unit): number => {
        switch (unit.type()) {
          case UnitType.City:
            return 25_000;
          case UnitType.DefensePost:
            return 5_000;
          case UnitType.MissileSilo:
            return 50_000;
          case UnitType.Port:
            return 10_000;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    // Avoid areas defended by SAM launchers
    const dist50 = euclDistFN(tile, 50, false);
    tileValue -=
      50_000 *
      targets.filter(
        (unit) =>
          unit.type() === UnitType.SAMLauncher && dist50(this.mg, unit.tile()),
      ).length;

    // Prefer tiles that are closer to a silo
    const siloTiles = silos.map((u) => u.tile());
    const result = closestTwoTiles(this.mg, siloTiles, [tile]);
    if (result === null) throw new Error("Missing result");
    const { x: closestSilo } = result;
    const distanceSquared = this.mg.euclideanDistSquared(tile, closestSilo);
    const distanceToClosestSilo = Math.sqrt(distanceSquared);
    tileValue -= distanceToClosestSilo * 30;

    // Don't target near recent targets
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.mg, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private maybeSendBoatAttack(other: Player) {
    if (this.player === null) throw new Error("not initialized");
    if (this.player.isFriendly(other)) return;
    const closest = closestTwoTiles(
      this.mg,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.mg.isOceanShore(t),
      ),
      Array.from(other.borderTiles()).filter((t) => this.mg.isOceanShore(t)),
    );
    if (closest === null) {
      return;
    }
    this.mg.addExecution(
      new TransportShipExecution(
        this.player,
        other.id(),
        closest.y,
        this.player.troops() / 5,
        null,
      ),
    );
  }

  /**
   * Executes economic actions (builds/upgrades) until the maximum number of
   * allowable actions for this tick is reached.
   */
  private handleUnits(): boolean {
    if (this.player === null) throw new Error("not initialized");

    const prioritizedTypes = this.determineNeedDrivenOrder();
    const baselineTypes = [
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.DefensePost,
      UnitType.SAMLauncher,
      UnitType.MissileSilo,
    ];
    const fallbackTypes = baselineTypes.filter(
      (type) => !prioritizedTypes.includes(type),
    );

    const prioritizedActions = this.buildActionsForTypes(prioritizedTypes);
    const fallbackActions = this.buildActionsForTypes(
      this.random.shuffleArray(fallbackTypes),
    );

    let actions = prioritizedActions.concat(fallbackActions);

    const navalUrgency = this.navalUrgency();
    if (navalUrgency > 0) {
      const forced = () => this.maybeSpawnWarship(true);
      actions = [forced, ...actions];
      if (navalUrgency > 1) {
        actions.splice(1, 0, () => this.maybeSpawnWarship(true));
      }
    } else if (actions.length > 0) {
      const idx = this.random.nextInt(0, actions.length + 1);
      actions.splice(idx, 0, () => this.maybeSpawnWarship());
    }

    const maxActions = this.maxEconomicActions();
    if (maxActions <= 0) {
      return false;
    }

    let performed = 0;
    do {
      let executedThisPass = false;
      for (const action of actions) {
        if (performed >= maxActions) {
          break;
        }
        if (action()) {
          performed++;
          executedThisPass = true;
        }
      }
      if (!executedThisPass) {
        break;
      }
    } while (performed < maxActions);

    return performed > 0;
  }

  /** Determines how many economic actions can run this tick. */
  private maxEconomicActions(): number {
    if (this.player === null) throw new Error("not initialized");
    const gold = this.player.gold();
    const baselineCosts = [
      UnitType.City,
      UnitType.Port,
      UnitType.Factory,
      UnitType.DefensePost,
    ]
      .map((type) => this.cost(type))
      .filter((cost) => cost > 0n)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    const baseline = baselineCosts[0] ?? 0n;
    if (baseline === 0n) {
      return 3;
    }

    const potential = gold / baseline;
    if (potential >= 3n) {
      return 3;
    }
    if (potential >= 2n) {
      return 2;
    }
    return 1;
  }

  /** Returns structure types ordered by current urgency scores. */
  private determineNeedDrivenOrder(): UnitType[] {
    if (this.player === null) throw new Error("not initialized");
    const priorities: Array<{ type: UnitType; score: number }> = [
      { type: UnitType.DefensePost, score: this.defenseUrgency() },
      { type: UnitType.SAMLauncher, score: this.advancedDefenseUrgency() },
      { type: UnitType.City, score: this.populationUrgency() },
      { type: UnitType.Port, score: this.economyUrgency() },
      { type: UnitType.Factory, score: this.productionUrgency() },
      { type: UnitType.MissileSilo, score: this.missileUrgency() },
    ];

    priorities.sort((a, b) => {
      if (b.score === a.score) {
        return this.random.chance(50) ? 1 : -1;
      }
      return b.score - a.score;
    });

    return priorities.filter((p) => p.score > 0).map((p) => p.type);
  }

  /**
   * Builds a list of closures that either upgrade an existing structure or
   * construct a new one for the given unit types.
   */
  private buildActionsForTypes(types: UnitType[]): Array<() => boolean> {
    const actions: Array<() => boolean> = [];
    for (const type of types) {
      const upgradeFirst = this.random.chance(50);
      const upgradeAction = () => this.maybeUpgradeStructure(type);
      const buildAction = () =>
        this.maybeSpawnStructure(type, this.structureMultiplier(type));
      if (upgradeFirst) {
        actions.push(upgradeAction, buildAction);
      } else {
        actions.push(buildAction, upgradeAction);
      }
    }
    return actions;
  }

  /** Provides the perceived cost multiplier for subsequent builds of a type. */
  private structureMultiplier(type: UnitType): (num: number) => number {
    switch (type) {
      case UnitType.City:
      case UnitType.Port:
      case UnitType.Factory:
        return (num) => num;
      case UnitType.DefensePost:
        // Steepen the perceived cost curve (9x, 16x, 25x, …) so nations do not
        // spam towers early; encourages saving Defense Posts for emergencies.
        return (num) => (num + 2) ** 2;
      case UnitType.SAMLauncher:
      case UnitType.MissileSilo:
        return (num) => num ** 2;
      default:
        return (num) => num;
    }
  }

  /** Scores immediate ground defense pressure. */
  private defenseUrgency(): number {
    if (this.player === null) throw new Error("not initialized");
    const incoming = this.player.incomingAttacks().length;
    if (incoming >= 3) return 3;
    if (incoming > 0) return 2;

    const hostiles = this.hostileBorderPlayers();
    if (hostiles.length === 0) {
      return 0;
    }

    const myTroops = this.player.troops();
    const overwhelming = hostiles.some((enemy) => enemy.troops() > myTroops);
    if (overwhelming) {
      return 3;
    }
    const strongPressure = hostiles.some(
      (enemy) => enemy.troops() > myTroops * 0.7,
    );
    if (strongPressure) {
      return 2;
    }
    return 1;
  }

  /** Scores air-defense pressure for SAM launchers. */
  private advancedDefenseUrgency(): number {
    if (this.player === null) throw new Error("not initialized");
    const base = this.defenseUrgency();
    if (base < 2) {
      return 0;
    }
    const hostiles = this.hostileBorderPlayers();
    const enemyAirThreat = hostiles.some(
      (enemy) =>
        enemy.units(UnitType.Warship).length > 0 ||
        enemy.units(UnitType.MissileSilo).length > 0,
    );
    const sams = this.player.units(UnitType.SAMLauncher).length;
    const desiredSamCount = Math.max(1, Math.floor(hostiles.length / 2));

    let urgency = base - 1;
    if (enemyAirThreat) {
      urgency = Math.max(urgency, 2);
    }
    if (sams < desiredSamCount) {
      urgency = Math.max(urgency, 2);
    }
    return Math.min(3, urgency);
  }

  /** Scores the need to expand manpower via cities. */
  private populationUrgency(): number {
    if (this.player === null) throw new Error("not initialized");
    const maxTroops = this.mg.config().maxTroops(this.player);
    const troopRatio = maxTroops === 0 ? 0 : this.player.troops() / maxTroops;
    const citiesOwned = this.player.unitsOwned(UnitType.City);
    const desiredCities = Math.max(
      1,
      Math.floor(this.player.numTilesOwned() / 60),
    );

    let urgency = 0;
    if (troopRatio > 0.9) {
      urgency = 3;
    } else if (troopRatio > 0.75) {
      urgency = 2;
    } else if (troopRatio > 0.6) {
      urgency = 1;
    }

    if (citiesOwned < desiredCities) {
      urgency = Math.max(urgency, desiredCities - citiesOwned >= 2 ? 2 : 1);
    }

    return urgency;
  }

  /** Scores the need for ports to improve income and logistics. */
  private economyUrgency(): number {
    if (this.player === null) throw new Error("not initialized");
    const portsOwned = this.player.unitsOwned(UnitType.Port);
    const desiredPorts = Math.max(
      1,
      Math.floor(this.player.numTilesOwned() / 35),
    );

    if (portsOwned < desiredPorts) {
      if (portsOwned === 0) {
        return 3;
      }
      return desiredPorts - portsOwned >= 2 ? 2 : 1;
    }

    if (
      this.player.gold() > this.cost(UnitType.Port) * 5n &&
      portsOwned < this.player.unitsOwned(UnitType.City)
    ) {
      return 1;
    }

    return 0;
  }

  /** Scores production (factory) urgency relative to ports. */
  private productionUrgency(): number {
    if (this.player === null) throw new Error("not initialized");
    const factories = this.player.unitsOwned(UnitType.Factory);
    const ports = this.player.unitsOwned(UnitType.Port);
    if (ports === 0) {
      return 0;
    }
    if (factories === 0) {
      return 2;
    }
    if (factories < Math.floor(ports / 2)) {
      return 1;
    }
    return 0;
  }

  /** Scores missile silo urgency based on enemy capabilities. */
  private missileUrgency(): number {
    if (this.player === null) throw new Error("not initialized");
    const silos = this.player.unitsOwned(UnitType.MissileSilo);
    const hostiles = this.hostileBorderPlayers();
    const enemySilos = hostiles.reduce(
      (total, enemy) => total + enemy.units(UnitType.MissileSilo).length,
      0,
    );

    if (enemySilos > silos) {
      return 3;
    }

    if (silos === 0 && this.defenseUrgency() >= 2) {
      return 2;
    }

    return 0;
  }

  /** Scores naval urgency relative to enemy fleets and owned ports. */
  private navalUrgency(): number {
    if (this.player === null) throw new Error("not initialized");
    const ports = this.player.units(UnitType.Port).length;
    if (ports === 0) {
      return 0;
    }
    const warships = this.player.units(UnitType.Warship).length;
    if (warships === 0) {
      return 2;
    }
    const hostileWarships = this.hostileBorderPlayers().reduce(
      (total, enemy) => total + enemy.units(UnitType.Warship).length,
      0,
    );
    if (hostileWarships > warships) {
      return 2;
    }
    if (warships < Math.ceil(ports / 2)) {
      return 1;
    }
    return 0;
  }

  /** Returns hostile neighbors sharing a border with this nation. */
  private hostileBorderPlayers(): Player[] {
    if (this.player === null) throw new Error("not initialized");
    const hostiles = new Map<PlayerID, Player>();

    for (const tile of this.player.borderTiles()) {
      for (const neighbor of this.mg.neighbors(tile)) {
        const owner = this.mg.playerBySmallID(this.mg.ownerID(neighbor));
        if (!owner.isPlayer()) continue;
        if (owner === this.player) continue;
        if (
          this.player.isOnSameTeam(owner) ||
          this.player.isAlliedWith(owner)
        ) {
          continue;
        }
        const relation = this.player.relation(owner);
        if (relation >= Relation.Friendly) {
          continue;
        }
        hostiles.set(owner.id(), owner);
      }
    }

    return Array.from(hostiles.values());
  }

  /**
   * Attempts to schedule an upgrade for the best candidate structure of the
   * requested type.
   */
  private maybeUpgradeStructure(type: UnitType): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (!this.mg.unitInfo(type).upgradable) {
      return false;
    }
    if (!this.player.canUpgradeUnit(type)) {
      return false;
    }

    const borderTiles = this.player.borderTiles();
    const candidates = this.player.units(type).sort((a, b) => {
      const aBorder = borderTiles.has(a.tile());
      const bBorder = borderTiles.has(b.tile());
      if (aBorder !== bBorder) {
        return aBorder ? -1 : 1;
      }
      if (a.level() !== b.level()) {
        return a.level() - b.level();
      }
      return a.id() - b.id();
    });

    for (const unit of candidates) {
      if (!this.player.canUpgradeUnit(type)) {
        break;
      }
      this.mg.addExecution(
        new UpgradeStructureExecution(this.player, unit.id()),
      );
      return true;
    }
    return false;
  }

  /**
   * Queues a structure build when the nation can afford it and a valid tile can
   * be found.
   */
  private maybeSpawnStructure(
    type: UnitType,
    multiplier: (num: number) => number,
  ) {
    if (this.player === null) throw new Error("not initialized");
    const owned = this.player.unitsOwned(type);
    const perceivedCostMultiplier = multiplier(owned + 1);
    const realCost = this.cost(type);
    const perceivedCost = realCost * BigInt(perceivedCostMultiplier);
    if (this.player.gold() < perceivedCost) {
      return false;
    }
    const tile = this.structureSpawnTile(type);
    if (tile === null) {
      return false;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild === false) {
      return false;
    }
    this.mg.addExecution(new ConstructionExecution(this.player, type, tile));
    return true;
  }

  /** Samples candidate tiles and returns the highest scoring placement. */
  private structureSpawnTile(type: UnitType): TileRef | null {
    if (this.mg === undefined) throw new Error("Not initialized");
    if (this.player === null) throw new Error("Not initialized");
    const tiles =
      type === UnitType.Port
        ? this.randCoastalTileArray(25)
        : this.randTerritoryTileArray(25);
    if (tiles.length === 0) return null;
    const valueFunction = structureSpawnTileValue(this.mg, this.player, type);
    let bestTile: TileRef | null = null;
    let bestValue = 0;
    for (const t of tiles) {
      const v = valueFunction(t);
      if (v <= bestValue && bestTile !== null) continue;
      if (!this.player.canBuild(type, t)) continue;
      // Found a better tile
      bestTile = t;
      bestValue = v;
    }
    return bestTile;
  }

  private randCoastalTileArray(numTiles: number): TileRef[] {
    const tiles = Array.from(this.player!.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    return Array.from(this.arraySampler(tiles, numTiles));
  }

  private *arraySampler<T>(a: T[], sampleSize: number): Generator<T> {
    if (a.length <= sampleSize) {
      // Return all elements
      yield* a;
    } else {
      // Sample `sampleSize` elements
      const remaining = new Set<T>(a);
      while (sampleSize--) {
        const t = this.random.randFromSet(remaining);
        remaining.delete(t);
        yield t;
      }
    }
  }

  /**
   * Attempts to spawn a warship from a random port. The `force` flag bypasses
   * the usual random chance gate.
   */
  private maybeSpawnWarship(force = false): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (!force && !this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.player.gold() > this.cost(UnitType.Warship)
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile());
      if (targetTile === null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild === false) {
        console.warn("cannot spawn destroyer");
        return false;
      }
      this.mg.addExecution(
        new ConstructionExecution(this.player, UnitType.Warship, targetTile),
      );
      return true;
    }
    return false;
  }

  private randTerritoryTileArray(numTiles: number): TileRef[] {
    const boundingBox = calculateBoundingBox(
      this.mg,
      this.player!.borderTiles(),
    );
    const tiles: TileRef[] = [];
    for (let i = 0; i < numTiles; i++) {
      const tile = this.randTerritoryTile(this.player!, boundingBox);
      if (tile !== null) {
        tiles.push(tile);
      }
    }
    return tiles;
  }

  private randTerritoryTile(
    p: Player,
    boundingBox: { min: Cell; max: Cell } | null = null,
  ): TileRef | null {
    boundingBox ??= calculateBoundingBox(this.mg, p.borderTiles());
    for (let i = 0; i < 100; i++) {
      const randX = this.random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = this.random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!this.mg.isOnMap(new Cell(randX, randY))) {
        // Sanity check should never happen
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (this.mg.owner(randTile) === p) {
        return randTile;
      }
    }
    return null;
  }

  private warshipSpawnTile(portTile: TileRef): TileRef | null {
    const radius = 250;
    for (let attempts = 0; attempts < 50; attempts++) {
      const randX = this.random.nextInt(
        this.mg.x(portTile) - radius,
        this.mg.x(portTile) + radius,
      );
      const randY = this.random.nextInt(
        this.mg.y(portTile) - radius,
        this.mg.y(portTile) + radius,
      );
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const tile = this.mg.ref(randX, randY);
      // Sanity check
      if (!this.mg.isOcean(tile)) {
        continue;
      }
      return tile;
    }
    return null;
  }

  private cost(type: UnitType): Gold {
    if (this.player === null) throw new Error("not initialized");
    return this.mg.unitInfo(type).cost(this.player);
  }

  sendBoatRandomly() {
    if (this.player === null) throw new Error("not initialized");
    const oceanShore = Array.from(this.player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    if (oceanShore.length === 0) {
      return;
    }

    const src = this.random.randElement(oceanShore);

    const dst = this.randomBoatTarget(src, 150);
    if (dst === null) {
      return;
    }

    this.mg.addExecution(
      new TransportShipExecution(
        this.player,
        this.mg.owner(dst).id(),
        dst,
        this.player.troops() / 5,
        null,
      ),
    );
    return;
  }

  randomSpawnLand(): TileRef | null {
    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.nation.spawnCell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) === TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  private randomBoatTarget(tile: TileRef, dist: number): TileRef | null {
    if (this.player === null) throw new Error("not initialized");
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - dist, x + dist);
      const randY = this.random.nextInt(y - dist, y + dist);
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (!this.mg.isLand(randTile)) {
        continue;
      }
      const owner = this.mg.owner(randTile);
      if (!owner.isPlayer()) {
        return randTile;
      }
      if (!owner.isFriendly(this.player)) {
        return randTile;
      }
    }
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
