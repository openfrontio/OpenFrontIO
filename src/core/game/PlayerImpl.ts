import { renderTroops } from "../../client/Utils";
import { ClientID } from "../Schemas";
import {
  assertNever,
  closestOceanShoreFromPlayer,
  distSortUnit,
  simpleHash,
  targetTransportTile,
  within,
} from "../Util";
import { AttackImpl } from "./AttackImpl";
import {
  Alliance,
  AllianceRequest,
  AllPlayers,
  Attack,
  Cell,
  EmojiMessage,
  Execution,
  Gold,
  MessageType,
  MutableAlliance,
  Player,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Relation,
  TerraNullius,
  Tick,
  Unit,
  UnitType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { andFN, manhattanDistFN, TileRef } from "./GameMap";
import { AttackUpdate, GameUpdateType, PlayerUpdate } from "./GameUpdates";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitImpl } from "./UnitImpl";

interface Target {
  tick: Tick;
  target: Player;
}

class Donation {
  constructor(
    public readonly recipient: Player,
    public readonly tick: Tick,
  ) {}
}

export class PlayerImpl implements Player {
  public _lastTileChange: number = 0;

  private _gold: Gold;
  private _troops: number;
  private _workers: number;
  private _targetTroopRatio: number = 1;

  isTraitor_ = false;

  public _borderTiles: Set<TileRef> = new Set();

  public _units: UnitImpl[] = [];
  public _tiles: Set<TileRef> = new Set();

  private _flag: string;
  private _name: string;
  private _displayName: string;

  public pastOutgoingAllianceRequests: AllianceRequest[] = [];

  private targets_: Target[] = [];

  private outgoingEmojis_: EmojiMessage[] = [];

  private sentDonations: Donation[] = [];

  private relations = new Map<Player, number>();

  public _incomingAttacks: Attack[] = [];
  public _outgoingAttacks: Attack[] = [];

  constructor(
    private mg: GameImpl,
    private _smallID: number,
    private readonly playerInfo: PlayerInfo,
    startPopulation: number,
  ) {
    this._flag = playerInfo.flag;
    this._name = playerInfo.name;
    this._targetTroopRatio = 1;
    this._troops = startPopulation * this._targetTroopRatio;
    this._workers = startPopulation * (1 - this._targetTroopRatio);
    this._gold = 0;
    this._displayName = this._name; // processName(this._name)
  }

  largestClusterBoundingBox: { min: Cell; max: Cell } | null;

  toUpdate(): PlayerUpdate {
    return {
      type: GameUpdateType.Player,
      clientID: this.clientID(),
      flag: this.flag(),
      name: this.name(),
      displayName: this.displayName(),
      id: this.id(),
      smallID: this.smallID(),
      playerType: this.type(),
      isAlive: this.isAlive(),
      tilesOwned: this.numTilesOwned(),
      gold: this._gold,
      population: this.population(),
      workers: this.workers(),
      troops: this.troops(),
      targetTroopRatio: this.targetTroopRatio(),
      allies: this.alliances().map((a) => a.other(this).smallID()),
      isTraitor: this.isTraitor(),
      targets: this.targets().map((p) => p.smallID()),
      outgoingEmojis: this.outgoingEmojis(),
      outgoingAttacks: this._outgoingAttacks.map(
        (a) =>
          ({
            attackerID: a.attacker().smallID(),
            targetID: a.target().smallID(),
            troops: a.troops(),
          }) as AttackUpdate,
      ),
      incomingAttacks: this._incomingAttacks.map(
        (a) =>
          ({
            attackerID: a.attacker().smallID(),
            targetID: a.target().smallID(),
            troops: a.troops(),
          }) as AttackUpdate,
      ),
    };
  }

  smallID(): number {
    return this._smallID;
  }

  flag(): string {
    return this._flag;
  }

  name(): string {
    return this._name;
  }
  displayName(): string {
    return this._displayName;
  }

  clientID(): ClientID {
    return this.playerInfo.clientID;
  }

  id(): PlayerID {
    return this.playerInfo.id;
  }

  type(): PlayerType {
    return this.playerInfo.playerType;
  }

  units(...types: UnitType[]): UnitImpl[] {
    if (types.length == 0) {
      return this._units;
    }
    const ts = new Set(types);
    return this._units.filter((u) => ts.has(u.type()));
  }

  unitsIncludingConstruction(type: UnitType): Unit[] {
    const units = this.units(type);
    units.push(
      ...this.units(UnitType.Construction).filter(
        (u) => u.constructionType() == type,
      ),
    );
    return units;
  }

  sharesBorderWith(other: Player | TerraNullius): boolean {
    for (const border of this._borderTiles) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().ownerID(neighbor) == other.smallID()) {
          return true;
        }
      }
    }
    return false;
  }
  numTilesOwned(): number {
    return this._tiles.size;
  }

  tiles(): ReadonlySet<TileRef> {
    return new Set(this._tiles.values()) as Set<TileRef>;
  }

  borderTiles(): ReadonlySet<TileRef> {
    return this._borderTiles;
  }

  neighbors(): (Player | TerraNullius)[] {
    const ns: Set<Player | TerraNullius> = new Set();
    for (const border of this.borderTiles()) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().isLake(neighbor)) {
          const owner = this.mg.map().ownerID(neighbor);
          if (owner != this.smallID()) {
            ns.add(
              this.mg.playerBySmallID(owner) as PlayerImpl | TerraNulliusImpl,
            );
          }
        }
      }
    }
    return Array.from(ns);
  }

  isPlayer(): this is Player {
    return true as const;
  }
  setTroops(troops: number) {
    this._troops = Math.floor(troops);
  }
  conquer(tile: TileRef) {
    this.mg.conquer(this, tile);
  }
  relinquish(tile: TileRef) {
    if (this.mg.owner(tile) != this) {
      throw new Error(`Cannot relinquish tile not owned by this player`);
    }
    this.mg.relinquish(tile);
  }
  info(): PlayerInfo {
    return this.playerInfo;
  }
  isAlive(): boolean {
    return this._tiles.size > 0;
  }
  executions(): Execution[] {
    return this.mg
      .executions()
      .filter((exec) => exec.owner().id() == this.id());
  }

  incomingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.recipient() == this);
  }

  outgoingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.requestor() == this);
  }

  alliances(): MutableAlliance[] {
    return this.mg.alliances_.filter(
      (a) => a.requestor() == this || a.recipient() == this,
    );
  }

  allies(): Player[] {
    return this.alliances().map((a) => a.other(this));
  }

  isAlliedWith(other: Player): boolean {
    if (other == this) {
      return false;
    }
    return this.allianceWith(other) != null;
  }

  allianceWith(other: Player): MutableAlliance | null {
    if (other == this) {
      return null;
    }
    return this.alliances().find(
      (a) => a.recipient() == other || a.requestor() == other,
    );
  }

  canSendAllianceRequest(other: Player): boolean {
    if (other == this) {
      return false;
    }
    if (this.isAlliedWith(other)) {
      return false;
    }

    const hasPending =
      this.incomingAllianceRequests().find((ar) => ar.requestor() == other) !=
        null ||
      this.outgoingAllianceRequests().find((ar) => ar.recipient() == other) !=
        null;

    if (hasPending) {
      return false;
    }

    const recent = this.pastOutgoingAllianceRequests
      .filter((ar) => ar.recipient() == other)
      .sort((a, b) => b.createdAt() - a.createdAt());

    if (recent.length == 0) {
      return true;
    }

    const delta = this.mg.ticks() - recent[0].createdAt();

    return delta >= this.mg.config().allianceRequestCooldown();
  }

  breakAlliance(alliance: Alliance): void {
    this.mg.breakAlliance(this, alliance);
  }

  isTraitor(): boolean {
    return this.isTraitor_;
  }

  createAllianceRequest(recipient: Player): AllianceRequest {
    if (this.isAlliedWith(recipient)) {
      throw new Error(`cannot create alliance request, already allies`);
    }
    return this.mg.createAllianceRequest(this, recipient as Player);
  }

  relation(other: Player): Relation {
    if (other == this) {
      throw new Error(`cannot get relation with self: ${this}`);
    }
    if (this.relations.has(other)) {
      return this.relationFromValue(this.relations.get(other));
    }
    return Relation.Neutral;
  }

  private relationFromValue(relationValue: number): Relation {
    if (relationValue < -50) {
      return Relation.Hostile;
    }
    if (relationValue < 0) {
      return Relation.Distrustful;
    }
    if (relationValue < 50) {
      return Relation.Neutral;
    }
    return Relation.Friendly;
  }

  allRelationsSorted(): { player: Player; relation: Relation }[] {
    return Array.from(this.relations, ([k, v]) => ({ player: k, relation: v }))
      .sort((a, b) => a.relation - b.relation)
      .map((r) => ({
        player: r.player,
        relation: this.relationFromValue(r.relation),
      }));
  }

  updateRelation(other: Player, delta: number): void {
    if (other == this) {
      throw new Error(`cannot update relation with self: ${this}`);
    }
    let relation = 0;
    if (this.relations.has(other)) {
      relation = this.relations.get(other);
    }
    const newRelation = within(relation + delta, -100, 100);
    this.relations.set(other, newRelation);
  }

  decayRelations() {
    this.relations.forEach((r: number, p: Player) => {
      const sign = -1 * Math.sign(r);
      const delta = 0.05;
      r += sign * delta;
      if (Math.abs(r) < delta * 2) {
        r = 0;
      }
      this.relations.set(p, r);
    });
  }

  canTarget(other: Player): boolean {
    if (this == other) {
      return false;
    }
    if (this.isAlliedWith(other)) {
      return false;
    }
    for (const t of this.targets_) {
      if (this.mg.ticks() - t.tick < this.mg.config().targetCooldown()) {
        return false;
      }
    }
    return true;
  }

  target(other: Player): void {
    this.targets_.push({ tick: this.mg.ticks(), target: other });
    this.mg.target(this, other);
  }

  targets(): PlayerImpl[] {
    return this.targets_
      .filter(
        (t) => this.mg.ticks() - t.tick < this.mg.config().targetDuration(),
      )
      .map((t) => t.target as PlayerImpl);
  }

  transitiveTargets(): Player[] {
    const ts = this.alliances()
      .map((a) => a.other(this))
      .flatMap((ally) => ally.targets());
    ts.push(...this.targets());
    return [...new Set(ts)] as Player[];
  }

  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void {
    if (recipient == this) {
      throw Error(`Cannot send emoji to oneself: ${this}`);
    }
    const msg: EmojiMessage = {
      message: emoji,
      senderID: this.smallID(),
      recipientID: recipient == AllPlayers ? recipient : recipient.smallID(),
      createdAt: this.mg.ticks(),
    };
    this.outgoingEmojis_.push(msg);
    this.mg.sendEmojiUpdate(msg);
  }

  outgoingEmojis(): EmojiMessage[] {
    return this.outgoingEmojis_
      .filter(
        (e) =>
          this.mg.ticks() - e.createdAt <
          this.mg.config().emojiMessageDuration(),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  canSendEmoji(recipient: Player | typeof AllPlayers): boolean {
    const recipientID =
      recipient == AllPlayers ? AllPlayers : recipient.smallID();
    const prevMsgs = this.outgoingEmojis_.filter(
      (msg) => msg.recipientID == recipientID,
    );
    for (const msg of prevMsgs) {
      if (
        this.mg.ticks() - msg.createdAt <
        this.mg.config().emojiMessageCooldown()
      ) {
        return false;
      }
    }
    return true;
  }

  canDonate(recipient: Player): boolean {
    if (!this.isAlliedWith(recipient)) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient == recipient) {
        if (
          this.mg.ticks() - donation.tick <
          this.mg.config().donateCooldown()
        ) {
          return false;
        }
      }
    }
    return true;
  }

  donate(recipient: Player, troops: number): void {
    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    recipient.addTroops(this.removeTroops(troops));
    this.mg.displayMessage(
      `Sent ${renderTroops(troops)} troops to ${recipient.name()}`,
      MessageType.INFO,
      this.id(),
    );
    this.mg.displayMessage(
      `Recieved ${renderTroops(troops)} troops from ${this.name()}`,
      MessageType.SUCCESS,
      recipient.id(),
    );
  }

  gold(): Gold {
    return this._gold;
  }

  addGold(toAdd: Gold): void {
    this._gold += toAdd;
  }

  removeGold(toRemove: Gold): void {
    if (toRemove > this._gold) {
      throw Error(
        `Player ${this} does not enough gold (${toRemove} vs ${this._gold}))`,
      );
    }
    this._gold -= toRemove;
  }

  population(): number {
    return this._troops + this._workers;
  }
  workers(): number {
    return Math.max(1, this._workers);
  }
  addWorkers(toAdd: number): void {
    this._workers += toAdd;
  }
  removeWorkers(toRemove: number): void {
    this._workers = Math.max(1, this._workers - toRemove);
  }

  targetTroopRatio(): number {
    return this._targetTroopRatio;
  }

  setTargetTroopRatio(target: number): void {
    if (target < 0 || target > 1) {
      throw new Error(
        `invalid targetTroopRatio ${target} set on player ${PlayerImpl}`,
      );
    }
    this._targetTroopRatio = target;
  }

  troops(): number {
    return this._troops;
  }

  addTroops(troops: number): void {
    if (troops < 0) {
      this.removeTroops(-1 * troops);
      return;
    }
    this._troops += Math.floor(troops);
  }
  removeTroops(troops: number): number {
    if (troops <= 1) {
      return 0;
    }
    const toRemove = Math.floor(Math.min(this._troops - 1, troops));
    this._troops -= toRemove;
    return toRemove;
  }

  captureUnit(unit: Unit): void {
    if (unit.owner() == this) {
      throw new Error(`Cannot capture unit, ${this} already owns ${unit}`);
    }
    const prev = unit.owner();
    (prev as PlayerImpl)._units = (prev as PlayerImpl)._units.filter(
      (u) => u != unit,
    );
    (unit as UnitImpl)._owner = this;
    this._units.push(unit as UnitImpl);
    this.mg.addUpdate(unit.toUpdate());
    this.mg.displayMessage(
      `${unit.type()} captured by ${this.displayName()}`,
      MessageType.ERROR,
      prev.id(),
    );
    this.mg.displayMessage(
      `Captured ${unit.type()} from ${prev.displayName()}`,
      MessageType.SUCCESS,
      this.id(),
    );
  }

  buildUnit(type: UnitType, troops: number, spawnTile: TileRef): UnitImpl {
    const cost = this.mg.unitInfo(type).cost(this);
    const b = new UnitImpl(
      type,
      this.mg,
      spawnTile,
      troops,
      this.mg.nextUnitID(),
      this,
    );
    this._units.push(b);
    this.removeGold(cost);
    this.removeTroops(troops);
    this.mg.addUpdate(b.toUpdate());
    if (type == UnitType.DefensePost) {
      this.mg.addDefensePost(b);
    }
    return b;
  }

  canBuild(unitType: UnitType, targetTile: TileRef): TileRef | false {
    const cost = this.mg.unitInfo(unitType).cost(this);
    if (!this.isAlive() || this.gold() < cost) {
      return false;
    }
    switch (unitType) {
      case UnitType.MIRV:
        if (!this.mg.hasOwner(targetTile)) {
          return false;
        }
        return this.nukeSpawn(targetTile);
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return this.nukeSpawn(targetTile);
      case UnitType.MIRVWarhead:
        return targetTile;
      case UnitType.Port:
        return this.portSpawn(targetTile);
      case UnitType.Warship:
        return this.warshipSpawn(targetTile);
      case UnitType.Shell:
        return targetTile;
      case UnitType.TransportShip:
        return this.transportShipSpawn(targetTile);
      case UnitType.TradeShip:
        return this.tradeShipSpawn(targetTile);
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.City:
      case UnitType.Construction:
        return this.landBasedStructureSpawn(targetTile);
      default:
        assertNever(unitType);
    }
  }

  nukeSpawn(tile: TileRef): TileRef | false {
    const spawns = this.units(UnitType.MissileSilo)
      .map((u) => u as Unit)
      .sort(distSortUnit(this.mg, tile));
    if (spawns.length == 0) {
      return false;
    }
    return spawns[0].tile();
  }

  portSpawn(tile: TileRef): TileRef | false {
    const spawns = Array.from(this.mg.bfs(tile, manhattanDistFN(tile, 20)))
      .filter((t) => this.mg.owner(t) == this && this.mg.isOceanShore(t))
      .sort(
        (a, b) =>
          this.mg.manhattanDist(a, tile) - this.mg.manhattanDist(b, tile),
      );
    if (spawns.length == 0) {
      return false;
    }
    return spawns[0];
  }

  warshipSpawn(tile: TileRef): TileRef | false {
    if (!this.mg.isOcean(tile)) {
      return false;
    }
    const spawns = this.units(UnitType.Port)
      .filter(
        (u) =>
          this.mg.manhattanDist(u.tile(), tile) <
          this.mg.config().boatMaxDistance(),
      )
      .sort(
        (a, b) =>
          this.mg.manhattanDist(a.tile(), tile) -
          this.mg.manhattanDist(b.tile(), tile),
      );
    if (spawns.length == 0) {
      return false;
    }
    return spawns[0].tile();
  }

  landBasedStructureSpawn(tile: TileRef): TileRef | false {
    if (this.mg.owner(tile) != this) {
      return false;
    }
    return tile;
  }

  transportShipSpawn(targetTile: TileRef): TileRef | false {
    if (!this.mg.isOceanShore(targetTile)) {
      return false;
    }
    const spawn = closestOceanShoreFromPlayer(this.mg, this, targetTile);
    if (spawn == null) {
      return false;
    }
    return spawn;
  }

  tradeShipSpawn(targetTile: TileRef): TileRef | false {
    const spawns = this.units(UnitType.Port).filter(
      (u) => u.tile() == targetTile,
    );
    if (spawns.length == 0) {
      return false;
    }
    return spawns[0].tile();
  }
  lastTileChange(): Tick {
    return this._lastTileChange;
  }

  hash(): number {
    return (
      simpleHash(this.id()) * (this.population() + this.numTilesOwned()) +
      this._units.reduce((acc, unit) => acc + unit.hash(), 0)
    );
  }
  toString(): string {
    return `Player:{name:${this.info().name},clientID:${
      this.info().clientID
    },isAlive:${this.isAlive()},troops:${
      this._troops
    },numTileOwned:${this.numTilesOwned()}}]`;
  }

  public playerProfile(): PlayerProfile {
    const rel = {
      relations: Object.fromEntries(
        this.allRelationsSorted().map(({ player, relation }) => [
          player.smallID(),
          relation,
        ]),
      ),
      alliances: this.alliances().map((a) => a.other(this).smallID()),
    };
    return rel;
  }

  public canBoat(tile: TileRef): boolean {
    const other = this.mg.owner(tile);
    if (
      this.units(UnitType.TransportShip).length >=
      this.mg.config().boatMaxNumber()
    ) {
      return false;
    }

    let myPlayerBordersOcean = false;
    for (const bt of this.borderTiles()) {
      if (this.mg.isOceanShore(bt)) {
        myPlayerBordersOcean = true;
        break;
      }
    }
    let otherPlayerBordersOcean = false;
    if (!this.mg.hasOwner(tile)) {
      otherPlayerBordersOcean = true;
    } else {
      for (const bt of (other as Player).borderTiles()) {
        if (this.mg.isOceanShore(bt)) {
          otherPlayerBordersOcean = true;
          break;
        }
      }
    }

    if (other.isPlayer() && this.allianceWith(other)) {
      return false;
    }

    let nearOcean = false;
    for (const t of this.mg.bfs(
      tile,
      andFN(
        (gm, t) => gm.ownerID(t) == gm.ownerID(tile) && gm.isLand(t),
        manhattanDistFN(tile, 25),
      ),
    )) {
      if (this.mg.isOceanShore(t)) {
        nearOcean = true;
        break;
      }
    }
    if (!nearOcean) {
      return false;
    }

    if (myPlayerBordersOcean && otherPlayerBordersOcean) {
      const dst = targetTransportTile(this.mg, tile);
      if (dst != null) {
        if (this.canBuild(UnitType.TransportShip, dst)) {
          return true;
        }
      }
    }
  }

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef,
  ): Attack {
    const attack = new AttackImpl(target, this, troops, sourceTile);
    this._outgoingAttacks.push(attack);
    if (target.isPlayer()) {
      (target as PlayerImpl)._incomingAttacks.push(attack);
    }
    return attack;
  }
  outgoingAttacks(): Attack[] {
    return this._outgoingAttacks;
  }
  incomingAttacks(): Attack[] {
    return this._incomingAttacks;
  }

  public canAttack(tile: TileRef): boolean {
    if (
      this.mg.hasOwner(tile) &&
      this.mg.config().numSpawnPhaseTurns() +
        this.mg.config().spawnImmunityDuration() >
        this.mg.ticks()
    ) {
      return false;
    }

    if (this.mg.owner(tile) == this) {
      return false;
    }
    if (
      this.mg.hasOwner(tile) &&
      this.isAlliedWith(this.mg.owner(tile) as Player)
    ) {
      return false;
    }
    if (!this.mg.isLand(tile)) {
      return false;
    }
    if (this.mg.hasOwner(tile)) {
      return this.sharesBorderWith(this.mg.owner(tile));
    } else {
      for (const t of this.mg.bfs(
        tile,
        andFN(
          (gm, t) => !gm.hasOwner(t) && gm.isLand(t),
          manhattanDistFN(tile, 200),
        ),
      )) {
        for (const n of this.mg.neighbors(t)) {
          if (this.mg.owner(n) == this) {
            return true;
          }
        }
      }
      return false;
    }
  }
}
