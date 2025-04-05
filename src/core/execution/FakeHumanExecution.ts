import { consolex } from "../Consolex";
import {
  AllianceRequest,
  Cell,
  Difficulty,
  Execution,
  Game,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerType,
  Relation,
  TerrainType,
  TerraNullius,
  Tick,
  Unit,
  UnitType,
} from "../game/Game";
import { euclDistFN, manhattanDistFN, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { GameID } from "../Schemas";
import { calculateBoundingBox, simpleHash } from "../Util";
import { AllianceRequestReplyExecution } from "./alliance/AllianceRequestReplyExecution";
import { AttackExecution } from "./AttackExecution";
import { ConstructionExecution } from "./ConstructionExecution";
import { EmojiExecution } from "./EmojiExecution";
import { NukeExecution } from "./NukeExecution";
import { SpawnExecution } from "./SpawnExecution";
import { TransportShipExecution } from "./TransportShipExecution";
import { closestTwoTiles } from "./Util";

export class FakeHumanExecution implements Execution {
  private firstMove = true;

  private active = true;
  private random: PseudoRandom;
  private mg: Game;
  private player: Player = null;

  private enemy: Player | null = null;
  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;

  private lastEnemyUpdateTick: number = 0;
  private lastEmojiSent = new Map<Player, Tick>();
  private lastNukeSent: [Tick, TileRef][] = [];
  private embargoMalusApplied = new Set<PlayerID>();

  constructor(
    gameID: GameID,
    private playerInfo: PlayerInfo,
  ) {
    this.random = new PseudoRandom(
      simpleHash(playerInfo.id) + simpleHash(gameID),
    );
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(60, 90) / 100;
    this.reserveRatio = this.random.nextInt(30, 60) / 100;
  }

  init(mg: Game, ticks: number) {
    this.mg = mg;
    if (this.random.chance(10)) {
      // this.isTraitor = true
    }
  }

  private updateRelationsFromEmbargos() {
    const others = this.mg.players().filter((p) => p.id() != this.player.id());

    others.forEach((other: Player) => {
      const embargoMalus = -20;
      if (
        other.hasEmbargoAgainst(this.player) &&
        !this.embargoMalusApplied.has(other.id())
      ) {
        this.player.updateRelation(other, embargoMalus);
        this.embargoMalusApplied.add(other.id());
      } else if (
        !other.hasEmbargoAgainst(this.player) &&
        this.embargoMalusApplied.has(other.id())
      ) {
        this.player.updateRelation(other, -embargoMalus);
        this.embargoMalusApplied.delete(other.id());
      }
    });
  }

  private handleEmbargoesToHostileNations() {
    const others = this.mg.players().filter((p) => p.id() != this.player.id());

    others.forEach((other: Player) => {
      /* When player is hostile starts embargo. Do not stop until neutral again */
      if (
        this.player.relation(other) <= Relation.Hostile &&
        !this.player.hasEmbargoAgainst(other)
      ) {
        this.player.addEmbargo(other.id());
      } else if (
        this.player.relation(other) >= Relation.Neutral &&
        this.player.hasEmbargoAgainst(other)
      ) {
        this.player.stopEmbargo(other.id());
      }
    });
  }

  tick(ticks: number) {
    if (ticks % this.attackRate != this.attackTick) return;

    if (this.mg.inSpawnPhase()) {
      const rl = this.randomLand();
      if (rl == null) {
        consolex.warn(`cannot spawn ${this.playerInfo.name}`);
        return;
      }
      this.mg.addExecution(new SpawnExecution(this.playerInfo, rl));
      return;
    }

    if (this.player == null) {
      this.player = this.mg.players().find((p) => p.id() == this.playerInfo.id);
      if (this.player == null) {
        return;
      }
    }
    if (this.firstMove) {
      this.firstMove = false;
      this.sendAttack(this.mg.terraNullius());
      return;
    }
    if (!this.player.isAlive()) {
      this.active = false;
      return;
    }

    if (
      this.player.troops() > 100_000 &&
      this.player.targetTroopRatio() > 0.7
    ) {
      this.player.setTargetTroopRatio(0.7);
    }

    this.updateRelationsFromEmbargos();
    this.handleAllianceRequests();
    this.handleEnemies();
    this.handleUnits();
    this.handleEmbargoesToHostileNations();
    this.maybeAttack();
  }

  private maybeAttack() {
    const enemyborder = Array.from(this.player.borderTiles())
      .flatMap((t) => this.mg.neighbors(t))
      .filter(
        (t) => this.mg.isLand(t) && this.mg.ownerID(t) != this.player.smallID(),
      );

    const enemiesWithTN = enemyborder.map((t) =>
      this.mg.playerBySmallID(this.mg.ownerID(t)),
    );
    if (enemiesWithTN.filter((o) => !o.isPlayer()).length > 0) {
      this.sendAttack(this.mg.terraNullius());
      return;
    }

    if (enemyborder.length == 0) {
      if (this.random.chance(5)) {
        this.sendBoatRandomly();
      }
      return;
    }
    if (this.random.chance(10)) {
      this.sendBoatRandomly();
      return;
    }

    const enemies = enemiesWithTN
      .filter((o) => o.isPlayer())
      .sort((a, b) => a.troops() - b.troops());

    // 5% chance to send a random alliance request
    if (this.random.chance(20)) {
      for (const toAlly of enemies) {
        if (this.player.canSendAllianceRequest(toAlly)) {
          this.player.createAllianceRequest(toAlly);
          return;
        }
      }
    }

    // 50-50 attack weakest player vs random player
    const toAttack = this.random.chance(2)
      ? enemies[0]
      : this.random.randElement(enemies);
    if (this.shouldAttack(toAttack)) {
      this.sendAttack(toAttack);
    }
  }

  private shouldAttack(other: Player): boolean {
    if (this.player.isOnSameTeam(other)) {
      return false;
    }
    if (this.player.isFriendly(other)) {
      if (this.shouldDiscourageAttack(other)) {
        return this.random.chance(200);
      }
      return this.random.chance(50);
    } else {
      if (this.shouldDiscourageAttack(other)) {
        return this.random.chance(4);
      }
      return true;
    }
  }

  private shouldDiscourageAttack(other: Player) {
    if (other.isTraitor()) {
      return false;
    }
    const difficulty = this.mg.config().gameConfig().difficulty;
    if (difficulty == Difficulty.Hard || difficulty == Difficulty.Impossible) {
      return false;
    }
    if (other.type() != PlayerType.Human) {
      return false;
    }
    // Only discourage attacks on Humans who are not traitors on easy or medium difficulty.
    return true;
  }

  handleEnemies() {
    if (this.mg.ticks() - this.lastEnemyUpdateTick > 100) {
      this.enemy = null;
    }

    // Switch enemies if we're under attack
    const incomingAttacks = this.player.incomingAttacks();
    if (incomingAttacks.length > 0) {
      this.enemy = incomingAttacks
        .sort((a, b) => b.troops() - a.troops())[0]
        .attacker();
      this.lastEnemyUpdateTick = this.mg.ticks();
    }

    // Attack allies' targets
    outer: for (const ally of this.player.allies()) {
      if (this.player.relation(ally) < Relation.Friendly) continue;
      for (const target of ally.targets()) {
        if (target === this.player) continue;
        if (this.player.isAlliedWith(target)) continue;

        this.player.updateRelation(ally, -20);
        this.enemy = target;
        this.lastEnemyUpdateTick = this.mg.ticks();
        if (ally.type() == PlayerType.Human) {
          this.mg.addExecution(
            new EmojiExecution(this.player.id(), ally.id(), "👍"),
          );
        }
        break outer;
      }
    }

    if (this.enemy === null) {
      // Save up troops until we reach the trigger ratio
      const maxPop = this.mg.config().maxPopulation(this.player);
      const ratio = this.player.population() / maxPop;
      if (ratio < this.triggerRatio) return;

      // Choose a new enemy
      const mostHated = this.player.allRelationsSorted()[0] ?? null;
      if (mostHated != null && mostHated.relation == Relation.Hostile) {
        this.enemy = mostHated.player;
        this.lastEnemyUpdateTick = this.mg.ticks();
      }
    }

    if (this.enemy) {
      if (this.player.isFriendly(this.enemy)) {
        this.enemy = null;
        return;
      }
      this.maybeSendEmoji();
      this.maybeSendNuke(this.enemy);
      if (this.player.sharesBorderWith(this.enemy)) {
        this.sendAttack(this.enemy);
      } else {
        this.maybeSendBoatAttack(this.enemy);
      }
      return;
    }
  }

  private maybeSendEmoji() {
    if (this.enemy.type() != PlayerType.Human) return;
    const lastSent = this.lastEmojiSent.get(this.enemy) ?? -300;
    if (this.mg.ticks() - lastSent <= 300) return;
    this.lastEmojiSent.set(this.enemy, this.mg.ticks());
    this.mg.addExecution(
      new EmojiExecution(
        this.player.id(),
        this.enemy.id(),
        this.random.randElement(["🤡", "😡"]),
      ),
    );
  }

  private maybeSendNuke(other: Player) {
    const silos = this.player.units(UnitType.MissileSilo);
    if (
      silos.length == 0 ||
      this.player.gold() < this.cost(UnitType.AtomBomb) ||
      this.player.isOnSameTeam(other)
    ) {
      return;
    }

    const structures = other.units(
      UnitType.City,
      UnitType.DefensePost,
      UnitType.MissileSilo,
      UnitType.Port,
      UnitType.SAMLauncher,
    );
    const structureTiles = structures.map((u) => u.tile());
    const randomTiles: TileRef[] = new Array(10);
    for (let i = 0; i < randomTiles.length; i++) {
      randomTiles[i] = this.randTerritoryTile(other);
    }
    const allTiles = randomTiles.concat(structureTiles);

    let bestTile = null;
    let bestValue = 0;
    this.removeOldNukeEvents();
    outer: for (const tile of new Set(allTiles)) {
      if (tile == null) continue;
      for (const t of this.mg.bfs(tile, manhattanDistFN(tile, 15))) {
        // Make sure we nuke at least 15 tiles in border
        if (this.mg.owner(t) != other) {
          continue outer;
        }
      }
      if (!this.player.canBuild(UnitType.AtomBomb, tile)) continue;
      const value = this.nukeTileScore(tile, silos, structures);
      if (value > bestTile) {
        bestTile = tile;
        bestValue = value;
      }
    }
    if (bestTile != null) {
      this.sendNuke(bestTile);
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

  private sendNuke(tile: TileRef) {
    const tick = this.mg.ticks();
    this.lastNukeSent.push([tick, tile]);
    this.mg.addExecution(
      new NukeExecution(UnitType.AtomBomb, this.player.id(), tile),
    );
  }

  private nukeTileScore(tile: TileRef, silos: Unit[], targets: Unit[]): number {
    // Potential damage in a 25-tile radius
    const dist = euclDistFN(tile, 25, false);
    let tileValue = targets
      .filter((unit) => dist(this.mg, unit.tile()))
      .map((unit) => {
        switch (unit.type()) {
          case UnitType.City:
            return 25_000;
          case UnitType.DefensePost:
            return 5_000;
          case UnitType.MissileSilo:
            return 50_000;
          case UnitType.Port:
            return 10_000;
          case UnitType.SAMLauncher:
            return 5_000;
          default:
            return 0;
        }
      })
      .reduce((prev, cur) => prev + cur, 0);

    // Prefer tiles that are closer to a silo
    const siloTiles = silos.map((u) => u.tile());
    const { x: closestSilo } = closestTwoTiles(this.mg, siloTiles, [tile]);
    const distanceToClosestSilo = this.mg.euclideanDist(tile, closestSilo);
    tileValue -= distanceToClosestSilo * 30;

    // Don't target near recent targets
    tileValue -= this.lastNukeSent
      .filter(([_tick, tile]) => dist(this.mg, tile))
      .map((_) => 1_000_000)
      .reduce((prev, cur) => prev + cur, 0);

    return tileValue;
  }

  private maybeSendBoatAttack(other: Player) {
    if (this.player.isOnSameTeam(other)) return;
    const closest = closestTwoTiles(
      this.mg,
      Array.from(this.player.borderTiles()).filter((t) =>
        this.mg.isOceanShore(t),
      ),
      Array.from(other.borderTiles()).filter((t) => this.mg.isOceanShore(t)),
    );
    if (closest == null) {
      return;
    }
    this.mg.addExecution(
      new TransportShipExecution(
        this.player.id(),
        other.id(),
        closest.y,
        this.player.troops() / 5,
      ),
    );
  }

  private handleUnits() {
    const ports = this.player.units(UnitType.Port);
    if (ports.length == 0 && this.player.gold() > this.cost(UnitType.Port)) {
      const oceanTiles = Array.from(this.player.borderTiles()).filter((t) =>
        this.mg.isOceanShore(t),
      );
      if (oceanTiles.length > 0) {
        const buildTile = this.random.randElement(oceanTiles);
        this.mg.addExecution(
          new ConstructionExecution(this.player.id(), buildTile, UnitType.Port),
        );
      }
      return;
    }
    this.maybeSpawnStructure(UnitType.City, 2);
    if (this.maybeSpawnWarship()) {
      return;
    }
    if (!this.mg.config().disableNukes()) {
      this.maybeSpawnStructure(UnitType.MissileSilo, 1);
    }
  }

  private maybeSpawnStructure(type: UnitType, maxNum: number) {
    const units = this.player.units(type);
    if (units.length >= maxNum) {
      return;
    }
    if (this.player.gold() < this.cost(type)) {
      return;
    }
    const tile = this.randTerritoryTile(this.player);
    if (tile == null) {
      return;
    }
    const canBuild = this.player.canBuild(type, tile);
    if (canBuild == false) {
      return;
    }
    this.mg.addExecution(
      new ConstructionExecution(this.player.id(), tile, type),
    );
  }

  private maybeSpawnWarship(): boolean {
    if (!this.random.chance(50)) {
      return false;
    }
    const ports = this.player.units(UnitType.Port);
    const ships = this.player.units(UnitType.Warship);
    if (
      ports.length > 0 &&
      ships.length == 0 &&
      this.player.gold() > this.cost(UnitType.Warship)
    ) {
      const port = this.random.randElement(ports);
      const targetTile = this.warshipSpawnTile(port.tile());
      if (targetTile == null) {
        return false;
      }
      const canBuild = this.player.canBuild(UnitType.Warship, targetTile);
      if (canBuild == false) {
        consolex.warn("cannot spawn destroyer");
        return false;
      }
      this.mg.addExecution(
        new ConstructionExecution(
          this.player.id(),
          targetTile,
          UnitType.Warship,
        ),
      );
      return true;
    }
    return false;
  }

  private randTerritoryTile(p: Player): TileRef | null {
    const boundingBox = calculateBoundingBox(this.mg, p.borderTiles());
    for (let i = 0; i < 100; i++) {
      const randX = this.random.nextInt(boundingBox.min.x, boundingBox.max.x);
      const randY = this.random.nextInt(boundingBox.min.y, boundingBox.max.y);
      if (!this.mg.isOnMap(new Cell(randX, randY))) {
        // Sanity check should never happen
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (this.mg.owner(randTile) == p) {
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

  private cost(type: UnitType): number {
    return this.mg.unitInfo(type).cost(this.player);
  }

  private handleAllianceRequests() {
    for (const req of this.player.incomingAllianceRequests()) {
      if (req.requestor().isTraitor()) {
        this.replyToAllianceRequest(req, false);
        continue;
      }
      if (this.player.relation(req.requestor()) < Relation.Neutral) {
        this.replyToAllianceRequest(req, false);
        continue;
      }
      const requestorIsMuchLarger =
        req.requestor().numTilesOwned() > this.player.numTilesOwned() * 3;
      if (!requestorIsMuchLarger && req.requestor().alliances().length >= 3) {
        this.replyToAllianceRequest(req, false);
        continue;
      }
      this.replyToAllianceRequest(req, true);
    }
  }

  private replyToAllianceRequest(req: AllianceRequest, accept: boolean): void {
    this.mg.addExecution(
      new AllianceRequestReplyExecution(
        req.requestor().id(),
        this.player.id(),
        accept,
      ),
    );
  }

  sendBoatRandomly() {
    const oceanShore = Array.from(this.player.borderTiles()).filter((t) =>
      this.mg.isOceanShore(t),
    );
    if (oceanShore.length == 0) {
      return;
    }

    const src = this.random.randElement(oceanShore);

    const dst = this.randOceanShoreTile(src, 250);
    if (dst == null) {
      return;
    }

    this.mg.addExecution(
      new TransportShipExecution(
        this.player.id(),
        this.mg.owner(dst).id(),
        dst,
        this.player.troops() / 5,
      ),
    );
    return;
  }

  randomLand(): TileRef | null {
    const delta = 25;
    let tries = 0;
    while (tries < 50) {
      tries++;
      const cell = this.playerInfo.nation.cell;
      const x = this.random.nextInt(cell.x - delta, cell.x + delta);
      const y = this.random.nextInt(cell.y - delta, cell.y + delta);
      if (!this.mg.isValidCoord(x, y)) {
        continue;
      }
      const tile = this.mg.ref(x, y);
      if (this.mg.isLand(tile) && !this.mg.hasOwner(tile)) {
        if (
          this.mg.terrainType(tile) == TerrainType.Mountain &&
          this.random.chance(2)
        ) {
          continue;
        }
        return tile;
      }
    }
    return null;
  }

  sendAttack(toAttack: Player | TerraNullius) {
    if (toAttack.isPlayer() && this.player.isOnSameTeam(toAttack)) return;
    const max =
      this.mg.config().maxPopulation(this.player) *
      this.player.targetTroopRatio();
    const target = max * this.reserveRatio;
    const troops = this.player.troops() - target;
    if (troops < 1) return;
    this.mg.addExecution(
      new AttackExecution(
        troops,
        this.player.id(),
        toAttack.isPlayer() ? toAttack.id() : null,
      ),
    );
  }

  private randOceanShoreTile(tile: TileRef, dist: number): TileRef | null {
    const x = this.mg.x(tile);
    const y = this.mg.y(tile);
    for (let i = 0; i < 500; i++) {
      const randX = this.random.nextInt(x - dist, x + dist);
      const randY = this.random.nextInt(y - dist, y + dist);
      if (!this.mg.isValidCoord(randX, randY)) {
        continue;
      }
      const randTile = this.mg.ref(randX, randY);
      if (!this.mg.isOceanShore(randTile)) {
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

  owner(): Player {
    return null;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
