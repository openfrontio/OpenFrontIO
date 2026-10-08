import { GameMap, TileRef } from "@openfront/engine-api/game/GameMap";
import {
  AllianceInfo,
  AllPlayers,
  BuildableUnit,
  Cell,
  Difficulty,
  EmojiMessage,
  GameUpdates,
  Gold,
  MessageType,
  Nation,
  NukeState,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Relation,
  SamLauncherState,
  SpawnArea,
  Team,
  TerraNullius,
  Tick,
  TrainType,
  TrajectoryTile,
  TransportShipState,
  UnitInfo,
  UnitType,
  WarshipState,
} from "@openfront/engine-api/game/GameTypes";
import {
  AllianceRequestUpdate,
  GameUpdate,
  PlayerUpdate,
  UnitUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import {
  GameLike,
  PlayerLike,
  ReadonlyTileSet,
  UnitLike,
  UnitPredicate,
} from "@openfront/engine-api/game/ReadViews";
import {
  AllPlayersStats,
  ClientID,
  GameID,
} from "@openfront/engine-api/Schemas";
import { MotionPlanRecord } from "@openfront/engine-lib/game/MotionPlans";
import type { EngineConfig } from "../configuration/EngineConfig";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { PathFinder } from "../pathfinding/types";
import type { ExecRecord, SnapshotWriter } from "../snapshot/SnapshotContext";
import { RailNetwork } from "./RailNetwork";
import { Stats } from "./Stats";

export interface OwnerComp {
  owner: Player;
}

export interface UnitParamsMap {
  [UnitType.TransportShip]: {
    troops?: number;
    targetTile?: TileRef;
  };

  [UnitType.Warship]: {
    patrolTile: TileRef;
  };

  [UnitType.Shell]: Record<string, never>;

  [UnitType.SAMMissile]: {
    targetUnit: Unit;
  };

  [UnitType.Port]: Record<string, never>;

  [UnitType.AtomBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.HydrogenBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.MIRV]: {
    targetTile?: number;
    targetPlayer?: Player | TerraNullius;
  };

  [UnitType.MIRVWarhead]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.TradeShip]: {
    targetUnit: Unit;
    lastSetSafeFromPirates?: number;
  };

  [UnitType.Train]: {
    trainType: TrainType;
    targetUnit?: Unit;
    loaded?: boolean;
  };

  [UnitType.Factory]: Record<string, never>;

  [UnitType.MissileSilo]: Record<string, never>;

  [UnitType.DefensePost]: Record<string, never>;

  [UnitType.SAMLauncher]: Record<string, never>;

  [UnitType.City]: Record<string, never>;
}

// Type helper to get params type for a specific unit type
export type UnitParams<T extends UnitType> = UnitParamsMap[T];

export type AllUnitParams = UnitParamsMap[keyof UnitParamsMap];

export interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
  /**
   * Serializes this execution for a game snapshot (see
   * packages/engine/src/snapshot/README.md). Every class registers an
   * ExecutionSnapshotType in snapshot/ExecutionRegistry.ts.
   */
  snapshot(w: SnapshotWriter): ExecRecord;
}

export interface Attack {
  id(): string;
  retreating(): boolean;
  retreated(): boolean;
  orderRetreat(): void;
  executeRetreat(): void;
  target(): Player | TerraNullius;
  attacker(): Player;
  troops(): number;
  setTroops(troops: number): void;
  isActive(): boolean;
  delete(): void;
  // The tile the attack originated from, mostly used for boat attacks.
  sourceTile(): TileRef | null;
  addBorderTile(tile: TileRef): void;
  removeBorderTile(tile: TileRef): void;
  clearBorder(): void;
  borderSize(): number;
  clusteredPositions(): TileRef[];
}

export interface AllianceRequest {
  accept(): void;
  reject(): void;
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  status(): "pending" | "accepted" | "rejected";
  toUpdate(): AllianceRequestUpdate;
}

export interface Alliance {
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  expiresAt(): Tick;
  other(player: Player): Player;
}

export interface MutableAlliance extends Alliance {
  expire(): void;
  other(player: Player): Player;
  bothAgreedToExtend(): boolean;
  addExtensionRequest(player: Player): void;
  id(): number;
  extend(): void;
  onlyOneAgreedToExtend(): boolean;

  agreedToExtend(player: Player): boolean;
}

export function isUnit(unit: unknown): unit is Unit {
  return (
    unit &&
    typeof unit === "object" &&
    "isUnit" in unit &&
    typeof unit.isUnit === "function" &&
    unit.isUnit()
  );
}

export interface EngineUnitInfo extends UnitInfo {
  // extraUnits shifts the cost curve as if the player already had that many
  // additional units/levels — used to price the later steps of a bulk upgrade.
  cost: (game: Game, player: Player, extraUnits?: number) => Gold;
}

export interface Unit extends UnitLike {
  isUnit(): this is Unit;

  // Common properties.
  id(): number;
  type(): UnitType;
  owner(): Player;
  info(): EngineUnitInfo;
  isMarkedForDeletion(): boolean;
  markForDeletion(): void;
  isOverdueDeletion(): boolean;
  delete(displayMessage?: boolean, destroyer?: Player): void;
  tile(): TileRef;
  lastTile(): TileRef;
  move(tile: TileRef): void;
  isActive(): boolean;
  setOwner(owner: Player): void;
  touch(): void;
  hash(): number;
  toUpdate(): UnitUpdate;
  hasTrainStation(): boolean;
  setTrainStation(trainStation: boolean): void;
  wasDestroyedByEnemy(): boolean;
  destroyer(): Player | undefined;

  // Train
  trainType(): TrainType | undefined;
  isLoaded(): boolean | undefined;
  setLoaded(loaded: boolean): void;

  // Targeting
  setTargetTile(cell: TileRef | undefined): void;
  targetTile(): TileRef | undefined;
  targetPlayer(): Player | TerraNullius | undefined;
  setTrajectoryIndex(i: number): void;
  trajectoryIndex(): number;
  trajectory(): TrajectoryTile[];
  setTargetUnit(unit: Unit | undefined): void;
  targetUnit(): Unit | undefined;
  setTargetedBySAM(targeted: boolean): void;
  targetedBySAM(): boolean;
  setReachedTarget(): void;
  reachedTarget(): boolean;
  isTargetable(): boolean;
  setTargetable(targetable: boolean): void;

  // Health
  hasHealth(): boolean;
  warshipState(): WarshipState;
  updateWarshipState(update: Partial<WarshipState>): void;
  transportShipState(): TransportShipState;
  updateTransportShipState(update: Partial<TransportShipState>): void;
  nukeState(): NukeState;
  updateNukeState(update: Partial<NukeState>): void;

  health(): number;
  /** Effective max health, including any warship veterancy bonus. */
  maxHealth(): number;
  modifyHealth(delta: number, attacker?: Player): void;

  // Warship veterancy
  /** Current veterancy level from warshipState (0 for non-warships). */
  veterancy(): number;
  /** Record this warship destroying an enemy unit (drives veterancy gain). */
  recordKill(targetType: UnitType): void;
  /** Record this warship capturing a trade ship (drives veterancy gain). */
  recordTradeCapture(): void;

  // Troops
  setTroops(troops: number): void;
  troops(): number;

  // --- UNIT SPECIFIC ---

  // SAMs & Missile Silos
  launch(): void;
  reloadMissile(): void;
  isInCooldown(): boolean;
  missileTimerQueue(): number[];
  samLauncherState(): SamLauncherState | undefined;

  // Trade Ships
  setSafeFromPirates(): void; // Only for trade ships
  isSafeFromPirates(): boolean; // Only for trade ships

  // Construction phase on structures
  isUnderConstruction(): boolean;
  setUnderConstruction(underConstruction: boolean): void;

  // Upgradable Structures
  level(): number;
  increaseLevel(): void;
  decreaseLevel(destroyer?: Player): void;
}

export interface Embargo {
  createdAt: Tick;
  isTemporary: boolean;
  target: Player;
}

export interface DisconnectSnapshot {
  currentTick: number;
  teamTiles: number;
  totalLand: number;
  wasAlive: boolean;
}

export interface Player extends PlayerLike {
  // Basic Info
  smallID(): number;
  info(): PlayerInfo;
  setPlayerInfo(info: PlayerInfo): void;
  name(): string;
  displayName(): string;
  clanTag(): string | null;
  clientID(): ClientID | null;
  id(): PlayerID;
  type(): PlayerType;
  isPlayer(): this is Player;
  toString(): string;
  isLobbyCreator(): boolean;

  // State & Properties
  isAlive(): boolean;
  isTraitor(): boolean;
  markTraitor(): void;
  // Doomsday Clock (anti-stall): marked when below the rising territory bar.
  inDoomsdayClock(): boolean;
  /** Territory is actively rotting away (the final doomsday phase). */
  isDecaying(): boolean;
  markRotted(): void;
  doomsdayClockTicks(): number;
  enterDoomsdayClock(): void;
  clearDoomsdayClock(): void;
  largestClusterBoundingBox: { min: Cell; max: Cell } | null;
  lastTileChange(): Tick;
  /** Counter bumped on every ownership change of one of this player's tiles (also when its border set can change). */
  tileChangeVersion(): number;

  isDisconnected(): boolean;
  markDisconnected(
    isDisconnected: boolean,
    snapshot?: DisconnectSnapshot,
  ): void;
  disconnectSnapshot(): DisconnectSnapshot | null;
  disconnectedAtTick(): number | null;

  hasSpawned(): boolean;
  setSpawnTile(spawnTile: TileRef): void;
  spawnTile(): TileRef | undefined;

  // Territory
  tiles(): ReadonlyTileSet;
  borderTiles(): ReadonlyTileSet;
  numTilesOwned(): number;
  conquer(tile: TileRef): void;
  relinquish(tile: TileRef): void;

  // Resources & Troops
  gold(): Gold;
  addGold(toAdd: Gold, tile?: TileRef): void;
  removeGold(toRemove: Gold): Gold;

  // Cumulative trade revenue, surfaced on the live PlayerUpdate so clients can
  // compute per-source gold rates (leaderboard "Ship/Train Trade Gold/min").
  // Mirrors StatsSchemas GOLD_INDEX_TRADE / GOLD_INDEX_TRAIN_* semantics.
  tradeGold(): Gold;
  addTradeGold(toAdd: Gold): void;
  trainGold(): Gold;
  addTrainGold(toAdd: Gold): void;

  // Cumulative piracy revenue (captured trade ships; GOLD_INDEX_STEAL).
  piracyGold(): Gold;
  addPiracyGold(toAdd: Gold): void;

  // Cumulative gold received from ALL sources (workers, trade, trains,
  // piracy, conquest, donations). Incremented inside addGold(); surfaced on
  // the live PlayerUpdate for the leaderboard "Gold Income/min" column.
  goldEarned(): Gold;
  troops(): number;
  setTroops(troops: number): void;
  addTroops(troops: number): void;
  removeTroops(troops: number): number;

  // Units
  // Fixed-arity + array overloads instead of a rest parameter: the rest array
  // would be allocated on every call, and this is one of the hottest calls in
  // the simulation. With no arguments the player's live unit array is
  // returned — do not mutate it; typed queries return a fresh snapshot array.
  units(): Unit[];
  units(types: readonly UnitType[]): Unit[];
  units(type: UnitType, type2?: UnitType, type3?: UnitType): Unit[];
  unitCount(type: UnitType): number;
  unitsConstructed(type: UnitType): number;
  unitsOwned(type: UnitType): number;
  buildableUnits(
    tile: TileRef | null,
    units?: readonly PlayerBuildableUnitType[],
  ): BuildableUnit[];
  canBuild(
    type: UnitType,
    targetTile: TileRef,
    validTiles?: TileRef[] | null,
  ): TileRef | false;
  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
  ): Unit;

  // Returns the existing unit that can be upgraded,
  // or false if it cannot be upgraded.
  // New units of the same type can upgrade existing units.
  // e.g. if a place a new city here, can it upgrade an existing city?
  findUnitToUpgrade(type: UnitType, targetTile: TileRef): Unit | false;
  canUpgradeUnit(unit: Unit): boolean;
  upgradeUnit(unit: Unit): void;
  captureUnit(unit: Unit): void;

  // Relations & Diplomacy
  nearby(): (Player | TerraNullius)[];
  sharesBorderWith(other: Player | TerraNullius): boolean;
  relation(other: Player): Relation;
  allRelationsSorted(): { player: Player; relation: Relation }[];
  updateRelation(other: Player, delta: number): void;
  decayRelations(): void;
  isOnSameTeam(other: Player): boolean;
  // Either allied or on same team.
  isFriendly(other: Player, treatAFKFriendly?: boolean): boolean;
  team(): Team | null;
  incomingAllianceRequests(): AllianceRequest[];
  outgoingAllianceRequests(): AllianceRequest[];
  alliances(): MutableAlliance[];
  expiredAlliances(): Alliance[];
  allies(): Player[];
  isAlliedWith(other: Player): boolean;
  allianceWith(other: Player): MutableAlliance | null;
  allianceInfo(other: Player): AllianceInfo | null;
  canSendAllianceRequest(other: Player): boolean;
  breakAlliance(alliance: Alliance): void;
  removeAllAlliances(): void;
  createAllianceRequest(recipient: Player): AllianceRequest | null;
  betrayals(): number;

  // Targeting
  canTarget(other: Player): boolean;
  target(other: Player): void;
  targets(): Player[];
  transitiveTargets(): Player[];

  // Communication
  canSendEmoji(recipient: Player | typeof AllPlayers): boolean;
  outgoingEmojis(): EmojiMessage[];
  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void;
  canSendQuickChat(recipient: Player): boolean;
  recordQuickChat(recipient: Player): void;

  // Donation
  canDonateGold(recipient: Player): boolean;
  canDonateTroops(recipient: Player): boolean;
  donateTroops(recipient: Player, troops: number): boolean;
  donateGold(recipient: Player, gold: Gold): boolean;
  canDeleteUnit(): boolean;
  recordDeleteUnit(): void;
  canEmbargoAll(): boolean;
  recordEmbargoAll(): void;

  // Embargo
  hasEmbargoAgainst(other: Player): boolean;
  tradingPartners(): Player[];
  addEmbargo(other: Player, isTemporary: boolean): void;
  getEmbargoes(): Embargo[];
  stopEmbargo(other: Player): void;
  endTemporaryEmbargo(other: Player): void;
  canTrade(other: Player): boolean;

  // Attacking.
  canAttack(tile: TileRef): boolean;
  canAttackPlayer(player: Player, treatAFKFriendly?: boolean): boolean;
  isImmune(): boolean;

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
  ): Attack;
  outgoingAttacks(): Attack[];
  incomingAttacks(): Attack[];
  orderRetreat(attackID: string): void;
  executeRetreat(attackID: string): void;

  // Misc
  toUpdate(
    statsOut?: number[],
    attackTroopsOut?: number[],
    forceFull?: boolean,
  ): PlayerUpdate | null;
  playerProfile(): PlayerProfile;
  // WARNING: this operation is expensive.
  bestTransportShipSpawn(tile: TileRef): TileRef | false;
}

export interface Game extends GameLike {
  // Map & Dimensions
  isOnMap(cell: Cell): boolean;
  width(): number;
  height(): number;
  map(): GameMap;
  miniMap(): GameMap;
  forEachTile(fn: (tile: TileRef) => void): void;
  // Zero-allocation neighbor iteration (cardinal only), in the same N, S, W, E
  // order as neighbors().
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void;
  // Writes the cardinal neighbors of ref into out (same N, S, W, E order as
  // neighbors()) and returns the count. Reuse out across calls to avoid
  // allocation.
  neighbors4(ref: TileRef, out: TileRef[]): number;
  neighbors8(ref: TileRef, out: TileRef[]): number;
  // Zero-allocation neighbor iteration for performance-critical cluster calculation
  // Alternative to neighborsWithDiag() that returns arrays
  // Avoids creating intermediate arrays and uses a callback for better performance
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void;

  // Player Management
  player(id: PlayerID): Player;
  players(): Player[];
  allPlayers(): Player[];
  playerByClientID(id: ClientID): Player | null;
  playerBySmallID(id: number): Player | TerraNullius;
  hasPlayer(id: PlayerID): boolean;
  addPlayer(playerInfo: PlayerInfo): Player;
  terraNullius(): TerraNullius;
  owner(ref: TileRef): Player | TerraNullius;

  teams(): Team[];
  teamTilesOwned(team: Team): number;
  totalLandTiles(): number;
  teamSpawnArea(team: Team): SpawnArea | undefined;

  // Alliances
  expireAlliance(alliance: Alliance): void;
  allianceRequests(): AllianceRequest[];

  // Immunity timer
  isSpawnImmunityActive(): boolean;
  isNationSpawnImmunityActive(): boolean;
  elapsedGameSeconds(): number;

  // Game State
  ticks(): Tick;
  startTick(): Tick | null;
  inSpawnPhase(): boolean;
  endSpawnPhase(): void;
  executeNextTick(): GameUpdates;
  drainPackedTileUpdates(): Uint32Array;
  recordMotionPlan(record: MotionPlanRecord): void;
  drainPackedMotionPlans(): Uint32Array | null;
  drainPackedPlayerUpdates(): Float64Array | null;
  drainPackedAttackUpdates(): Float64Array | null;
  // null ends the game with no winner (a cancelled match, e.g. a ranked game
  // that didn't fill): the record is archived winnerless and never ranked.
  setWinner(
    winner: Player | Team | null,
    allPlayersStats: AllPlayersStats,
  ): void;
  getWinner(): Player | Team | null;
  config(): EngineConfig;
  isPaused(): boolean;
  setPaused(paused: boolean): void;

  // Units
  unit(id: number): Unit | undefined;
  // See Player.units() for why this is not a rest parameter.
  units(): Unit[];
  units(types: readonly UnitType[]): Unit[];
  units(type: UnitType, type2?: UnitType, type3?: UnitType): Unit[];
  unitCount(type: UnitType): number;
  unitInfo(type: UnitType): EngineUnitInfo;
  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }>;

  addExecution(...exec: Execution[]): void;
  executions(): Execution[];
  removeExecution(exec: Execution): void;
  takeoverPlayer(player: Player | PlayerID, localClientID: ClientID): void;
  convertHumanToNation(player: Player | PlayerID, gameID: GameID): Execution;
  applySingleplayerConfig(difficulty?: Difficulty): void;
  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    goldAmount?: bigint,
    params?: Record<string, string | number>,
    unitID?: number,
    focusPlayerID?: PlayerID,
  ): void;
  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
  ): void;

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void;

  // Nations
  nations(): Nation[];

  numTilesWithFallout(): number;
  stats(): Stats;

  addUpdate(update: GameUpdate): void;
  railNetwork(): RailNetwork;
  /** MIRVs launched so far by anyone; each one raises the next one's price. */
  mirvsLaunched(): number;
  recordMirvLaunch(): void;
  /**
   * Round-robin counter per ship kind, used to spread the ships' water
   * pathfinder rebuilds over WaterPathFinder.STAGGER_SPREAD ticks.
   */
  nextShipStagger(kind: "tradeShip" | "transportShip"): number;
  /** Tick each player was last hit by a nation MIRV, shared by all nations. */
  nationMirvTargets(): Map<PlayerID, Tick>;
  conquerPlayer(conqueror: Player, conquered: Player): void;
  miniWaterHPA(): PathFinder<number> | null;
  miniWaterGraph(): AbstractGraph | null;
  getWaterComponent(tile: TileRef): number | null;
  hasWaterComponent(tile: TileRef, component: number): boolean;
  /**
   * Returns the approximate number of water tiles in the component
   * containing `tile`, or null if the tile has no water component. Useful for
   * filtering tiny water bodies (e.g. preventing AI port placement on ponds).
   */
  getWaterComponentSize(tile: TileRef): number | null;
  /**
   * Returns the set of water components that `player` shares with at least one
   * valid trade partner (cached). Used by nation AI for port-placement
   * heuristics. `null` means no usable water body for ports.
   */
  sharedWaterComponents(player: Player): Set<number> | null;
  /** Incremented each time the water navigation graph is rebuilt (e.g. after nuke terrain change). */
  waterGraphVersion(): number;

  /** Queue a land tile for conversion to water (batched every few ticks). Tile must be unowned. */
  queueWaterConversion(tile: TileRef): void;

  /** Queue a tile that was inside a nuke blast radius (for nukeable layer destruction). */
  queueNukeImpact(tile: TileRef): void;

  /** Drain all tiles from nuke impacts this tick. Called once per tick. */
  drainNukeImpacts(): TileRef[];
}
