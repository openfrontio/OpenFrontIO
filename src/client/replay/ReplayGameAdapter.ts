/**
 * Makes a replay frame look like a GameView so the game's HUD components
 * can be reused as they are.
 *
 * Names and colours come from the replay's player dictionary, the per-tick
 * numbers from the decoded frame. It's read-only, nothing here sends
 * intents.
 *
 * The event feed is written from one player's point of view ("X broke
 * their alliance with you"), so the viewer follows one player at a time.
 * `focus` is who myPlayer() returns, and the events come from the frame's
 * misc updates.
 *
 * Only what the HUD actually reads is implemented. The components type
 * their properties as the real classes, which have private fields, so
 * asGameView() does the cast once here. If a component calls something
 * that's missing it throws instead of quietly rendering nothing, and the
 * tests rely on that.
 */

import type { Config } from "../../core/configuration/Config";
import type { PlayerType, Team, UnitType } from "../../core/game/Game";
import type { TileRef } from "../../core/game/GameMap";
import { GameUpdateType } from "../../core/game/GameUpdates";
import { OWNER_MASK } from "../render/gl/utils/TileCodec";
import type {
  NameEntry,
  PlayerState,
  PlayerStatic,
  UnitState,
} from "../render/types";
import type { GameView } from "../view";
import { playerTypeFromEnum } from "../view/EntityState";
import type { ReplayFrame } from "./codec/ReplayTypes";

/** A unit as the HUD reads it (Config.maxTroops, the ship counts). */
export class ReplayUnitView {
  constructor(private readonly state: UnitState) {}

  id(): number {
    return this.state.id;
  }
  type(): UnitType {
    return this.state.unitType as UnitType;
  }
  level(): number {
    return this.state.level;
  }
  troops(): number {
    return this.state.troops;
  }
  isActive(): boolean {
    return this.state.isActive;
  }
  isUnderConstruction(): boolean {
    return this.state.underConstruction;
  }
  missileTimerQueue(): number[] {
    return this.state.missileTimerQueue;
  }
  tile(): TileRef {
    return this.state.pos as TileRef;
  }
}

export class ReplayPlayerView {
  // Written by ReplayGameView.sync, read through the accessors below.
  /** The current frame's state, undefined before the player appears. */
  current: PlayerState | undefined;
  /** Sum of the player's unit levels. */
  unitLevels = 0;
  /** This player's active units in the current frame. */
  ownUnits: ReplayUnitView[] = [];

  constructor(
    private readonly game: ReplayGameView,
    /** Replaced by restyle() when the graphics settings change. */
    public info: PlayerStatic,
  ) {}

  private get state(): PlayerState | undefined {
    this.game.sync();
    return this.current;
  }

  id(): string {
    return this.info.id;
  }
  smallID(): number {
    return this.info.smallID;
  }
  clientID(): string | null {
    return this.info.clientID;
  }
  name(): string {
    return this.info.name;
  }
  displayName(): string {
    return this.info.displayName;
  }
  clanTag(): string | null {
    return this.info.clanTag;
  }
  type(): PlayerType {
    return playerTypeFromEnum(this.info.playerType);
  }
  team(): Team | null {
    return this.info.team;
  }
  flag(): string | undefined {
    return this.info.flag;
  }
  /** Where the player's name is drawn, once it has been placed. */
  nameLocation(): { x: number; y: number; size: number } | undefined {
    const n = this.game.nameOf(this.info.id);
    return n === undefined || n.size === 0 ? undefined : n;
  }
  /** The flag and crown shown next to the name (from ReplayPalette). */
  get cosmetics(): { flag?: string; crown?: { url: string } } {
    return {
      ...(this.info.flag === undefined ? {} : { flag: this.info.flag }),
      ...(this.info.crown === undefined
        ? {}
        : { crown: { url: this.info.crown } }),
    };
  }
  isPlayer(): boolean {
    return true;
  }
  isAlive(): boolean {
    return this.state?.isAlive ?? false;
  }
  hasSpawned(): boolean {
    return this.state?.hasSpawned ?? false;
  }
  isTraitor(): boolean {
    return this.state?.isTraitor ?? false;
  }
  getTraitorRemainingTicks(): number {
    return this.state?.traitorRemainingTicks ?? 0;
  }
  isDisconnected(): boolean {
    return this.state?.isDisconnected ?? false;
  }
  inDoomsdayClock(): boolean {
    return this.state?.inDoomsdayClock ?? false;
  }
  isDecaying(): boolean {
    return this.state?.isDecaying ?? false;
  }
  markedDoomsdayClockTick(): number {
    return this.state?.markedDoomsdayClockTick ?? 0;
  }
  /** Pending alliance requests, as of this frame. */
  isRequestingAllianceWith(other: ReplayPlayerView): boolean {
    return (this.state?.outgoingAllianceRequests ?? []).includes(other.id());
  }
  hasEmbargoAgainst(other: ReplayPlayerView): boolean {
    return (this.state?.embargoes ?? []).includes(other.smallID());
  }
  outgoingEmojis(): PlayerState["outgoingEmojis"] {
    if (!this.game.showEmojis()) return [];
    return this.state?.outgoingEmojis ?? [];
  }
  outgoingAttacks(): PlayerState["outgoingAttacks"] {
    return this.state?.outgoingAttacks ?? [];
  }
  incomingAttacks(): PlayerState["incomingAttacks"] {
    return this.state?.incomingAttacks ?? [];
  }
  alliances(): PlayerState["alliances"] {
    return this.state?.alliances ?? [];
  }
  targets(): ReplayPlayerView[] {
    return (this.state?.targets ?? []).flatMap((id) => {
      const p = this.game.playerBySmallID(id);
      return p === undefined ? [] : [p];
    });
  }
  numTilesOwned(): number {
    return this.state?.tilesOwned ?? 0;
  }
  gold(): bigint {
    return BigInt(Math.round(this.state?.gold ?? 0));
  }
  goldEarned(): number {
    return this.state?.goldEarned ?? 0;
  }
  tradeGold(): number {
    return this.state?.tradeGold ?? 0;
  }
  trainGold(): number {
    return this.state?.trainGold ?? 0;
  }
  piracyGold(): number {
    return this.state?.piracyGold ?? 0;
  }
  troops(): number {
    return this.state?.troops ?? 0;
  }
  betrayals(): number {
    return this.state?.betrayals ?? 0;
  }
  totalUnitLevels(): number {
    this.game.sync();
    return this.unitLevels;
  }
  units(...types: UnitType[]): ReplayUnitView[] {
    this.game.sync();
    return types.length === 0
      ? this.ownUnits
      : this.ownUnits.filter((u) => types.includes(u.type()));
  }
  allies(): ReplayPlayerView[] {
    return (this.state?.allies ?? []).flatMap((id) => {
      const p = this.game.playerBySmallID(id);
      return p === undefined ? [] : [p];
    });
  }
  isAlliedWith(other: ReplayPlayerView): boolean {
    return (this.state?.allies ?? []).includes(other.smallID());
  }
  isOnSameTeam(other: ReplayPlayerView): boolean {
    return this.info.team !== null && this.info.team === other.team();
  }
  isFriendly(other: ReplayPlayerView): boolean {
    return this.isAlliedWith(other) || this.isOnSameTeam(other);
  }
  /**
   * The live client fetches this from the API. The only part the HUD shows
   * is who the player is allied with, and that's in the frame.
   */
  profile(): Promise<{
    relations: Record<number, never>;
    alliances: number[];
  }> {
    return Promise.resolve({
      relations: {},
      alliances: [...(this.state?.allies ?? [])],
    });
  }
}

export class ReplayGameView {
  private readonly bySmallID = new Map<number, ReplayPlayerView>();
  private readonly order: ReplayPlayerView[] = [];
  private frame: ReplayFrame | null = null;
  /** The player views haven't caught up with the frame yet (see sync). */
  private stale = false;
  private spawnPhase = true;
  /** Land tiles now (water nukes sink some, see ReplayTerrain). */
  private landTiles: number;
  /** The player being followed, or null. */
  focus: ReplayPlayerView | null = null;
  /** Whether emojis are shown (the "emojis" user setting). */
  showEmojis: () => boolean = () => true;
  /** Events since the HUD last asked, by GameUpdateType. */
  private readonly pending = new Map<number, unknown[]>();

  constructor(
    players: readonly PlayerStatic[],
    private readonly _config: Config,
    private readonly mapWidth: number,
    private readonly mapHeight: number,
    /** Land tiles when the game started. */
    private readonly startLandTiles: number,
    /** Terrain bytes of the current frame (ReplayTerrain). */
    private terrain: Uint8Array,
  ) {
    this.landTiles = startLandTiles;
    this.addPlayers(players);
  }

  /** Players seen for the first time (a game that's still being processed). */
  addPlayers(players: readonly PlayerStatic[]): void {
    for (const info of players) {
      if (this.bySmallID.has(info.smallID)) continue;
      const view = new ReplayPlayerView(this, info);
      this.bySmallID.set(info.smallID, view);
      this.order.push(view);
    }
    this.stale = true;
  }

  /**
   * Point the view at a decoded frame. The HUD updates about once a second
   * and frames come ten times faster, so events are kept until the HUD
   * asks for them. A seek clears them, since events from before a jump
   * aren't recent anymore. `inSpawnPhase` comes from the frame builder,
   * `landChange` from ReplayTerrain.
   */
  update(
    frame: ReplayFrame,
    terrain: Uint8Array,
    landChange: number,
    inSpawnPhase: boolean,
    seeked = false,
  ): void {
    this.frame = frame;
    this.terrain = terrain;
    this.landTiles = this.startLandTiles + landChange;
    this.spawnPhase = inSpawnPhase;
    this.stale = true;
    if (seeked) this.pending.clear();
    for (const [name, list] of Object.entries(frame.miscUpdates ?? {})) {
      if (list.length === 0) continue;
      const type = GameUpdateType[name as keyof typeof GameUpdateType];
      if (typeof type !== "number") continue;
      const into = this.pending.get(type);
      if (into === undefined) this.pending.set(type, [...list]);
      else into.push(...list);
    }
  }

  /**
   * Bring the player views up to date with the current frame. This loops
   * over every unit, so it only runs when the HUD reads a player (about
   * once a second) instead of on every frame.
   */
  sync(): void {
    const frame = this.frame;
    if (!this.stale || frame === null) return;
    this.stale = false;
    for (const view of this.order) {
      view.current = frame.players.get(view.smallID());
      view.unitLevels = 0;
      view.ownUnits = [];
    }
    for (const unit of frame.units.values() as Iterable<UnitState>) {
      if (!unit.isActive) continue;
      const owner = this.bySmallID.get(unit.ownerID);
      if (owner === undefined) continue;
      owner.unitLevels += unit.level;
      owner.ownUnits.push(new ReplayUnitView(unit));
    }
  }

  /** Update player info after the graphics settings changed. */
  restyle(players: readonly PlayerStatic[]): void {
    for (const info of players) {
      const view = this.bySmallID.get(info.smallID);
      if (view !== undefined) view.info = info;
    }
  }

  /** A player's name placement in the current frame. */
  nameOf(playerID: string): NameEntry | undefined {
    return this.frame?.names.get(playerID);
  }

  config(): Config {
    return this._config;
  }
  ticks(): number {
    return this.frame?.tick ?? 0;
  }
  /** The player being followed (the HUD's "you"), if any. */
  myPlayer(): ReplayPlayerView | null {
    return this.focus;
  }
  inSpawnPhase(): boolean {
    return this.spawnPhase;
  }
  unit(id: number): ReplayUnitView | undefined {
    const state = this.frame?.units.get(id);
    return state === undefined ? undefined : new ReplayUnitView(state);
  }
  /** Events since the HUD last asked, in the shape the HUD expects. */
  updatesSinceLastTick(): Record<number, unknown[]> {
    const out: Record<number, unknown[]> = {};
    for (const value of Object.values(GameUpdateType)) {
      if (typeof value === "number") out[value] = [];
    }
    for (const [type, list] of this.pending) out[type] = list;
    this.pending.clear();
    return out;
  }
  playerViews(): ReplayPlayerView[] {
    return this.order;
  }
  playerBySmallID(id: number): ReplayPlayerView | undefined {
    return this.bySmallID.get(id);
  }
  player(id: string): ReplayPlayerView | undefined {
    return this.order.find((p) => p.id() === id);
  }
  /** Active units in the frame, filtered by type (for the ship hover cards). */
  units(...types: UnitType[]): ReplayUnitView[] {
    this.sync();
    const all = this.order.flatMap((p) => p.ownUnits);
    return types.length === 0
      ? all
      : all.filter((u) => types.includes(u.type()));
  }
  numTilesWithFallout(): number {
    return this.frame?.falloutTiles ?? 0;
  }
  numLandTiles(): number {
    return this.landTiles;
  }
  teamClanTag(team: Team): string | null {
    const tags = new Set(
      this.order
        .filter((p) => p.team() === team && p.clanTag() !== null)
        .map((p) => p.clanTag()!),
    );
    return tags.size === 1 ? [...tags][0] : null;
  }

  // ---- Tiles ----

  width(): number {
    return this.mapWidth;
  }
  height(): number {
    return this.mapHeight;
  }
  x(ref: TileRef): number {
    return ref % this.mapWidth;
  }
  y(ref: TileRef): number {
    return Math.floor(ref / this.mapWidth);
  }
  ref(x: number, y: number): TileRef {
    return (y * this.mapWidth + x) as TileRef;
  }
  isValidCoord(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.mapWidth && y < this.mapHeight;
  }
  isLand(ref: TileRef): boolean {
    // GameMapImpl.IS_LAND_BIT.
    return (this.terrain[ref] & (1 << 7)) !== 0;
  }
  /** The player owning a tile, or a TerraNullius stand-in. */
  owner(ref: TileRef): ReplayPlayerView | { isPlayer(): boolean } {
    // The low bits are the owner's smallID; the rest are render flags.
    const smallID = (this.frame?.tileState[ref] ?? 0) & OWNER_MASK;
    const player = smallID === 0 ? undefined : this.bySmallID.get(smallID);
    return player ?? { isPlayer: () => false };
  }

  /** Cast for the HUD components' property types (see the file comment). */
  asGameView(): GameView {
    return this as unknown as GameView;
  }
}
