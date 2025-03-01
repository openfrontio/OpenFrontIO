import { Config } from "../configuration/Config";
import { ClientID } from "../Schemas";
import { WorkerClient } from "../worker/WorkerClient";
import { DefenseGrid } from "./DefensePostGrid";
import {
  Cell,
  EmojiMessage,
  GameUpdates,
  Gold,
  NameViewData,
  Player,
  PlayerActions,
  PlayerID,
  PlayerInfo,
  PlayerProfile,
  PlayerType,
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
    if (this.lastPos.length == 0) {
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
  tile(): TileRef {
    return this.data.pos;
  }
  owner(): PlayerView {
    return this.gameView.playerBySmallID(this.data.ownerID) as PlayerView;
  }
  isActive(): boolean {
    return this.data.isActive;
  }
  hasHealth(): boolean {
    return this.data.health != undefined;
  }
  health(): number {
    return this.data.health ?? 0;
  }
  constructionType(): UnitType | undefined {
    return this.data.constructionType;
  }
}

export class PlayerView {
  constructor(
    private game: GameView,
    public data: PlayerUpdate,
    public nameData: NameViewData,
  ) {}

  async actions(tile: TileRef): Promise<PlayerActions> {
    return this.game.worker.playerInteraction(
      this.id(),
      this.game.x(tile),
      this.game.y(tile),
    );
  }

  outgoingAttacks(): AttackUpdate[] {
    return this.data.outgoingAttacks;
  }

  incomingAttacks(): AttackUpdate[] {
    return this.data.incomingAttacks;
  }

  units(...types: UnitType[]): UnitView[] {
    return this.game
      .units(...types)
      .filter((u) => u.owner().smallID() == this.smallID());
  }

  nameLocation(): NameViewData {
    return this.nameData;
  }

  smallID(): number {
    return this.data.smallID;
  }
  flag(): string {
    return this.data.flag;
  }
  name(): string {
    return this.data.name;
  }
  displayName(): string {
    return this.data.displayName;
  }
  clientID(): ClientID {
    return this.data.clientID;
  }
  id(): PlayerID {
    return this.data.id;
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
    return this.data.allies.some((n) => other.smallID() == n);
  }

  profile(): Promise<PlayerProfile> {
    return this.game.worker.playerProfile(this.smallID());
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
      this.flag(),
      this.name(),
      this.type(),
      this.clientID(),
      this.id(),
    );
  }
}

export class GameView implements GameMap {
  private lastUpdate: GameUpdateViewData;
  private smallIDToID = new Map<number, PlayerID>();
  private _players = new Map<PlayerID, PlayerView>();
  private _units = new Map<number, UnitView>();
  private updatedTiles: TileRef[] = [];

  private _myPlayer: PlayerView | null = null;

  private defensePostGrid: DefenseGrid;

  private toDelete = new Set<number>();

  constructor(
    public worker: WorkerClient,
    private _config: Config,
    private _map: GameMap,
    private _myClientID: ClientID,
  ) {
    this.lastUpdate = {
      tick: 0,
      packedTileUpdates: new BigUint64Array([]),
      // TODO: make this empty map instead of null?
      updates: null,
      playerNameViewData: {},
    };
    this.defensePostGrid = new DefenseGrid(_map, _config.defensePostRange());
  }
  isOnEdgeOfMap(ref: TileRef): boolean {
    return this._map.isOnEdgeOfMap(ref);
  }

  public updatesSinceLastTick(): GameUpdates {
    return this.lastUpdate.updates;
  }

  public update(gu: GameUpdateViewData) {
    this.toDelete.forEach((id) => this._units.delete(id));
    this.toDelete.clear();

    this.lastUpdate = gu;

    this.updatedTiles = [];
    this.lastUpdate.packedTileUpdates.forEach((tu) => {
      this.updatedTiles.push(this.updateTile(tu));
    });

    gu.updates[GameUpdateType.Player].forEach((pu) => {
      this.smallIDToID.set(pu.smallID, pu.id);
      if (this._players.has(pu.id)) {
        this._players.get(pu.id).data = pu;
        this._players.get(pu.id).nameData = gu.playerNameViewData[pu.id];
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
      let unit: UnitView = null;
      if (this._units.has(update.id)) {
        unit = this._units.get(update.id);
        unit.update(update);
      } else {
        unit = new UnitView(this, update);
        this._units.set(update.id, unit);
      }
      if (update.unitType == UnitType.DefensePost) {
        if (update.isActive) {
          this.defensePostGrid.addDefense(unit);
        } else {
          this.defensePostGrid.removeDefense(unit);
        }
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

  nearbyDefenses(tile: TileRef): UnitView[] {
    return this.defensePostGrid.nearbyDefenses(tile) as UnitView[];
  }

  myClientID(): ClientID {
    return this._myClientID;
  }

  myPlayer(): PlayerView | null {
    if (this._myPlayer == null) {
      this._myPlayer = this.playerByClientID(this._myClientID);
    }
    return this._myPlayer;
  }

  player(id: PlayerID): PlayerView {
    if (this._players.has(id)) {
      return this._players.get(id);
    }
    throw Error(`player id ${id} not found`);
  }

  playerBySmallID(id: number): PlayerView | TerraNullius {
    if (id == 0) {
      return new TerraNulliusImpl();
    }
    if (!this.smallIDToID.has(id)) {
      throw new Error(`small id ${id} not found`);
    }
    return this.player(this.smallIDToID.get(id));
  }

  playerByClientID(id: ClientID): PlayerView | null {
    const player =
      Array.from(this._players.values()).filter((p) => p.clientID() == id)[0] ??
      null;
    if (player == null) {
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
    return this.lastUpdate.tick;
  }
  inSpawnPhase(): boolean {
    return this.lastUpdate.tick <= this._config.numSpawnPhaseTurns();
  }
  config(): Config {
    return this._config;
  }
  units(...types: UnitType[]): UnitView[] {
    if (types.length == 0) {
      return Array.from(this._units.values()).filter((u) => u.isActive());
    }
    return Array.from(this._units.values()).filter(
      (u) => u.isActive() && types.includes(u.type()),
    );
  }
  unit(id: number): UnitView {
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
  euclideanDist(c1: TileRef, c2: TileRef): number {
    return this._map.euclideanDist(c1, c2);
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
}
