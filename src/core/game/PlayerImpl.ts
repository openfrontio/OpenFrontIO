import { PseudoRandom } from "../PseudoRandom";
import { ClientID } from "../Schemas";
import {
  assertNever,
  findClosestBy,
  minInt,
  simpleHash,
  toInt,
  within,
} from "../Util";
import { AttackImpl } from "./AttackImpl";
import {
  Alliance,
  AllianceInfo,
  AllianceRequest,
  AllPlayers,
  Attack,
  BuildableUnit,
  Cell,
  ColoredTeams,
  Embargo,
  EmojiMessage,
  GameMode,
  Gold,
  MutableAlliance,
  Player,
  PlayerBuildable,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Relation,
  Structures,
  Team,
  TerraNullius,
  Tick,
  Unit,
  UnitParams,
  UnitType,
} from "./Game";
import { GameImpl } from "./GameImpl";
import { andFN, manhattanDistFN, TileRef } from "./GameMap";
import {
  ATTACK_DELTA_INCOMING,
  ATTACK_DELTA_OUTGOING,
  diffPlayerUpdate,
  packAttackTroopDeltas,
} from "./GameUpdateUtils";
import {
  AllianceView,
  AttackUpdate,
  GameUpdateType,
  PlayerUpdate,
} from "./GameUpdates";
import {
  bestShoreDeploymentSource,
  canBuildTransportShip,
} from "./TransportShipUtils";
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

// Shared singletons for empty collections in toFullUpdate. Sharing
// references lets diffPlayerUpdate's `a === b` fast paths skip structural
// comparison and avoids per-player-per-tick allocations. The arrays are
// frozen so accidental in-worker mutation throws instead of silently
// corrupting every player's updates; updates crossing to the main thread
// are structured-cloned (clones are mutable). Sets cannot be frozen
// (Set.add ignores freeze) — EMPTY_EMBARGOES must never be mutated.
const EMPTY_NUMBER_ARRAY: number[] = [];
const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_ATTACK_UPDATES: AttackUpdate[] = [];
const EMPTY_ALLIANCE_VIEWS: AllianceView[] = [];
const EMPTY_EMOJIS: EmojiMessage[] = [];
const EMPTY_EMBARGOES = new Set<string>();
Object.freeze(EMPTY_NUMBER_ARRAY);
Object.freeze(EMPTY_STRING_ARRAY);
Object.freeze(EMPTY_ATTACK_UPDATES);
Object.freeze(EMPTY_ALLIANCE_VIEWS);
Object.freeze(EMPTY_EMOJIS);

export class PlayerImpl implements Player {
  public _lastTileChange: number = 0;
  public _pseudo_random: PseudoRandom;

  private _gold: bigint;
  private _troops: bigint;

  markedTraitorTick = -1;
  private _betrayalCount: number = 0;

  private embargoes = new Map<PlayerID, Embargo>();

  public _borderTiles: Set<TileRef> = new Set();

  public _units: Unit[] = [];
  public _tiles: Set<TileRef> = new Set();

  public pastOutgoingAllianceRequests: AllianceRequest[] = [];
  private _expiredAlliances: Alliance[] = [];

  private targets_: Target[] = [];

  private outgoingEmojis_: EmojiMessage[] = [];
  private outgoingQuickChats_ = new Map<number, Tick>();

  private sentDonations: Donation[] = [];

  private relations = new Map<Player, number>();

  private lastDeleteUnitTick: Tick = -1;
  private lastEmbargoAllTick: Tick = -1;

  public _incomingAttacks: Attack[] = [];
  public _outgoingAttacks: Attack[] = [];
  public _outgoingLandAttacks: Attack[] = [];

  public _alliances: MutableAlliance[] = [];

  private _spawnTile: TileRef | undefined;
  private _isDisconnected = false;

  /**
   * Last PlayerUpdate emitted for this player on the worker→main channel.
   * Used by GameImpl's tick loop to compute field-level diffs. Undefined on
   * first emission (full snapshot sent).
   */
  public lastSentUpdate: PlayerUpdate | undefined;

  constructor(
    private mg: GameImpl,
    private _smallID: number,
    private readonly playerInfo: PlayerInfo,
    startTroops: number,
    private readonly _team: Team | null,
  ) {
    this._troops = toInt(startTroops);
    this._gold = mg.config().startingGold(playerInfo);
    this._pseudo_random = new PseudoRandom(simpleHash(this.playerInfo.id));
  }

  largestClusterBoundingBox: { min: Cell; max: Cell } | null;

  /**
   * Build a PlayerUpdate for the worker→main wire.
   *
   * The first call for a player returns the full snapshot. Subsequent calls
   * return only fields that changed since the previous call (a partial
   * `{ type, id, ...changedFields }`), or `null` if nothing changed.
   *
   * tilesOwned / gold / troops are excluded from partial updates (they churn
   * for every alive player every tick): when any of them changed, a
   * `[smallID, tilesOwned, gold, troops]` quad is pushed to `statsOut`
   * instead, which GameImpl drains into the transferable
   * `packedPlayerUpdates` buffer. Attack troop counts likewise go to
   * `attackTroopsOut` as `[smallID, direction, index, troops]` quads
   * (→ `packedAttackUpdates`) instead of re-sending whole attack arrays.
   *
   * `lastSentUpdate` is updated to the full snapshot on every call.
   */
  toUpdate(
    statsOut?: number[],
    attackTroopsOut?: number[],
  ): PlayerUpdate | null {
    const full = this.toFullUpdate();
    const prev = this.lastSentUpdate;
    this.lastSentUpdate = full;
    if (prev === undefined) return full;
    if (
      statsOut !== undefined &&
      (prev.tilesOwned !== full.tilesOwned ||
        prev.gold !== full.gold ||
        prev.troops !== full.troops)
    ) {
      statsOut.push(
        full.smallID!,
        full.tilesOwned!,
        Number(full.gold),
        full.troops!,
      );
    }
    if (attackTroopsOut !== undefined) {
      packAttackTroopDeltas(
        prev.outgoingAttacks,
        full.outgoingAttacks,
        full.smallID!,
        ATTACK_DELTA_OUTGOING,
        attackTroopsOut,
      );
      packAttackTroopDeltas(
        prev.incomingAttacks,
        full.incomingAttacks,
        full.smallID!,
        ATTACK_DELTA_INCOMING,
        attackTroopsOut,
      );
    }
    return diffPlayerUpdate(prev, full);
  }

  private toFullUpdate(): PlayerUpdate {
    // Empty collections reuse shared singletons (EMPTY_*) so
    // diffPlayerUpdate's reference fast paths hit and nothing is allocated.
    // This runs for every player every tick; most collections are empty for
    // most players. The singletons are never mutated — updates are
    // structured-cloned before leaving the worker.
    let outgoingAllianceRequests = EMPTY_STRING_ARRAY;
    for (const ar of this.mg.allianceRequests) {
      if (ar.requestor() === this) {
        if (outgoingAllianceRequests === EMPTY_STRING_ARRAY) {
          outgoingAllianceRequests = [];
        }
        outgoingAllianceRequests.push(ar.recipient().id());
      }
    }

    const alliances = this.alliances();
    let allies = EMPTY_NUMBER_ARRAY;
    let allianceViews = EMPTY_ALLIANCE_VIEWS;
    if (alliances.length > 0) {
      allies = alliances.map((a) => a.other(this).smallID());
      const extensionCutoff =
        this.mg.ticks() + this.mg.config().allianceExtensionPromptOffset();
      allianceViews = alliances.map(
        (a) =>
          ({
            id: a.id(),
            other: a.other(this).id(),
            createdAt: a.createdAt(),
            expiresAt: a.expiresAt(),
            hasExtensionRequest: a.expiresAt() <= extensionCutoff,
          }) satisfies AllianceView,
      );
    }

    let embargoes = EMPTY_EMBARGOES;
    if (this.embargoes.size > 0) {
      embargoes = new Set<string>();
      for (const id of this.embargoes.keys()) {
        embargoes.add(id.toString());
      }
    }

    let targets = EMPTY_NUMBER_ARRAY;
    if (this.targets_.length > 0) {
      const t = this.targets();
      if (t.length > 0) {
        targets = t.map((p) => p.smallID());
      }
    }

    let outgoingEmojis = EMPTY_EMOJIS;
    if (this.outgoingEmojis_.length > 0) {
      const e = this.outgoingEmojis();
      if (e.length > 0) {
        outgoingEmojis = e;
      }
    }

    const outgoingAttacks =
      this._outgoingAttacks.length === 0
        ? EMPTY_ATTACK_UPDATES
        : this._outgoingAttacks.map((a) => {
            return {
              attackerID: a.attacker().smallID(),
              targetID: a.target().smallID(),
              troops: a.troops(),
              id: a.id(),
              retreating: a.retreating(),
            } satisfies AttackUpdate;
          });

    let incomingAttacks = EMPTY_ATTACK_UPDATES;
    if (this._incomingAttacks.length > 0) {
      const incoming = this.incomingAttacks();
      if (incoming.length > 0) {
        incomingAttacks = incoming.map((a) => {
          return {
            attackerID: a.attacker().smallID(),
            targetID: a.target().smallID(),
            troops: a.troops(),
            id: a.id(),
            retreating: a.retreating(),
          } satisfies AttackUpdate;
        });
      }
    }

    return {
      type: GameUpdateType.Player,
      clientID: this.clientID(),
      name: this.name(),
      displayName: this.displayName(),
      id: this.id(),
      team: this.team() ?? undefined,
      smallID: this.smallID(),
      playerType: this.type(),
      isAlive: this.isAlive(),
      isDisconnected: this.isDisconnected(),
      tilesOwned: this.numTilesOwned(),
      gold: this._gold,
      troops: this.troops(),
      allies: allies,
      embargoes: embargoes,
      isTraitor: this.isTraitor(),
      traitorRemainingTicks: this.getTraitorRemainingTicks(),
      targets: targets,
      outgoingEmojis: outgoingEmojis,
      outgoingAttacks: outgoingAttacks,
      incomingAttacks: incomingAttacks,
      outgoingAllianceRequests: outgoingAllianceRequests,
      alliances: allianceViews,
      hasSpawned: this.hasSpawned(),
      spawnTile: this._spawnTile,
      betrayals: this._betrayalCount,
      lastDeleteUnitTick: this.lastDeleteUnitTick,
      isLobbyCreator: this.isLobbyCreator(),
    };
  }

  smallID(): number {
    return this._smallID;
  }

  name(): string {
    return this.playerInfo.name;
  }
  displayName(): string {
    return this.playerInfo.displayName;
  }

  clientID(): ClientID | null {
    return this.playerInfo.clientID;
  }

  id(): PlayerID {
    return this.playerInfo.id;
  }

  type(): PlayerType {
    return this.playerInfo.playerType;
  }

  units(...types: UnitType[]): Unit[] {
    const len = types.length;
    if (len === 0) {
      return this._units;
    }

    // Fast paths for common small arity calls to avoid Set allocation.
    if (len === 1) {
      const t0 = types[0]!;
      const out: Unit[] = [];
      for (const u of this._units) {
        if (u.type() === t0) out.push(u);
      }
      return out;
    }

    if (len === 2) {
      const t0 = types[0]!;
      const t1 = types[1]!;
      if (t0 === t1) {
        const out: Unit[] = [];
        for (const u of this._units) {
          if (u.type() === t0) out.push(u);
        }
        return out;
      }
      const out: Unit[] = [];
      for (const u of this._units) {
        const t = u.type();
        if (t === t0 || t === t1) out.push(u);
      }
      return out;
    }

    if (len === 3) {
      const t0 = types[0]!;
      const t1 = types[1]!;
      const t2 = types[2]!;
      // Keep semantics identical for duplicates in types by using direct comparisons.
      const out: Unit[] = [];
      for (const u of this._units) {
        const t = u.type();
        if (t === t0 || t === t1 || t === t2) out.push(u);
      }
      return out;
    }

    const ts = new Set(types);
    const out: Unit[] = [];
    for (const u of this._units) {
      if (ts.has(u.type())) out.push(u);
    }
    return out;
  }

  private numUnitsConstructed: Partial<Record<UnitType, number>> = {};
  private recordUnitConstructed(type: UnitType): void {
    if (this.numUnitsConstructed[type] !== undefined) {
      this.numUnitsConstructed[type]++;
    } else {
      this.numUnitsConstructed[type] = 1;
    }
  }

  // Count of units built by the player, including those still under
  // construction. recordUnitConstructed() is called in buildUnit() the moment a
  // unit is created (while still under construction), so numUnitsConstructed
  // already accounts for in-progress builds — don't re-count them.
  unitsConstructed(type: UnitType): number {
    return this.numUnitsConstructed[type] ?? 0;
  }

  // Count of units owned by the player, not including construction
  unitCount(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        total += unit.level();
      }
    }
    return total;
  }

  // Count of units owned by the player, including construction
  unitsOwned(type: UnitType): number {
    let total = 0;
    for (const unit of this._units) {
      if (unit.type() === type) {
        if (unit.isUnderConstruction()) {
          total++;
        } else {
          total += unit.level();
        }
      }
    }
    return total;
  }

  sharesBorderWith(other: Player | TerraNullius): boolean {
    for (const border of this._borderTiles) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (this.mg.map().ownerID(neighbor) === other.smallID()) {
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

  nearby(): (Player | TerraNullius)[] {
    const ns: Set<Player | TerraNullius> = new Set();
    for (const border of this.borderTiles()) {
      for (const neighbor of this.mg.map().neighbors(border)) {
        if (
          this.mg.map().isLand(neighbor) &&
          !this.mg.map().isImpassable(neighbor)
        ) {
          const owner = this.mg.map().ownerID(neighbor);
          if (owner !== this.smallID()) {
            ns.add(
              this.mg.playerBySmallID(owner) satisfies Player | TerraNullius,
            );
          }
        }
      }
    }
    for (const n of this.shoreReachableNeighbors()) {
      ns.add(n);
    }
    return Array.from(ns);
  }

  // Samples every 10th border tile for shore tiles, checks the tile 5 steps
  // away in each cardinal direction that immediately enters water, to detect
  // players separated by a small river (up to 4 water tiles wide)
  private shoreReachableNeighbors(): Set<Player | TerraNullius> {
    const ns: Set<Player | TerraNullius> = new Set();
    const map = this.mg.map();
    const shores = Array.from(this.borderTiles()).filter((t) => map.isShore(t));
    const directions: [number, number][] = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];

    for (let i = 0; i < shores.length; i += 10) {
      const border = shores[i];

      const bx = map.x(border);
      const by = map.y(border);

      for (const [dx, dy] of directions) {
        // Only follow directions that immediately enter water; land-adjacent
        // directions are already covered by the direct neighbors() loop.
        const x1 = bx + dx;
        const y1 = by + dy;
        if (!map.isValidCoord(x1, y1) || !map.isWater(map.ref(x1, y1)))
          continue;

        const nx = bx + dx * 5;
        const ny = by + dy * 5;
        if (!map.isValidCoord(nx, ny)) continue;
        const tile = map.ref(nx, ny);
        if (!map.isLand(tile)) continue;
        if (map.isImpassable(tile)) continue;
        if (!map.hasOwner(tile) && map.hasFallout(tile)) continue;
        const owner = map.ownerID(tile);
        if (owner !== this.smallID()) {
          ns.add(
            this.mg.playerBySmallID(owner) satisfies Player | TerraNullius,
          );
        }
      }
    }

    return ns;
  }

  isPlayer(): this is Player {
    return true as const;
  }
  setTroops(troops: number) {
    this._troops = toInt(troops);
  }
  conquer(tile: TileRef) {
    this.mg.conquer(this, tile);
  }
  orderRetreat(id: string) {
    const attack = this._outgoingAttacks.find((attack) => attack.id() === id);
    if (!attack) {
      console.warn(`Didn't find outgoing attack with id ${id}`);
      return;
    }
    attack.orderRetreat();
  }
  executeRetreat(id: string): void {
    const attack = this._outgoingAttacks.find((attack) => attack.id() === id);
    // Execution is delayed so it's not an error that the attack does not exist.
    if (!attack) {
      return;
    }
    attack.executeRetreat();
  }
  relinquish(tile: TileRef) {
    if (this.mg.owner(tile) !== this) {
      throw new Error(`Cannot relinquish tile not owned by this player`);
    }
    this.mg.relinquish(tile);
  }
  info(): PlayerInfo {
    return this.playerInfo;
  }

  isLobbyCreator(): boolean {
    return this.playerInfo.isLobbyCreator;
  }

  isAlive(): boolean {
    return this._tiles.size > 0;
  }

  hasSpawned(): boolean {
    return this._spawnTile !== undefined;
  }

  setSpawnTile(spawnTile: TileRef): void {
    this._spawnTile = spawnTile;
  }

  spawnTile(): TileRef | undefined {
    return this._spawnTile;
  }

  incomingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.recipient() === this);
  }

  outgoingAllianceRequests(): AllianceRequest[] {
    return this.mg.allianceRequests.filter((ar) => ar.requestor() === this);
  }

  alliances(): MutableAlliance[] {
    return this._alliances;
  }

  expiredAlliances(): Alliance[] {
    return [...this._expiredAlliances];
  }

  allies(): Player[] {
    return this.alliances().map((a) => a.other(this));
  }

  isAlliedWith(other: Player): boolean {
    if (other === this) {
      return false;
    }
    return this.allianceWith(other) !== null;
  }

  allianceWith(other: Player): MutableAlliance | null {
    if (other === this) {
      return null;
    }
    return (
      this.alliances().find(
        (a) => a.recipient() === other || a.requestor() === other,
      ) ?? null
    );
  }

  allianceInfo(other: Player): AllianceInfo | null {
    const alliance = this.allianceWith(other);
    if (!alliance) {
      return null;
    }
    const inExtensionWindow =
      alliance.expiresAt() <=
      this.mg.ticks() + this.mg.config().allianceExtensionPromptOffset();
    const canExtend =
      !this.isDisconnected() &&
      !other.isDisconnected() &&
      this.isAlive() &&
      other.isAlive() &&
      inExtensionWindow &&
      !alliance.agreedToExtend(this);
    return {
      expiresAt: alliance.expiresAt(),
      inExtensionWindow,
      myPlayerAgreedToExtend: alliance.agreedToExtend(this),
      otherAgreedToExtend: alliance.agreedToExtend(other),
      canExtend,
    };
  }

  canSendAllianceRequest(other: Player): boolean {
    if (this.mg.config().disableAlliances()) {
      return false;
    }
    if (other === this) {
      return false;
    }
    if (this.isDisconnected() || other.isDisconnected()) {
      // Disconnected players are marked as not-friendly even if they are allies,
      // so we need to return early if either player is disconnected.
      // Otherwise we could end up sending an alliance request to someone
      // we are already allied with.
      return false;
    }
    if (this.isFriendly(other) || !this.isAlive()) {
      return false;
    }

    const hasPending = this.outgoingAllianceRequests().some(
      (ar) => ar.recipient() === other,
    );

    if (hasPending) {
      return false;
    }

    const hasIncoming = this.incomingAllianceRequests().some(
      (ar) => ar.requestor() === other,
    );

    if (hasIncoming) {
      return true;
    }

    const recent = this.pastOutgoingAllianceRequests
      .filter((ar) => ar.recipient() === other)
      .sort((a, b) => b.createdAt() - a.createdAt());

    if (recent.length === 0) {
      return true;
    }

    const delta = this.mg.ticks() - recent[0].createdAt();

    return delta >= this.mg.config().allianceRequestCooldown();
  }

  breakAlliance(alliance: MutableAlliance): void {
    this.mg.breakAlliance(this, alliance);
  }

  removeAllAlliances(): void {
    this.mg.removeAlliancesByPlayerSilently(this);
  }

  isTraitor(): boolean {
    return this.getTraitorRemainingTicks() > 0;
  }

  getTraitorRemainingTicks(): number {
    if (this.markedTraitorTick < 0) return 0;
    const elapsed = this.mg.ticks() - this.markedTraitorTick;
    const duration = this.mg.config().traitorDuration();
    const remaining = duration - elapsed;
    return remaining > 0 ? remaining : 0;
  }

  markTraitor(): void {
    this.markedTraitorTick = this.mg.ticks();
    this._betrayalCount++; // Keep count for Nations too

    // Record stats (only for real Humans)
    this.mg.stats().betray(this);
  }

  betrayals(): number {
    return this._betrayalCount;
  }

  createAllianceRequest(recipient: Player): AllianceRequest | null {
    if (this.isAlliedWith(recipient)) {
      throw new Error(`cannot create alliance request, already allies`);
    }
    return this.mg.createAllianceRequest(this, recipient satisfies Player);
  }

  relation(other: Player): Relation {
    if (other === this) {
      throw new Error(`cannot get relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
    return this.relationFromValue(relation);
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
      .filter((r) => r.player.isAlive())
      .sort((a, b) => a.relation - b.relation)
      .map((r) => ({
        player: r.player,
        relation: this.relationFromValue(r.relation),
      }));
  }

  updateRelation(other: Player, delta: number): void {
    if (other === this) {
      throw new Error(`cannot update relation with self: ${this}`);
    }
    const relation = this.relations.get(other) ?? 0;
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
    if (this === other) {
      return false;
    }
    if (this.isFriendly(other)) {
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

  targets(): Player[] {
    return this.targets_
      .filter(
        (t) => this.mg.ticks() - t.tick < this.mg.config().targetDuration(),
      )
      .map((t) => t.target);
  }

  transitiveTargets(): Player[] {
    const ts = this.alliances()
      .map((a) => a.other(this))
      .flatMap((ally) => ally.targets());
    ts.push(...this.targets());
    return [...new Set(ts)] satisfies Player[];
  }

  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void {
    if (recipient === this) {
      throw Error(`Cannot send emoji to oneself: ${this}`);
    }
    const msg: EmojiMessage = {
      message: emoji,
      senderID: this.smallID(),
      recipientID: recipient === AllPlayers ? recipient : recipient.smallID(),
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
    if (recipient === this) {
      return false;
    }
    const recipientID =
      recipient === AllPlayers ? AllPlayers : recipient.smallID();
    const prevMsgs = this.outgoingEmojis_.filter(
      (msg) => msg.recipientID === recipientID,
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

  canSendQuickChat(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    const lastSentAt = this.outgoingQuickChats_.get(recipient.smallID());
    return (
      lastSentAt === undefined ||
      this.mg.ticks() - lastSentAt >= this.mg.config().quickChatCooldown()
    );
  }

  recordQuickChat(recipient: Player): void {
    this.outgoingQuickChats_.set(recipient.smallID(), this.mg.ticks());
  }

  canDonateGold(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    if (
      !this.isAlive() ||
      !recipient.isAlive() ||
      !this.isFriendly(recipient)
    ) {
      return false;
    }
    if (
      recipient.type() === PlayerType.Human &&
      this.mg.config().donateGold() === false
    ) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient === recipient) {
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

  canDonateTroops(recipient: Player): boolean {
    if (recipient === this) {
      return false;
    }
    if (
      !this.isAlive() ||
      !recipient.isAlive() ||
      !this.isFriendly(recipient)
    ) {
      return false;
    }
    if (
      recipient.type() === PlayerType.Human &&
      this.mg.config().donateTroops() === false
    ) {
      return false;
    }
    for (const donation of this.sentDonations) {
      if (donation.recipient === recipient) {
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

  donateTroops(recipient: Player, troops: number): boolean {
    // Defense-in-depth: canDonateTroops already checks this, but guard here too
    // to prevent self-donation if the method is called directly.
    if (recipient === this) return false;
    if (troops <= 0) return false;
    const removed = this.removeTroops(troops);
    if (removed === 0) return false;
    recipient.addTroops(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.addUpdate({
      type: GameUpdateType.DonateEvent,
      donationType: "troops",
      senderId: this.id(),
      recipientId: recipient.id(),
      amount: BigInt(removed),
    });
    return true;
  }

  donateGold(recipient: Player, gold: Gold): boolean {
    // Defense-in-depth: canDonateGold already checks this, but guard here too
    // to prevent self-donation if the method is called directly.
    if (recipient === this) return false;
    if (gold <= 0n) return false;
    const removed = this.removeGold(gold);
    if (removed === 0n) return false;
    recipient.addGold(removed);

    this.sentDonations.push(new Donation(recipient, this.mg.ticks()));
    this.mg.addUpdate({
      type: GameUpdateType.DonateEvent,
      donationType: "gold",
      senderId: this.id(),
      recipientId: recipient.id(),
      amount: removed,
    });
    return true;
  }

  canDeleteUnit(): boolean {
    return (
      this.mg.ticks() - this.lastDeleteUnitTick >=
      this.mg.config().deleteUnitCooldown()
    );
  }

  recordDeleteUnit(): void {
    this.lastDeleteUnitTick = this.mg.ticks();
  }

  canEmbargoAll(): boolean {
    // Cooldown gate
    if (
      this.mg.ticks() - this.lastEmbargoAllTick <
      this.mg.config().embargoAllCooldown()
    ) {
      return false;
    }
    // At least one eligible player exists
    for (const p of this.mg.players()) {
      if (p.id() === this.id()) continue;
      if (p.type() === PlayerType.Bot) continue;
      if (this.isOnSameTeam(p)) continue;
      return true;
    }
    return false;
  }

  recordEmbargoAll(): void {
    this.lastEmbargoAllTick = this.mg.ticks();
  }

  hasEmbargoAgainst(other: Player): boolean {
    return this.embargoes.has(other.id());
  }

  canTrade(other: Player): boolean {
    const embargo =
      other.hasEmbargoAgainst(this) || this.hasEmbargoAgainst(other);
    return !embargo && other.id() !== this.id();
  }

  getEmbargoes(): Embargo[] {
    return [...this.embargoes.values()];
  }

  addEmbargo(other: Player, isTemporary: boolean): void {
    const embargo = this.embargoes.get(other.id());
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.mg.addUpdate({
      type: GameUpdateType.EmbargoEvent,
      event: "start",
      playerID: this.smallID(),
      embargoedID: other.smallID(),
    });

    this.embargoes.set(other.id(), {
      createdAt: this.mg.ticks(),
      isTemporary: isTemporary,
      target: other,
    });
  }

  stopEmbargo(other: Player): void {
    this.embargoes.delete(other.id());
    this.mg.addUpdate({
      type: GameUpdateType.EmbargoEvent,
      event: "stop",
      playerID: this.smallID(),
      embargoedID: other.smallID(),
    });
  }

  endTemporaryEmbargo(other: Player): void {
    const embargo = this.embargoes.get(other.id());
    if (embargo !== undefined && !embargo.isTemporary) return;

    this.stopEmbargo(other);
  }

  tradingPartners(): Player[] {
    return this.mg
      .players()
      .filter((other) => other !== this && this.canTrade(other));
  }

  team(): Team | null {
    return this._team;
  }

  isOnSameTeam(other: Player): boolean {
    if (other === this) {
      return false;
    }
    if (this.team() === null || other.team() === null) {
      return false;
    }
    if (this.team() === ColoredTeams.Bot || other.team() === ColoredTeams.Bot) {
      return false;
    }
    return this._team === other.team();
  }

  isFriendly(other: Player, treatAFKFriendly: boolean = false): boolean {
    if (other === this) {
      return true;
    }
    if (other.isDisconnected() && !treatAFKFriendly) {
      return false;
    }
    return this.isOnSameTeam(other) || this.isAlliedWith(other);
  }

  gold(): Gold {
    return this._gold;
  }

  addGold(toAdd: Gold, tile?: TileRef): void {
    this._gold += toAdd;
    if (tile) {
      this.mg.addUpdate({
        type: GameUpdateType.BonusEvent,
        player: this.id(),
        tile,
        gold: Number(toAdd),
        troops: 0,
      });
    }
  }

  removeGold(toRemove: Gold): Gold {
    if (toRemove <= 0n) {
      return 0n;
    }
    const actualRemoved = minInt(this._gold, toRemove);
    this._gold -= actualRemoved;
    return actualRemoved;
  }

  troops(): number {
    return Number(this._troops);
  }

  addTroops(troops: number): void {
    if (troops < 0) {
      this.removeTroops(-1 * troops);
      return;
    }
    this._troops += toInt(troops);
  }
  removeTroops(troops: number): number {
    if (troops <= 0) {
      return 0;
    }
    const toRemove = minInt(this._troops, toInt(troops));
    this._troops -= toRemove;
    return Number(toRemove);
  }

  captureUnit(unit: Unit): void {
    if (unit.owner() === this) {
      throw new Error(`Cannot capture unit, ${this} already owns ${unit}`);
    }
    unit.setOwner(this);
  }

  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit {
    if (this.mg.config().isUnitDisabled(type)) {
      throw new Error(
        `Attempted to build disabled unit ${type} at tile ${spawnTile} by player ${this.name()}`,
      );
    }

    const cost = this.mg.unitInfo(type).cost(this.mg, this);
    const b = new UnitImpl(
      type,
      this.mg,
      spawnTile,
      this.mg.nextUnitID(),
      this,
      params,
    );
    this._units.push(b);
    this.recordUnitConstructed(type);
    this.removeGold(cost);
    this.removeTroops("troops" in params ? (params.troops ?? 0) : 0);
    this.mg.addUpdate(b.toUpdate());
    this.mg.addUnit(b);

    return b;
  }

  public findUnitToUpgrade(type: UnitType, targetTile: TileRef): Unit | false {
    const unit = this.findExistingUnitToUpgrade(type, targetTile);
    if (unit === false || !this.canUpgradeUnit(unit)) {
      return false;
    }
    return unit;
  }

  private findExistingUnitToUpgrade(
    type: UnitType,
    targetTile: TileRef,
  ): Unit | false {
    const closest = findClosestBy(
      this.mg.nearbyUnits(
        targetTile,
        this.mg.config().structureMinDist(),
        type,
        undefined,
        true,
      ),
      (entry) => entry.distSquared,
    );

    return closest?.unit ?? false;
  }

  private canBuildUnitType(
    unitType: UnitType,
    knownCost: Gold | null = null,
  ): boolean {
    if (this.mg.config().isUnitDisabled(unitType)) {
      return false;
    }
    const cost = knownCost ?? this.mg.unitInfo(unitType).cost(this.mg, this);
    if (this._gold < cost) {
      return false;
    }
    if (unitType !== UnitType.MIRVWarhead && !this.isAlive()) {
      return false;
    }
    return true;
  }

  private canUpgradeUnitType(unitType: UnitType): boolean {
    return Boolean(this.mg.config().unitInfo(unitType).upgradable);
  }

  private isUnitValidToUpgrade(unit: Unit): boolean {
    if (unit.isUnderConstruction()) {
      return false;
    }
    if (unit.isMarkedForDeletion()) {
      return false;
    }
    if (unit.owner() !== this) {
      return false;
    }
    return true;
  }

  public canUpgradeUnit(unit: Unit): boolean {
    if (!this.canUpgradeUnitType(unit.type())) {
      return false;
    }
    if (!this.canBuildUnitType(unit.type())) {
      return false;
    }
    if (!this.isUnitValidToUpgrade(unit)) {
      return false;
    }
    return true;
  }

  upgradeUnit(unit: Unit) {
    const cost = this.mg.unitInfo(unit.type()).cost(this.mg, this);
    this.removeGold(cost);
    unit.increaseLevel();
    this.recordUnitConstructed(unit.type());
  }

  public buildableUnits(
    tile: TileRef | null,
    units: readonly PlayerBuildableUnitType[] = PlayerBuildable.types,
  ): BuildableUnit[] {
    const mg = this.mg;
    const config = mg.config();
    const rail = mg.railNetwork();
    const inSpawnPhase = mg.inSpawnPhase();

    const validTiles =
      tile !== null && units.some((u) => Structures.has(u))
        ? this.validStructureSpawnTiles(tile)
        : [];

    const len = units.length;
    const result = new Array<BuildableUnit>(len);

    for (let i = 0; i < len; i++) {
      const u = units[i];

      const cost = config.unitInfo(u).cost(mg, this);
      let canUpgrade: number | false = false;
      let canBuild: TileRef | false = false;

      if (tile !== null && this.canBuildUnitType(u, cost) && !inSpawnPhase) {
        if (this.canUpgradeUnitType(u)) {
          const existingUnit = this.findExistingUnitToUpgrade(u, tile);
          if (
            existingUnit !== false &&
            this.isUnitValidToUpgrade(existingUnit)
          ) {
            canUpgrade = existingUnit.id();
          }
        }
        canBuild = this.canSpawnUnitType(u, tile, validTiles);
      }

      const buildNew = canBuild !== false && canUpgrade === false;

      result[i] = {
        type: u,
        canBuild,
        canUpgrade,
        cost,
        overlappingRailroads: buildNew
          ? rail.overlappingRailroads(u, canBuild as TileRef)
          : [],
        ghostRailPaths: buildNew
          ? rail.computeGhostRailPaths(u, canBuild as TileRef)
          : [],
      };
    }

    return result;
  }

  canBuild(
    unitType: UnitType,
    targetTile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    if (!this.canBuildUnitType(unitType)) {
      return false;
    }

    return this.canSpawnUnitType(unitType, targetTile, validTiles);
  }

  private canSpawnUnitType(
    unitType: UnitType,
    targetTile: TileRef,
    validTiles: TileRef[] | null,
  ): TileRef | false {
    switch (unitType) {
      case UnitType.MIRV:
        if (!this.mg.hasOwner(targetTile)) {
          return false;
        }
        return this.nukeSpawn(targetTile, unitType);
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
        return this.nukeSpawn(targetTile, unitType);
      case UnitType.MIRVWarhead:
        return targetTile;
      case UnitType.Port:
        return this.portSpawn(targetTile, validTiles);
      case UnitType.Warship:
        return this.warshipSpawn(targetTile);
      case UnitType.Shell:
      case UnitType.SAMMissile:
        return targetTile;
      case UnitType.TransportShip:
        return canBuildTransportShip(this.mg, this, targetTile);
      case UnitType.TradeShip:
        return this.tradeShipSpawn(targetTile);
      case UnitType.Train:
        return this.landBasedUnitSpawn(targetTile);
      case UnitType.MissileSilo:
      case UnitType.DefensePost:
      case UnitType.SAMLauncher:
      case UnitType.City:
      case UnitType.Factory:
        return this.landBasedStructureSpawn(targetTile, validTiles);
      default:
        assertNever(unitType);
    }
  }

  nukeSpawn(tile: TileRef, nukeType: UnitType): TileRef | false {
    const mg = this.mg;
    if (mg.isSpawnImmunityActive()) {
      return false;
    }
    // Impassable terrain cannot be nuked.
    if (mg.isImpassable(tile)) {
      return false;
    }
    const owner = this.mg.owner(tile);
    // Allow nuking teammates after the game is over (aftergame fun)
    const gameOver = mg.getWinner() !== null;
    if (owner.isPlayer()) {
      if (this.isOnSameTeam(owner) && !gameOver) {
        return false;
      }
    }
    const config = mg.config();

    // Prevent launching nukes that would hit teammate structures (only in team games).
    // Disabled after game-over so players can nuke teammates in the aftergame.
    if (
      config.gameConfig().gameMode === GameMode.Team &&
      nukeType !== UnitType.MIRV &&
      !gameOver
    ) {
      const magnitude = config.nukeMagnitudes(nukeType);
      const wouldHitTeammate = mg.anyUnitNearby(
        tile,
        magnitude.outer,
        Structures.types,
        (unit) => unit.owner().isPlayer() && this.isOnSameTeam(unit.owner()),
      );
      if (wouldHitTeammate) {
        return false;
      }
    }

    // only get missilesilos that are not on cooldown and not under construction
    const bestSilo = findClosestBy(
      this.units(UnitType.MissileSilo),
      (silo) => mg.manhattanDist(silo.tile(), tile),
      (silo) =>
        silo.isActive() && !silo.isInCooldown() && !silo.isUnderConstruction(),
    );

    return bestSilo?.tile() ?? false;
  }

  portSpawn(tile: TileRef, validTiles: TileRef[] | null): TileRef | false {
    const spawns = Array.from(
      this.mg.bfs(
        tile,
        manhattanDistFN(tile, this.mg.config().radiusPortSpawn()),
      ),
    )
      .filter((t) => this.mg.owner(t) === this && this.mg.isShore(t))
      .sort(
        (a, b) =>
          this.mg.manhattanDist(a, tile) - this.mg.manhattanDist(b, tile),
      );
    const validTileSet = new Set(
      validTiles ?? this.validStructureSpawnTiles(tile),
    );
    for (const t of spawns) {
      if (validTileSet.has(t)) {
        return t;
      }
    }
    return false;
  }

  warshipSpawn(tile: TileRef): TileRef | false {
    if (!this.mg.isWater(tile)) {
      return false;
    }

    const tileComponent = this.mg.getWaterComponent(tile);
    const bestPort = findClosestBy(
      this.units(UnitType.Port),
      (port) => this.mg.manhattanDist(port.tile(), tile),
      (port) =>
        port.isActive() &&
        !port.isUnderConstruction() &&
        tileComponent !== null &&
        this.mg.hasWaterComponent(port.tile(), tileComponent),
    );

    return bestPort?.tile() ?? false;
  }

  landBasedUnitSpawn(tile: TileRef): TileRef | false {
    return this.mg.isLand(tile) && !this.mg.isImpassable(tile) ? tile : false;
  }

  landBasedStructureSpawn(
    tile: TileRef,
    validTiles: TileRef[] | null = null,
  ): TileRef | false {
    const tiles = validTiles ?? this.validStructureSpawnTiles(tile);
    if (tiles.length === 0) {
      return false;
    }
    return tiles[0];
  }

  private validStructureSpawnTiles(tile: TileRef): TileRef[] {
    if (this.mg.owner(tile) !== this) {
      return [];
    }
    const searchRadius = 15;
    const searchRadiusSquared = searchRadius ** 2;

    const nearbyUnits = this.mg.nearbyUnits(
      tile,
      searchRadius * 2,
      Structures.types,
      undefined,
      true,
    );
    const nearbyTiles = this.mg.bfs(tile, (gm, t) => {
      return (
        this.mg.euclideanDistSquared(tile, t) < searchRadiusSquared &&
        gm.ownerID(t) === this.smallID()
      );
    });
    const validSet: Set<TileRef> = new Set(nearbyTiles);

    const minDistSquared = this.mg.config().structureMinDist() ** 2;
    for (const t of nearbyTiles) {
      for (const { unit } of nearbyUnits) {
        if (this.mg.euclideanDistSquared(unit.tile(), t) < minDistSquared) {
          validSet.delete(t);
          break;
        }
      }
    }
    const valid = Array.from(validSet);
    valid.sort(
      (a, b) =>
        this.mg.euclideanDistSquared(a, tile) -
        this.mg.euclideanDistSquared(b, tile),
    );
    return valid;
  }

  tradeShipSpawn(targetTile: TileRef): TileRef | false {
    return this.units(UnitType.Port).find((u) => u.tile() === targetTile)
      ? targetTile
      : false;
  }
  lastTileChange(): Tick {
    return this._lastTileChange;
  }

  isDisconnected(): boolean {
    return this._isDisconnected;
  }

  markDisconnected(isDisconnected: boolean): void {
    this._isDisconnected = isDisconnected;
  }

  hash(): number {
    return (
      simpleHash(this.id()) * (this.troops() + this.numTilesOwned()) +
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

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack {
    const attack = new AttackImpl(
      this._pseudo_random.nextID(),
      target,
      this,
      troops,
      sourceTile,
      border,
      this.mg,
    );
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
    return this._incomingAttacks.filter((a) => a.attacker().isAlive());
  }

  public isImmune(): boolean {
    if (this.type() === PlayerType.Human) {
      return this.mg.isSpawnImmunityActive();
    }
    if (this.type() === PlayerType.Nation) {
      return this.mg.isNationSpawnImmunityActive();
    }
    return false;
  }

  public canAttackPlayer(
    player: Player,
    treatAFKFriendly: boolean = false,
  ): boolean {
    if (this.type() !== PlayerType.Human) {
      // Only human attackers respect PVP immunity
      return !this.isFriendly(player, treatAFKFriendly);
    }
    return !player.isImmune() && !this.isFriendly(player, treatAFKFriendly);
  }

  public canAttack(tile: TileRef): boolean {
    const owner = this.mg.owner(tile);
    if (owner === this) {
      return false;
    }

    if (owner.isPlayer() && !this.canAttackPlayer(owner)) {
      return false;
    }

    if (!this.mg.isLand(tile) || this.mg.isImpassable(tile)) {
      return false;
    }
    if (this.mg.hasOwner(tile)) {
      return this.sharesBorderWith(owner);
    } else {
      for (const t of this.mg.bfs(
        tile,
        andFN(
          (gm, t) => !gm.hasOwner(t) && gm.isLand(t) && !gm.isImpassable(t),
          manhattanDistFN(tile, 200),
        ),
      )) {
        for (const n of this.mg.neighbors(t)) {
          if (this.mg.owner(n) === this) {
            return true;
          }
        }
      }
      return false;
    }
  }

  bestTransportShipSpawn(targetTile: TileRef): TileRef | false {
    return bestShoreDeploymentSource(this.mg, this, targetTile) ?? false;
  }
}
