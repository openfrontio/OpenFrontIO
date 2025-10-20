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
import { MirvExecution } from "./MIRVExecution";
import { structureSpawnTileValue } from "./nation/structureSpawnTileValue";
import { NukeExecution } from "./NukeExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { closestTwoTiles } from "./Util";
import { BotBehavior, EMOJI_HECKLE } from "./utils/BotBehavior";

export class FakeHumanExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private behavior: BotBehavior | null = null; // Shared behavior logic for both bots and fakehumans
  private mg: Game;
  private player: Player | null = null;

  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;

  private readonly lastEmojiSent = new Map<Player, Tick>();
  private readonly lastNukeSent: [Tick, TileRef][] = [];
  private readonly lastMIRVSent: [Tick, TileRef][] = [];
  private readonly embargoMalusApplied = new Set<PlayerID>();

  /** MIRV Strategy Constants */

  /** Ticks until MIRV can be attempted again */
  private static readonly MIRV_COOLDOWN_TICKS = 600;

  /** Odds of aborting a MIRV attempt */
  private static readonly MIRV_HESITATION_ODDS = 7;

  /** Threshold for team victory denial */
  private static readonly VICTORY_DENIAL_TEAM_THRESHOLD = 0.8;

  /** Threshold for individual victory denial */
  private static readonly VICTORY_DENIAL_INDIVIDUAL_THRESHOLD = 0.65;

  /** Multiplier for steamroll city gap threshold */
  private static readonly STEAMROLL_CITY_GAP_MULTIPLIER = 1.8;

  /** MIRV Saving Strategy Constants */

  /** Minimum gold to maintain for MIRV deterrence */
  private static readonly MIRV_RESERVE_MIN = 35_000_000n;

  /** Target gold reserve for MIRV deterrence */
  private static readonly MIRV_RESERVE_TARGET = 40_000_000n;

  /** Game progression factor - how much more urgent MIRV saving becomes over time */
  private static readonly MIRV_SAVING_URGENCY_MULTIPLIER = 0.5;

  constructor(
    gameID: GameID,
    private nation: Nation, // Nation contains PlayerInfo with PlayerType.FakeHuman
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
    this.considerMIRV();
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
      other.type() === PlayerType.Bot || // Don't nuke bots (as opposed to fakehumans and humans)
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

  private handleUnits() {
    const buildOrder = this.getBuildOrder();

    for (const { type, multiplier } of buildOrder) {
      if (type === UnitType.Warship) {
        if (this.maybeSpawnWarship()) return true;
      } else {
        if (this.maybeSpawnStructure(type, multiplier)) return true;
      }
    }

    return false;
  }

  /**
   * Returns the build order based on current game state and strategic priorities
   */
  private getBuildOrder(): Array<{
    type: UnitType;
    multiplier: (num: number) => number;
  }> {
    const baseOrder = [
      { type: UnitType.City, multiplier: (num: number) => num },
      { type: UnitType.Port, multiplier: (num: number) => num },
      { type: UnitType.Warship, multiplier: () => 0 }, // Special case handled separately
      { type: UnitType.Factory, multiplier: (num: number) => num },
      {
        type: UnitType.DefensePost,
        multiplier: (num: number) => (num + 2) ** 2,
      },
      { type: UnitType.SAMLauncher, multiplier: (num: number) => num ** 2 },
      { type: UnitType.MissileSilo, multiplier: (num: number) => num ** 2 },
    ];

    // Prioritize missile silos in mid to late game
    if (this.shouldPrioritizeMissileSilos()) {
      return [
        {
          type: UnitType.MissileSilo,
          multiplier: (num: number) => Math.max(1, num),
        },
        ...baseOrder.filter(
          (item) =>
            item.type !== UnitType.MissileSilo &&
            item.type !== UnitType.Warship,
        ),
      ];
    }

    return baseOrder;
  }

  private maybeSpawnStructure(
    type: UnitType,
    multiplier: (num: number) => number,
  ) {
    if (this.player === null) throw new Error("not initialized");
    const owned = this.player.unitsOwned(type);
    const perceivedCostMultiplier = multiplier(owned + 1);
    const realCost = this.cost(type);
    const perceivedCost = realCost * BigInt(perceivedCostMultiplier);

    // Use MIRV reserve-aware spending logic
    if (!this.canAffordWithReserve(perceivedCost)) {
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

  private maybeSpawnWarship(): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (!this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    const warshipCost = this.cost(UnitType.Warship);

    if (
      ports.length > 0 &&
      ships.length === 0 &&
      this.canAffordWithReserve(warshipCost)
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

  // MIRV Strategy Methods
  private considerMIRV(): boolean {
    if (this.player === null) throw new Error("not initialized");
    if (this.player.units(UnitType.MissileSilo).length === 0) return false;
    if (this.player.gold() < this.cost(UnitType.MIRV)) return false;

    this.removeOldMIRVEvents();
    if (this.lastMIRVSent.length > 0) return false;

    if (this.random.chance(FakeHumanExecution.MIRV_HESITATION_ODDS)) {
      this.triggerMIRVCooldown();
      return false;
    }

    const inboundMIRVSender = this.selectCounterMirvTarget();
    if (inboundMIRVSender) {
      this.maybeSendMIRV(inboundMIRVSender);
      return true;
    }

    const victoryDenialTarget = this.selectVictoryDenialTarget();
    if (victoryDenialTarget) {
      this.maybeSendMIRV(victoryDenialTarget);
      return true;
    }

    const steamrollStopTarget = this.selectSteamrollStopTarget();
    if (steamrollStopTarget) {
      this.maybeSendMIRV(steamrollStopTarget);
      return true;
    }

    return false;
  }

  private selectCounterMirvTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const attackers = this.getValidMirvTargetPlayers().filter((p) =>
      this.isInboundMIRVFrom(p),
    );
    if (attackers.length === 0) return null;
    attackers.sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    return attackers[0];
  }

  private selectVictoryDenialTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const totalLand = this.mg.numLandTiles();
    if (totalLand === 0) return null;
    let best: { p: Player; severity: number } | null = null;
    for (const p of this.getValidMirvTargetPlayers()) {
      let severity = 0;
      const team = p.team();
      if (team !== null) {
        const teamMembers = this.mg
          .players()
          .filter((x) => x.team() === team && x.isPlayer());
        const teamTerritory = teamMembers
          .map((x) => x.numTilesOwned())
          .reduce((a, b) => a + b, 0);
        const teamShare = teamTerritory / totalLand;
        if (teamShare >= FakeHumanExecution.VICTORY_DENIAL_TEAM_THRESHOLD) {
          // Only consider the largest team member as the target when team exceeds threshold
          let largestMember: Player | null = null;
          let largestTiles = -1;
          for (const member of teamMembers) {
            const tiles = member.numTilesOwned();
            if (tiles > largestTiles) {
              largestTiles = tiles;
              largestMember = member;
            }
          }
          if (largestMember === p) {
            severity = teamShare;
          } else {
            severity = 0; // Skip non-largest members
          }
        }
      } else {
        const share = p.numTilesOwned() / totalLand;
        if (share >= FakeHumanExecution.VICTORY_DENIAL_INDIVIDUAL_THRESHOLD)
          severity = share;
      }
      if (severity > 0) {
        if (best === null || severity > best.severity) best = { p, severity };
      }
    }
    return best ? best.p : null;
  }

  private selectSteamrollStopTarget(): Player | null {
    if (this.player === null) throw new Error("not initialized");
    const validTargets = this.getValidMirvTargetPlayers()
      .map((p) => ({ p, cityCount: this.countCities(p) }))
      .sort((a, b) => b.cityCount - a.cityCount);

    if (validTargets.length === 0) return null;

    const topTarget = validTargets[0];
    const allPlayers = this.mg
      .players()
      .filter((p) => p.isPlayer())
      .map((p) => ({ p, cityCount: this.countCities(p) }))
      .sort((a, b) => b.cityCount - a.cityCount);

    if (allPlayers.length < 2) return null;

    let secondHighest = 0;
    for (const { p, cityCount } of allPlayers) {
      if (p !== topTarget.p) {
        secondHighest = cityCount;
        break;
      }
    }

    const threshold =
      secondHighest * FakeHumanExecution.STEAMROLL_CITY_GAP_MULTIPLIER;

    if (topTarget.cityCount >= threshold) {
      return topTarget.p;
    }

    return null;
  }

  // MIRV Helper Methods
  private mirvTargetsCache: {
    tick: number;
    players: Player[];
  } | null = null;

  private getValidMirvTargetPlayers(): Player[] {
    const MIRV_TARGETS_CACHE_TICKS = 2 * 10; // 2 seconds
    if (this.player === null) throw new Error("not initialized");

    if (
      this.mirvTargetsCache &&
      this.mg.ticks() - this.mirvTargetsCache.tick < MIRV_TARGETS_CACHE_TICKS
    ) {
      return this.mirvTargetsCache.players;
    }

    const players = this.mg.players().filter((p) => {
      return (
        p !== this.player &&
        p.isPlayer() &&
        p.type() !== PlayerType.Bot &&
        !this.player!.isOnSameTeam(p)
      );
    });

    this.mirvTargetsCache = { tick: this.mg.ticks(), players };
    return players;
  }

  private isInboundMIRVFrom(attacker: Player): boolean {
    if (this.player === null) throw new Error("not initialized");
    const enemyMirvs = attacker.units(UnitType.MIRV);
    for (const mirv of enemyMirvs) {
      const dst = mirv.targetTile();
      if (!dst) continue;
      if (!this.mg.hasOwner(dst)) continue;
      const owner = this.mg.owner(dst);
      if (owner === this.player) return true;
    }
    return false;
  }

  private countCities(p: Player): number {
    return p.unitCount(UnitType.City);
  }

  private calculateTerritoryCenter(target: Player): TileRef | null {
    const tiles = Array.from(target.tiles());
    if (tiles.length === 0) return null;

    let sumX = 0;
    let sumY = 0;
    for (const tile of tiles) {
      sumX += this.mg.x(tile);
      sumY += this.mg.y(tile);
    }
    const centerX = sumX / tiles.length;
    const centerY = sumY / tiles.length;

    // Find closest in single pass
    let closestTile: TileRef | null = null;
    let closestDistanceSquared = Infinity;

    for (const tile of tiles) {
      // Use squared distance to avoid sqrt
      const dx = this.mg.x(tile) - centerX;
      const dy = this.mg.y(tile) - centerY;
      const distSquared = dx * dx + dy * dy;

      if (distSquared < closestDistanceSquared) {
        closestDistanceSquared = distSquared;
        closestTile = tile;
      }
    }

    return closestTile;
  }

  // MIRV Execution Methods
  private maybeSendMIRV(enemy: Player): void {
    if (this.player === null) throw new Error("not initialized");

    this.maybeSendEmoji(enemy);

    const enemyTiles = Array.from(enemy.tiles());
    if (enemyTiles.length === 0) return;

    const centerTile = this.calculateTerritoryCenter(enemy);
    if (centerTile && this.player.canBuild(UnitType.MIRV, centerTile)) {
      this.sendMIRV(centerTile);
      return;
    }
    for (const tile of enemyTiles) {
      if (this.player.canBuild(UnitType.MIRV, tile)) {
        this.sendMIRV(tile);
        return;
      }
    }
  }

  private sendMIRV(tile: TileRef): void {
    if (this.player === null) throw new Error("not initialized");
    this.triggerMIRVCooldown(tile);
    this.mg.addExecution(new MirvExecution(this.player, tile));
  }

  private triggerMIRVCooldown(tile?: TileRef): void {
    if (this.player === null) throw new Error("not initialized");
    this.removeOldMIRVEvents();
    const tick = this.mg.ticks();
    // Use provided tile or any tile from player's territory for cooldown tracking
    const cooldownTile =
      tile ?? Array.from(this.player.tiles())[0] ?? this.mg.ref(0, 0);
    this.lastMIRVSent.push([tick, cooldownTile]);
  }

  private removeOldMIRVEvents() {
    const maxAge = FakeHumanExecution.MIRV_COOLDOWN_TICKS;
    const tick = this.mg.ticks();
    while (
      this.lastMIRVSent.length > 0 &&
      this.lastMIRVSent[0][0] + maxAge <= tick
    ) {
      this.lastMIRVSent.shift();
    }
  }

  // MIRV Reserve Management Methods

  /**
   * Checks if the bot should maintain MIRV reserve (has missile silo)
   */
  private shouldMaintainMIRVReserve(): boolean {
    if (this.player === null) return false;
    return this.player.units(UnitType.MissileSilo).length > 0;
  }

  /**
   * Determines if the bot should prioritize building missile silos
   * Based on game stage, economic position, and current silo count
   */
  private shouldPrioritizeMissileSilos(): boolean {
    if (this.player === null) return false;

    const currentSilos = this.player.units(UnitType.MissileSilo).length;
    const gameTime = this.mg.ticks();
    const territorySize = this.player.numTilesOwned();

    // Always prioritize if we have 0 silos and it's past early game
    if (currentSilos === 0 && gameTime > 60 * 5) {
      // 5 minutes
      return true;
    }

    // Prioritize if we have less than 2 silos and it's mid/late game
    if (currentSilos < 2 && gameTime > 60 * 10) {
      // 10 minutes
      return true;
    }

    // Prioritize if we have good economy but few silos
    const gold = Number(this.player.gold());
    if (currentSilos < 2 && gold > 10_000_000 && territorySize > 50) {
      return true;
    }

    // Prioritize if others are close to MIRV capability and we have few silos
    const otherPlayers = this.mg
      .players()
      .filter((p) => p !== this.player && p.isPlayer() && p.isAlive());
    if (otherPlayers.length > 0) {
      const maxOtherGold = Math.max(
        ...otherPlayers.map((p) => Number(p.gold())),
      );
      if (maxOtherGold > 20_000_000 && currentSilos < 2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Calculates the current MIRV reserve threshold based on other players' economic position
   * Returns higher threshold when other players are close to MIRV capability
   */
  private getMIRVReserveThreshold(): Gold {
    if (!this.shouldMaintainMIRVReserve()) {
      return 0n;
    }

    // Get other players' gold levels for competitive analysis
    const otherPlayers = this.mg
      .players()
      .filter((p) => p !== this.player && p.isPlayer() && p.isAlive());

    if (otherPlayers.length === 0) {
      return FakeHumanExecution.MIRV_RESERVE_MIN;
    }

    const otherGoldLevels = otherPlayers.map((p) => Number(p.gold()));
    const sortedGoldLevels = otherGoldLevels.sort((a, b) => b - a); // Descending order

    // Calculate different economic benchmarks for more nuanced analysis
    const maxOtherGold = sortedGoldLevels[0];
    const avgOtherGold =
      otherGoldLevels.reduce((sum, gold) => sum + gold, 0) /
      otherGoldLevels.length;

    // Top 3 players average (or all if less than 3)
    const top3Count = Math.min(3, sortedGoldLevels.length);
    const top3Avg =
      sortedGoldLevels
        .slice(0, top3Count)
        .reduce((sum, gold) => sum + gold, 0) / top3Count;

    // Weighted average: 60% top players, 40% overall average
    const weightedBenchmark = top3Avg * 0.6 + avgOtherGold * 0.4;

    // Calculate economic pressure from multiple angles
    const baseThreshold = FakeHumanExecution.MIRV_RESERVE_MIN;

    // Pressure from top players being ahead
    const topPlayerGap = maxOtherGold - weightedBenchmark;
    const topGapRatio =
      weightedBenchmark > 0 ? topPlayerGap / weightedBenchmark : 0;

    // Pressure from overall economic level
    const economicLevel = weightedBenchmark;
    const levelRatio = economicLevel / 20_000_000; // Normalize to 20M baseline

    // Progressive competitive multiplier based on multiple factors
    let competitiveMultiplier = 1.0; // Base multiplier

    // Factor 1: How far ahead the top player is
    if (topGapRatio > 0.6) {
      // Top player is 60%+ ahead of weighted benchmark
      competitiveMultiplier = 1.3;
    } else if (topGapRatio > 0.3) {
      // Top player is 30%+ ahead
      competitiveMultiplier = 1.2;
    } else if (topGapRatio > 0.1) {
      // Top player is 10%+ ahead
      competitiveMultiplier = 1.1;
    }

    // Factor 2: Overall economic level (higher levels = more pressure)
    if (levelRatio > 1.5) {
      // Economy is 30M+ average
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.2);
    } else if (levelRatio > 1.0) {
      // Economy is 20M+ average
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.1);
    }

    // Factor 3: MIRV capability pressure
    if (maxOtherGold >= 25_000_000) {
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.4);
    } else if (top3Avg >= 20_000_000) {
      // Top 3 average is close to MIRV
      competitiveMultiplier = Math.max(competitiveMultiplier, 1.2);
    }

    const competitiveThreshold = Math.max(
      Number(baseThreshold),
      weightedBenchmark * competitiveMultiplier,
      maxOtherGold * 0.7, // Safety net: never let top player get too far ahead
    );

    // Cap at reasonable maximum to avoid excessive saving
    const maxThreshold = Number(FakeHumanExecution.MIRV_RESERVE_TARGET) * 1.5;
    const finalThreshold = Math.min(competitiveThreshold, maxThreshold);

    return BigInt(Math.floor(finalThreshold));
  }

  /**
   * Calculates how much gold the bot can spend considering MIRV reserve
   */
  private getSpendableGold(): Gold {
    if (this.player === null) return 0n;

    const totalGold = this.player.gold();
    const reserveThreshold = this.getMIRVReserveThreshold();

    if (totalGold <= reserveThreshold) {
      return 0n;
    }

    return totalGold - reserveThreshold;
  }

  /**
   * Checks if the bot can afford a structure considering MIRV reserve
   */
  private canAffordWithReserve(cost: Gold): boolean {
    return this.getSpendableGold() >= cost;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
