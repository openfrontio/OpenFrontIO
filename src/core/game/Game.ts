import { Config } from "../configuration/Config";
import { AllPlayersStats, ClientID } from "../Schemas";
import { GameMap, TileRef } from "./GameMap";
import {
  GameUpdate,
  GameUpdateType,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { PlayerView } from "./GameView";
import { Stats } from "./Stats";

export type PlayerID = string;
export type Tick = number;
export type Gold = number;

export const AllPlayers = "AllPlayers" as const;

// export type GameUpdates = Record<GameUpdateType, GameUpdate[]>;
// Create a type that maps GameUpdateType to its corresponding update type
type UpdateTypeMap<T extends GameUpdateType> = Extract<GameUpdate, { type: T }>;

// Then use it to create the record type
export type GameUpdates = {
  [K in GameUpdateType]: UpdateTypeMap<K>[];
};

export interface MapPos {
  x: number;
  y: number;
}

export enum Difficulty {
  Easy = "Easy",
  Medium = "Medium",
  Hard = "Hard",
  Impossible = "Impossible",
}

export enum Team {
  Red = "Red",
  Blue = "Blue",
  Teal = "Teal",
  Purple = "Purple",
  Yellow = "Yellow",
  Orange = "Orange",
  Green = "Green",
  Bot = "Bot",
}

export enum GameMapType {
  World = "World",
  Europe = "Europe",
  EuropeClassic = "Europe Classic",
  Mena = "Mena",
  NorthAmerica = "North America",
  SouthAmerica = "South America",
  Oceania = "Oceania",
  BlackSea = "Black Sea",
  Africa = "Africa",
  Pangaea = "Pangaea",
  Asia = "Asia",
  Mars = "Mars",
  Britannia = "Britannia",
  GatewayToTheAtlantic = "Gateway to the Atlantic",
  Australia = "Australia",
  Iceland = "Iceland",
  Japan = "Japan",
  BetweenTwoSeas = "Between Two Seas",
  KnownWorld = "Known World",
  FaroeIslands = "FaroeIslands",
  DeglaciatedAntarctica = "Deglaciated Antarctica",
}

export const mapCategories: Record<string, GameMapType[]> = {
  continental: [
    GameMapType.World,
    GameMapType.NorthAmerica,
    GameMapType.SouthAmerica,
    GameMapType.Europe,
    GameMapType.EuropeClassic,
    GameMapType.Asia,
    GameMapType.Africa,
    GameMapType.Oceania,
  ],
  regional: [
    GameMapType.BlackSea,
    GameMapType.Britannia,
    GameMapType.GatewayToTheAtlantic,
    GameMapType.BetweenTwoSeas,
    GameMapType.Iceland,
    GameMapType.Japan,
    GameMapType.Mena,
    GameMapType.Australia,
    GameMapType.FaroeIslands,
  ],
  fantasy: [
    GameMapType.Pangaea,
    GameMapType.Mars,
    GameMapType.KnownWorld,
    GameMapType.DeglaciatedAntarctica,
  ],
};

export enum GameType {
  Singleplayer = "Singleplayer",
  Public = "Public",
  Private = "Private",
}

export enum GameMode {
  FFA = "Free For All",
  Team = "Team",
}

export interface UnitInfo {
  cost: (player: Player | PlayerView) => Gold;
  // Determines if its owner changes when its tile is conquered.
  territoryBound: boolean;
  maxHealth?: number;
  damage?: number;
  constructionDuration?: number;
}

export enum UnitType {
  TransportShip = "Transport",
  Warship = "Warship",
  Shell = "Shell",
  SAMMissile = "SAMMissile",
  Port = "Port",
  AtomBomb = "Atom Bomb",
  HydrogenBomb = "Hydrogen Bomb",
  TradeShip = "Trade Ship",
  MissileSilo = "Missile Silo",
  DefensePost = "Defense Post",
  SAMLauncher = "SAM Launcher",
  City = "City",
  MIRV = "MIRV",
  MIRVWarhead = "MIRV Warhead",
  Construction = "Construction",
}

export const nukeTypes = [
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
  UnitType.MIRV,
] as UnitType[];

export type NukeType = (typeof nukeTypes)[number];

export enum Relation {
  Hostile = 0,
  Distrustful = 1,
  Neutral = 2,
  Friendly = 3,
}

export class Nation {
  constructor(
    public readonly flag: string,
    public readonly name: string,
    public readonly cell: Cell,
    public readonly strength: number,
  ) {}
}

export class Cell {
  public index: number;

  private strRepr: string;

  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {
    this.strRepr = `Cell[${this.x},${this.y}]`;
  }

  pos(): MapPos {
    return {
      x: this.x,
      y: this.y,
    };
  }

  toString(): string {
    return this.strRepr;
  }
}

export enum TerrainType {
  Plains,
  Highland,
  Mountain,
  Lake,
  Ocean,
}

export enum PlayerType {
  Bot = "BOT",
  Human = "HUMAN",
  FakeHuman = "FAKEHUMAN",
}

export interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
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
}

export interface AllianceRequest {
  accept(): void;
  reject(): void;
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
}

export interface Alliance {
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  other(player: Player): Player;
}

export interface MutableAlliance extends Alliance {
  expire(): void;
  other(player: Player): Player;
}

export class PlayerInfo {
  public readonly clan: string | null;

  constructor(
    public readonly flag: string,
    public readonly name: string,
    public readonly playerType: PlayerType,
    // null if bot.
    public readonly clientID: ClientID | null,
    // TODO: make player id the small id
    public readonly id: PlayerID,
    public readonly nation?: Nation | null,
  ) {
    // Compute clan from name
    if (!name.startsWith("[") || !name.includes("]")) {
      this.clan = null;
    } else {
      const clanMatch = name.match(/^\[([A-Z]{2,5})\]/);
      this.clan = clanMatch ? clanMatch[1] : null;
    }
  }
}

// Some units have info specific to them
export interface UnitSpecificInfos {
  dstPort?: Unit; // Only for trade ships
  lastSetSafeFromPirates?: number; // Only for trade ships
  detonationDst?: TileRef; // Only for nukes
  warshipTarget?: Unit;
  cooldownDuration?: number;
}

export interface Unit {
  id(): number;

  // Properties
  type(): UnitType;
  troops(): number;
  owner(): Player;
  info(): UnitInfo;

  // Location
  tile(): TileRef;
  lastTile(): TileRef;
  move(tile: TileRef): void;

  // State
  isActive(): boolean;
  hasHealth(): boolean;
  health(): number;
  modifyHealth(delta: number): void;

  setWarshipTarget(target: Unit): void; // warship only
  warshipTarget(): Unit;

  setCooldown(triggerCooldown: boolean): void;
  ticksLeftInCooldown(cooldownDuration: number): Tick;
  isCooldown(): boolean;
  setDstPort(dstPort: Unit): void;
  dstPort(): Unit; // Only for trade ships
  setSafeFromPirates(): void; // Only for trade ships
  isSafeFromPirates(): boolean; // Only for trade ships
  detonationDst(): TileRef; // Only for nukes

  setMoveTarget(cell: TileRef): void;
  moveTarget(): TileRef | null;

  setTargetedBySAM(targeted: boolean): void;
  targetedBySAM(): boolean;

  // Mutations
  setTroops(troops: number): void;
  delete(displayerMessage?: boolean): void;

  // Only for Construction type
  constructionType(): UnitType | null;
  setConstructionType(type: UnitType): void;

  // Updates
  toUpdate(): UnitUpdate;
}

export interface TerraNullius {
  isPlayer(): false;
  id(): PlayerID; // always zero, maybe make it TerraNulliusID?
  clientID(): ClientID;
  smallID(): number;
}

export interface Player {
  // Basic Info
  smallID(): number;
  info(): PlayerInfo;
  name(): string;
  displayName(): string;
  clientID(): ClientID;
  id(): PlayerID;
  type(): PlayerType;
  isPlayer(): this is Player;
  toString(): string;

  // State & Properties
  isAlive(): boolean;
  isTraitor(): boolean;
  markTraitor(): void;
  largestClusterBoundingBox: { min: Cell; max: Cell } | null;
  lastTileChange(): Tick;

  hasSpawned(): boolean;
  setHasSpawned(hasSpawned: boolean): void;

  // Territory
  tiles(): ReadonlySet<TileRef>;
  borderTiles(): ReadonlySet<TileRef>;
  numTilesOwned(): number;
  conquer(tile: TileRef): void;
  relinquish(tile: TileRef): void;

  // Resources & Population
  gold(): Gold;
  population(): number;
  workers(): number;
  troops(): number;
  targetTroopRatio(): number;
  addGold(toAdd: Gold): void;
  removeGold(toRemove: Gold): void;
  addWorkers(toAdd: number): void;
  removeWorkers(toRemove: number): void;
  setTargetTroopRatio(target: number): void;
  setTroops(troops: number): void;
  addTroops(troops: number): void;
  removeTroops(troops: number): number;

  // Units
  units(...types: UnitType[]): Unit[];
  unitsIncludingConstruction(type: UnitType): Unit[];
  buildableUnits(tile: TileRef): BuildableUnit[];
  canBuild(type: UnitType, targetTile: TileRef): TileRef | false;
  buildUnit(
    type: UnitType,
    troops: number,
    tile: TileRef,
    unitSpecificInfos?: UnitSpecificInfos,
  ): Unit;
  captureUnit(unit: Unit): void;

  // Relations & Diplomacy
  neighbors(): (Player | TerraNullius)[];
  sharesBorderWith(other: Player | TerraNullius): boolean;
  relation(other: Player): Relation;
  allRelationsSorted(): { player: Player; relation: Relation }[];
  updateRelation(other: Player, delta: number): void;
  decayRelations(): void;
  isOnSameTeam(other: Player): boolean;
  // Either allied or on same team.
  isFriendly(other: Player): boolean;
  team(): Team | null;
  clan(): string | null;
  incomingAllianceRequests(): AllianceRequest[];
  outgoingAllianceRequests(): AllianceRequest[];
  alliances(): MutableAlliance[];
  allies(): Player[];
  isAlliedWith(other: Player): boolean;
  allianceWith(other: Player): MutableAlliance | null;
  canSendAllianceRequest(other: Player): boolean;
  breakAlliance(alliance: Alliance): void;
  createAllianceRequest(recipient: Player): AllianceRequest;

  // Targeting
  canTarget(other: Player): boolean;
  target(other: Player): void;
  targets(): Player[];
  transitiveTargets(): Player[];

  // Communication
  canSendEmoji(recipient: Player | typeof AllPlayers): boolean;
  outgoingEmojis(): EmojiMessage[];
  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void;

  // Donation
  canDonate(recipient: Player): boolean;
  donateTroops(recipient: Player, troops: number): void;
  donateGold(recipient: Player, gold: number): void;

  // Embargo
  hasEmbargoAgainst(other: Player): boolean;
  tradingPartners(): Player[];
  addEmbargo(other: PlayerID): void;
  stopEmbargo(other: PlayerID): void;
  canTrade(other: Player): boolean;

  // Attacking.
  canAttack(tile: TileRef): boolean;
  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef,
  ): Attack;
  outgoingAttacks(): Attack[];
  incomingAttacks(): Attack[];
  orderRetreat(attackID: string): void;
  executeRetreat(attackID: string): void;

  // Misc
  toUpdate(): PlayerUpdate;
  playerProfile(): PlayerProfile;
  tradingPorts(port: Unit): Unit[];
  // WARNING: this operation is expensive.
  bestTransportShipSpawn(tile: TileRef): TileRef | false;
}

export interface Game extends GameMap {
  // Map & Dimensions
  isOnMap(cell: Cell): boolean;
  width(): number;
  height(): number;
  map(): GameMap;
  miniMap(): GameMap;
  forEachTile(fn: (tile: TileRef) => void): void;

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

  // Game State
  ticks(): Tick;
  inSpawnPhase(): boolean;
  executeNextTick(): GameUpdates;
  setWinner(winner: Player | Team, allPlayersStats: AllPlayersStats): void;
  config(): Config;

  // Units
  units(...types: UnitType[]): Unit[];
  unitInfo(type: UnitType): UnitInfo;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | UnitType[],
  ): Array<{ unit: Unit; distSquared: number }>;

  addExecution(...exec: Execution[]): void;
  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
  ): void;

  // Nations
  nations(): Nation[];

  numTilesWithFallout(): number;
  // Optional as it's not initialized before the end of spawn phase
  stats(): Stats;
}

export interface PlayerActions {
  canAttack: boolean;
  buildableUnits: BuildableUnit[];
  canSendEmojiAllPlayers: boolean;
  interaction?: PlayerInteraction;
}

export interface BuildableUnit {
  canBuild: TileRef | false;
  type: UnitType;
  cost: number;
}

export interface PlayerProfile {
  relations: Record<number, Relation>;
  alliances: number[];
}

export interface PlayerBorderTiles {
  borderTiles: ReadonlySet<TileRef>;
}

export interface PlayerInteraction {
  sharedBorder: boolean;
  canSendEmoji: boolean;
  canSendAllianceRequest: boolean;
  canBreakAlliance: boolean;
  canTarget: boolean;
  canDonate: boolean;
  canEmbargo: boolean;
}

export interface EmojiMessage {
  message: string;
  senderID: number;
  recipientID: number | typeof AllPlayers;
  createdAt: Tick;
}

export enum MessageType {
  SUCCESS,
  INFO,
  WARN,
  ERROR,
}

export interface NameViewData {
  x: number;
  y: number;
  size: number;
}
