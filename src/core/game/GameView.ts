import { base64url } from "jose";
import { Config } from "../configuration/Config";
import { PatternDecoder } from "../PatternDecoder";
import { ClientID, GameID, Player } from "../Schemas";
import { createRandomName } from "../Util";
import { WorkerClient } from "../worker/WorkerClient";
import {
  Cell,
  EmojiMessage,
  GameUpdates,
  Gold,
  NameViewData,
  PlayerActions,
  PlayerBorderTiles,
  PlayerID,
  PlayerProfile,
  PlayerType,
  Team,
  TerrainType,
  TerraNullius,
  Tick,
  TrainType,
  UnitInfo,
  UnitType,
} from "./Game";
import { GameMap, TileRef, TileUpdate } from "./GameMap";
import {
  AllianceView,
  AttackUpdate,
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { TerrainMapData } from "./TerrainMapLoader";
import { TerraNulliusImpl } from "./TerraNulliusImpl";
import { UnitGrid, UnitPredicate } from "./UnitGrid";
import { UserSettings } from "./UserSettings";

const userSettings: UserSettings = new UserSettings();

interface PlayerCosmetics {
  pattern?: string | undefined;
  flag?: string | undefined;
}

export class UnitView {
  public _wasUpdated = true;
  public lastPos: TileRef[] = [];
  private _createdAt: Tick;

  constructor(
    private gameView: GameView,
    private data: UnitUpdate,
  ) {
    this.lastPos.push(data.pos);
    this._createdAt = this.gameView.ticks();
  }

  createdAt(): Tick {
    return this._createdAt;
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

  targetable(): boolean {
    return this.data.targetable;
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

  // How "ready" this unit is from 0 to 1.
  missileReadinesss(): number {
    const maxMissiles = this.data.level;
    const missilesReloading = this.data.missileTimerQueue.length;

    if (missilesReloading === 0) {
      return 1;
    }

    const missilesReady = maxMissiles - missilesReloading;

    if (missilesReady === 0 && maxMissiles > 1) {
      // Unless we have just one missile (level 1),
      // show 0% readiness so user knows no missiles are ready.
      return 0;
    }

    let readiness = missilesReady / maxMissiles;

    const cooldownDuration =
      this.data.unitType === UnitType.SAMLauncher
        ? this.gameView.config().SAMCooldown()
        : this.gameView.config().SiloCooldown();

    for (const cooldown of this.data.missileTimerQueue) {
      const cooldownProgress = this.gameView.ticks() - cooldown;
      const cooldownRatio = cooldownProgress / cooldownDuration;
      const adjusted = cooldownRatio / maxMissiles;
      readiness += adjusted;
    }
    return readiness;
  }

  level(): number {
    return this.data.level;
  }
  hasTrainStation(): boolean {
    return this.data.hasTrainStation;
  }
  trainType(): TrainType | undefined {
    return this.data.trainType;
  }
  isLoaded(): boolean | undefined {
    return this.data.loaded;
  }
}

export class PlayerView {
  public anonymousName: string | null = null;
  private decoder?: PatternDecoder;

  constructor(
    private game: GameView,
    public data: PlayerUpdate,
    public nameData: NameViewData,
    public cosmetics: PlayerCosmetics,
  ) {
    if (data.clientID === game.myClientID()) {
      this.anonymousName = this.data.name;
    } else {
      this.anonymousName = createRandomName(
        this.data.name,
        this.data.playerType,
      );
    }
    this.decoder =
      this.cosmetics.pattern === undefined
        ? undefined
        : new PatternDecoder(this.cosmetics.pattern, base64url.decode);
  }

  patternDecoder(): PatternDecoder | undefined {
    return this.decoder;
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
  isPlayer(): this is PlayerView {
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

  troops(): number {
    return this.data.troops;
  }

  totalUnitLevels(type: UnitType): number {
    return this.units(type)
      .map((unit) => unit.level())
      .reduce((a, b) => a + b, 0);
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

  alliances(): AllianceView[] {
    return this.data.alliances;
  }

  hasEmbargoAgainst(other: PlayerView): boolean {
    return this.data.embargoes.has(other.id());
  }

  hasEmbargo(other: PlayerView): boolean {
    return this.hasEmbargoAgainst(other) || other.hasEmbargoAgainst(this);
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

  private _cosmetics: Map<string, PlayerCosmetics> = new Map();

  private _map: GameMap;

  constructor(
    public worker: WorkerClient,
    private _config: Config,
    private _mapData: TerrainMapData,
    private _myClientID: ClientID,
    private _gameID: GameID,
    private humans: Player[],
  ) {
    this._map = this._mapData.gameMap;
    this.lastUpdate = null;
    this.unitGrid = new UnitGrid(this._map);
    this._cosmetics = new Map(
      this.humans.map((h) => [
        h.clientID,
        { flag: h.flag, pattern: h.pattern } satisfies PlayerCosmetics,
      ]),
    );
    for (const nation of this._mapData.manifest.nations) {
      // Nations don't have client ids, so we use their name as the key instead.
      this._cosmetics.set(nation.name, {
        flag: nation.flag,
      });
    }
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
          new PlayerView(
            this,
            pu,
            gu.playerNameViewData[pu.id],
            // First check human by clientID, then check nation by name.
            this._cosmetics.get(pu.clientID ?? "") ??
              this._cosmetics.get(pu.name) ??
              {},
          ),
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
        this.unitGrid.addUnit(unit);
      }
      if (!update.isActive) {
        this.unitGrid.removeUnit(unit);
      } else if (unit.tile() !== unit.lastTile()) {
        this.unitGrid.updateUnitCell(unit);
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
    predicate?: UnitPredicate,
  ): Array<{ unit: UnitView; distSquared: number }> {
    return this.unitGrid.nearbyUnits(
      tile,
      searchRange,
      types,
      predicate,
    ) as Array<{
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
    this._myPlayer ??= this.playerByClientID(this._myClientID);
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
  isValidRef(ref: TileRef): boolean {
    return this._map.isValidRef(ref);
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
