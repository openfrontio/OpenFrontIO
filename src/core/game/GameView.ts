import { Config } from "../configuration/Config";
import { ClientID, GameID } from "../Schemas";
import { createRandomName } from "../Util";
import { WorkerClient } from "../worker/WorkerClient";
import {
  Cell,
  EmojiMessage,
  GameUpdates,
  Gold,
  NameViewData,
  Player,
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
  Team,
  TerrainType,
  TerraNullius,
  Tick,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameMap, TileRef, TileUpdate } from "./GameMap";
import {
  AttackUpdate,
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitGrid } from "./UnitGrid";
import { UserSettings } from "./UserSettings";

const userSettings: UserSettings = new UserSettings();

export class UnitView {
  public _wasUpdated = true;
  public lastPos: TileRef[] = [];

  constructor(
    private gameView: GameView,
    private data: UnitUpdate,
  ) {
    this.lastPos.push(data.pos);
  }

  wasUpdated(): boolean {
    return this._wasUpdated;
  }

  lastTiles(): TileRef[] {
    return this.lastPos;
  }

  lastTile(): TileRef {
    if (this.lastPos.length === 0) {
      return this.data.pos;
    }
    return this.lastPos[0];
  }

  update(data: UnitUpdate) {
    this.lastPos.push(data.pos);
    this._wasUpdated = true;
    this.data = data;
  }

  id(): number {
    return this.data.id;
  }

  type(): UnitType {
    return this.data.unitType;
  }
  troops(): number {
    return this.data.troops;
  }
  retreating(): boolean {
    if (this.type() !== UnitType.TransportShip) {
      throw Error("Must be a transport ship");
    }
    return this.data.retreating;
  }
  tile(): TileRef {
    return this.data.pos;
  }
  owner(): PlayerView {
    return this.gameView.playerBySmallID(this.data.ownerID)! as PlayerView;
  }
  isActive(): boolean {
    return this.data.isActive;
  }
  reachedTarget(): boolean {
    return this.data.reachedTarget;
  }
  hasHealth(): boolean {
    return this.data.health !== undefined;
  }
  health(): number {
    return this.data.health ?? 0;
  }
  constructionType(): UnitType | undefined {
    return this.data.constructionType;
  }
  targetUnitId(): number | undefined {
    return this.data.targetUnitId;
  }
  targetTile(): TileRef | undefined {
    return this.data.targetTile;
  }
  ticksLeftInCooldown(): Tick | undefined {
    return this.data.ticksLeftInCooldown;
  }
  isCooldown(): boolean {
    if (this.data.ticksLeftInCooldown === undefined) return false;
    return this.data.ticksLeftInCooldown > 0;
  }
}

export class PlayerView {
  public anonymousName: string | null = null;

  constructor(
    private game: GameView,
    public data: PlayerUpdate,
    public nameData: NameViewData,
  ) {
    if (data.clientID === game.myClientID()) {
      this.anonymousName = this.data.name;
    } else {
      this.anonymousName = createRandomName(
        this.data.name,
        this.data.playerType,
      );
    }
  }

  async actions(tile: TileRef): Promise<PlayerActions> {
    return this.game.worker.playerInteraction(
      this.id(),
      this.game.x(tile),
      this.game.y(tile),
    );
  }

  async borderTiles(): Promise<PlayerBorderTiles> {
    return this.game.worker.playerBorderTiles(this.id());
  }

  outgoingAttacks(): AttackUpdate[] {
    return this.data.outgoingAttacks;
  }

  incomingAttacks(): AttackUpdate[] {
    return this.data.incomingAttacks;
  }

  async attackAveragePosition(
    playerID: number,
    attackID: string,
  ): Promise<Cell | null> {
    return this.game.worker.attackAveragePosition(playerID, attackID);
  }

  units(...types: UnitType[]): UnitView[] {
    return this.game
      .units(...types)
      .filter((u) => u.owner().smallID() === this.smallID());
  }

  nameLocation(): NameViewData {
    return this.nameData;
  }

  smallID(): number {
    return this.data.smallID;
  }
  flag(): string | undefined {
    return this.data.flag;
  }

  pattern(): string | undefined {
    return this.data.pattern;
  }

  name(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.data.name;
  }
  displayName(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.data.name;
  }

  clientID(): ClientID | null {
    return this.data.clientID;
  }
  id(): PlayerID {
    return this.data.id;
  }
  team(): Team | null {
    return this.data.team ?? null;
  }
  type(): PlayerType {
    return this.data.playerType;
  }
  isAlive(): boolean {
    return this.data.isAlive;
  }
  isPlayer(): this is Player {
    return true;
  }
  numTilesOwned(): number {
    return this.data.tilesOwned;
  }
  allies(): PlayerView[] {
    return this.data.allies.map(
      (a) => this.game.playerBySmallID(a) as PlayerView,
    );
  }
  targets(): PlayerView[] {
    return this.data.targets.map(
      (id) => this.game.playerBySmallID(id) as PlayerView,
    );
  }
  gold(): Gold {
    return this.data.gold;
  }
  population(): number {
    return this.data.population;
  }
  workers(): number {
    return this.data.workers;
  }
  targetTroopRatio(): number {
    return this.data.targetTroopRatio;
  }
  troops(): number {
    return this.data.troops;
  }

  isAlliedWith(other: PlayerView): boolean {
    return this.data.allies.some((n) => other.smallID() === n);
  }

  isOnSameTeam(other: PlayerView): boolean {
    return this.data.team !== undefined && this.data.team === other.data.team;
  }

  isFriendly(other: PlayerView): boolean {
    return this.isAlliedWith(other) || this.isOnSameTeam(other);
  }

  isRequestingAllianceWith(other: PlayerView) {
    return this.data.outgoingAllianceRequests.some((id) => other.id() === id);
  }

  hasEmbargoAgainst(other: PlayerView): boolean {
    return this.data.embargoes.has(other.id());
  }

  profile(): Promise<PlayerProfile> {
    return this.game.worker.playerProfile(this.smallID());
  }

  bestTransportShipSpawn(targetTile: TileRef): Promise<TileRef | false> {
    return this.game.worker.transportShipSpawn(this.id(), targetTile);
  }

  transitiveTargets(): PlayerView[] {
    return [...this.targets(), ...this.allies().flatMap((p) => p.targets())];
  }

  isTraitor(): boolean {
    return this.data.isTraitor;
  }
  outgoingEmojis(): EmojiMessage[] {
    return this.data.outgoingEmojis;
  }
  info(): PlayerInfo {
    return new PlayerInfo(
      this.pattern(),
      this.flag(),
      this.name(),
      this.type(),
      this.clientID(),
      this.id(),
    );
  }
  hasSpawned(): boolean {
    return this.data.hasSpawned;
  }
  isDisconnected(): boolean {
    return this.data.isDisconnected;
  }
}

export class GameView implements GameMap {
  private lastUpdate: GameUpdateViewData | null;
  private smallIDToID = new Map<number, PlayerID>();
  private _players = new Map<PlayerID, PlayerView>();
  private _units = new Map<number, UnitView>();
  private updatedTiles: TileRef[] = [];

  private _myPlayer: PlayerView | null = null;
  private _focusedPlayer: PlayerView | null = null;

  private unitGrid: UnitGrid;

  private toDelete = new Set<number>();

  constructor(
    public worker: WorkerClient,
    private _config: Config,
    private _map: GameMap,
    private _myClientID: ClientID,
    private _gameID: GameID,
  ) {
    this.lastUpdate = null;
    this.unitGrid = new UnitGrid(_map);
  }
  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  public updatesSinceLastTick(): GameUpdates | null {
    return this.lastUpdate?.updates ?? null;
  }

  public update(gu: GameUpdateViewData) {
    this.toDelete.forEach((id) => this._units.delete(id));
    this.toDelete.clear();

    this.lastUpdate = gu;

    this.updatedTiles = [];
    this.lastUpdate.packedTileUpdates.forEach((tu) => {
      this.updatedTiles.push(this.updateTile(tu));
    });

    if (gu.updates === null) {
      throw new Error("lastUpdate.updates not initialized");
    }
    gu.updates[GameUpdateType.Player].forEach((pu) => {
      this.smallIDToID.set(pu.smallID, pu.id);
      const player = this._players.get(pu.id);
      if (player !== undefined) {
        player.data = pu;
        player.nameData = gu.playerNameViewData[pu.id];
      } else {
        this._players.set(
          pu.id,
          new PlayerView(this, pu, gu.playerNameViewData[pu.id]),
        );
      }
    });
    for (const unit of this._units.values()) {
      unit._wasUpdated = false;
      unit.lastPos = unit.lastPos.slice(-1);
    }
    gu.updates[GameUpdateType.Unit].forEach((update) => {
      let unit = this._units.get(update.id);
      if (unit !== undefined) {
        unit.update(update);
      } else {
        unit = new UnitView(this, update);
        this._units.set(update.id, unit);
      }
      if (update.isActive) {
        this.unitGrid.addUnit(unit);
      } else {
        this.unitGrid.removeUnit(unit);
      }
      if (!unit.isActive()) {
        // Wait until next tick to delete the unit.
        this.toDelete.add(unit.id());
      }
    });
  }

  recentlyUpdatedTiles(): TileRef[] {
    return this.updatedTiles;
  }

  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | UnitType[],
  ): Array<{ unit: UnitView; distSquared: number }> {
    return this.unitGrid.nearbyUnits(tile, searchRange, types) as Array<{
      unit: UnitView;
      distSquared: number;
    }>;
  }

  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId: PlayerID,
  ) {
    return this.unitGrid.hasUnitNearby(tile, searchRange, type, playerId);
  }

  myClientID(): ClientID {
    return this._myClientID;
  }

  myPlayer(): PlayerView | null {
    if (this._myPlayer === null) {
      this._myPlayer = this.playerByClientID(this._myClientID);
    }
    return this._myPlayer;
  }

  player(id: PlayerID): PlayerView {
    const player = this._players.get(id);
    if (player === undefined) {
      throw Error(`player id ${id} not found`);
    }
    return player;
  }

  players(): PlayerView[] {
    return Array.from(this._players.values());
  }

  playerBySmallID(id: number): PlayerView | TerraNullius {
    if (id === 0) {
      return new TerraNulliusImpl();
    }
    const playerId = this.smallIDToID.get(id);
    if (playerId === undefined) {
      throw new Error(`small id ${id} not found`);
    }
    return this.player(playerId);
  }

  playerByClientID(id: ClientID): PlayerView | null {
    const player =
      Array.from(this._players.values()).filter(
        (p) => p.clientID() === id,
      )[0] ?? null;
    if (player === null) {
      return null;
    }
    return player;
  }
  hasPlayer(id: PlayerID): boolean {
    return false;
  }
  playerViews(): PlayerView[] {
    return Array.from(this._players.values());
  }

  owner(tile: TileRef): PlayerView | TerraNullius {
    return this.playerBySmallID(this.ownerID(tile));
  }

  ticks(): Tick {
    if (this.lastUpdate === null) return 0;
    return this.lastUpdate.tick;
  }
  inSpawnPhase(): boolean {
    return this.ticks() <= this._config.numSpawnPhaseTurns();
  }
  config(): Config {
    return this._config;
  }
  units(...types: UnitType[]): UnitView[] {
    if (types.length === 0) {
      return Array.from(this._units.values()).filter((u) => u.isActive());
    }
    return Array.from(this._units.values()).filter(
      (u) => u.isActive() && types.includes(u.type()),
    );
  }
  unit(id: number): UnitView | undefined {
    return this._units.get(id);
  }
  unitInfo(type: UnitType): UnitInfo {
    return this._config.unitInfo(type);
  }

  ref(x: number, y: number): TileRef {
    return this._map.ref(x, y);
  }
  x(ref: TileRef): number {
    return this._map.x(ref);
  }
  y(ref: TileRef): number {
    return this._map.y(ref);
  }
  cell(ref: TileRef): Cell {
    return this._map.cell(ref);
  }
  width(): number {
    return this._map.width();
  }
  height(): number {
    return this._map.height();
  }
  numLandTiles(): number {
    return this._map.numLandTiles();
  }
  isValidCoord(x: number, y: number): boolean {
    return this._map.isValidCoord(x, y);
  }
  isLand(ref: TileRef): boolean {
    return this._map.isLand(ref);
  }
  isOceanShore(ref: TileRef): boolean {
    return this._map.isOceanShore(ref);
  }
  isOcean(ref: TileRef): boolean {
    return this._map.isOcean(ref);
  }
  isShoreline(ref: TileRef): boolean {
    return this._map.isShoreline(ref);
  }
  magnitude(ref: TileRef): number {
    return this._map.magnitude(ref);
  }
  ownerID(ref: TileRef): number {
    return this._map.ownerID(ref);
  }
  hasOwner(ref: TileRef): boolean {
    return this._map.hasOwner(ref);
  }
  setOwnerID(ref: TileRef, playerId: number): void {
    return this._map.setOwnerID(ref, playerId);
  }
  hasFallout(ref: TileRef): boolean {
    return this._map.hasFallout(ref);
  }
  setFallout(ref: TileRef, value: boolean): void {
    return this._map.setFallout(ref, value);
  }
  isBorder(ref: TileRef): boolean {
    return this._map.isBorder(ref);
  }
  neighbors(ref: TileRef): TileRef[] {
    return this._map.neighbors(ref);
  }
  isWater(ref: TileRef): boolean {
    return this._map.isWater(ref);
  }
  isLake(ref: TileRef): boolean {
    return this._map.isLake(ref);
  }
  isShore(ref: TileRef): boolean {
    return this._map.isShore(ref);
  }
  cost(ref: TileRef): number {
    return this._map.cost(ref);
  }
  terrainType(ref: TileRef): TerrainType {
    return this._map.terrainType(ref);
  }
  forEachTile(fn: (tile: TileRef) => void): void {
    return this._map.forEachTile(fn);
  }
  manhattanDist(c1: TileRef, c2: TileRef): number {
    return this._map.manhattanDist(c1, c2);
  }
  euclideanDistSquared(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDistSquared(c1, c2);
  }
  bfs(
    tile: TileRef,
    filter: (gm: GameMap, tile: TileRef) => boolean,
  ): Set<TileRef> {
    return this._map.bfs(tile, filter);
  }
  toTileUpdate(tile: TileRef): bigint {
    return this._map.toTileUpdate(tile);
  }
  updateTile(tu: TileUpdate): TileRef {
    return this._map.updateTile(tu);
  }
  numTilesWithFallout(): number {
    return this._map.numTilesWithFallout();
  }
  gameID(): GameID {
    return this._gameID;
  }

  focusedPlayer(): PlayerView | null {
    // TODO: renable when performance issues are fixed.
    return this.myPlayer();
  }
  setFocusedPlayer(player: PlayerView | null): void {
    this._focusedPlayer = player;
  }
}
