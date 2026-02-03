import { Colord, colord } from "colord";
import { Theme } from "../configuration/Config";
import { UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import {
  AllianceExpiredUpdate,
  AllianceRequestReplyUpdate,
  BrokeAllianceUpdate,
  EmbargoUpdate,
  GameUpdateType,
  GameUpdateViewData,
  PlayerUpdate,
  UnitUpdate,
} from "../game/GameUpdates";
import { GameView } from "../game/GameView";
import { ClientID, PlayerCosmetics } from "../Schemas";

class DefensePostUnit {
  public index = -1;
  private readonly ownerView = { smallID: () => this.ownerSmallId };

  constructor(
    public readonly id: number,
    private tileRef: TileRef,
    private ownerSmallId: number,
  ) {}

  isActive(): boolean {
    return true;
  }

  isUnderConstruction(): boolean {
    return false;
  }

  tile(): TileRef {
    return this.tileRef;
  }

  owner(): { smallID: () => number } {
    return this.ownerView;
  }

  set(tileRef: TileRef, ownerSmallId: number): void {
    this.tileRef = tileRef;
    this.ownerSmallId = ownerSmallId;
  }
}

class PlayerLiteView {
  private readonly territoryRgba = { r: 0, g: 0, b: 0, a: 255 };
  private readonly borderRgba = { r: 0, g: 0, b: 0, a: 255 };
  private readonly territoryObj = { rgba: this.territoryRgba };
  private readonly borderObj = { rgba: this.borderRgba };

  constructor(
    private readonly adapter: GameViewAdapter,
    public data: PlayerUpdate,
  ) {}

  id(): string {
    return this.data.id;
  }

  smallID(): number {
    return this.data.smallID;
  }

  clientID(): ClientID | null {
    return this.data.clientID;
  }

  team(): any | null {
    return this.data.team ?? null;
  }

  type(): any {
    return this.data.playerType;
  }

  isPlayer(): boolean {
    return true;
  }

  territoryColor(): { rgba: { r: number; g: number; b: number; a: number } } {
    this.ensureColors();
    return this.territoryObj;
  }

  borderColor(): { rgba: { r: number; g: number; b: number; a: number } } {
    this.ensureColors();
    return this.borderObj;
  }

  hasEmbargoAgainst(other: PlayerLiteView): boolean {
    return this.adapter.hasEmbargoPair(this.smallID(), other.smallID());
  }

  hasEmbargo(other: PlayerLiteView): boolean {
    return this.hasEmbargoAgainst(other) || other.hasEmbargoAgainst(this);
  }

  isFriendly(other: PlayerLiteView): boolean {
    const team = this.team();
    return (
      (team !== null && team === other.team()) ||
      this.adapter.hasFriendlyPair(this.smallID(), other.smallID())
    );
  }

  markColorsDirty(): void {
    this.adapter.markPlayerColorsDirty(this.smallID());
  }

  private ensureColors(): void {
    if (!this.adapter.consumePlayerColorsDirty(this.smallID())) {
      return;
    }

    const theme = this.adapter.getTheme();
    const defaultTerritoryColor = theme.territoryColor(this as any);
    const defaultBorderColor = theme.borderColor(defaultTerritoryColor);

    const cosmetics = this.adapter.getCosmetics(this.clientID());
    const pattern = this.adapter.getPatternsEnabled()
      ? cosmetics.pattern
      : undefined;
    if (pattern) {
      (pattern as any).colorPalette ??= {
        name: "",
        primaryColor: defaultTerritoryColor.toHex(),
        secondaryColor: defaultBorderColor.toHex(),
      };
    }

    const territoryColor: Colord =
      this.team() === null
        ? colord(
            cosmetics.color?.color ??
              (pattern as any)?.colorPalette?.primaryColor ??
              defaultTerritoryColor.toHex(),
          )
        : defaultTerritoryColor;

    const maybeFocusedBorderColor =
      this.adapter.getMyClientId() !== null &&
      this.clientID() === this.adapter.getMyClientId()
        ? theme.focusedBorderColor()
        : defaultBorderColor;

    const borderColor: Colord = colord(
      (pattern as any)?.colorPalette?.secondaryColor ??
        cosmetics.color?.color ??
        maybeFocusedBorderColor.toHex(),
    );

    const tc = territoryColor.toRgb();
    this.territoryRgba.r = Math.round(tc.r);
    this.territoryRgba.g = Math.round(tc.g);
    this.territoryRgba.b = Math.round(tc.b);
    this.territoryRgba.a = 255;

    const bc = borderColor.toRgb();
    this.borderRgba.r = Math.round(bc.r);
    this.borderRgba.g = Math.round(bc.g);
    this.borderRgba.b = Math.round(bc.b);
    this.borderRgba.a = 255;
  }
}

/**
 * Adapter that makes Game work as GameView for rendering purposes.
 * Provides the interface that GroundTruthData and rendering passes need,
 * without requiring the full GameView infrastructure.
 */
export class GameViewAdapter implements Partial<GameView> {
  private lastUpdate: GameUpdateViewData | null = null;
  private patternsEnabled = false;

  private defensePostsDirty = true;
  private readonly defensePostsById = new Map<number, DefensePostUnit>();
  private readonly defensePosts: DefensePostUnit[] = [];

  // "Dirty" here means "palette/relations roster may have changed" (not "any player field updated").
  private playersDirty = true;
  private rosterDirty = true;
  private readonly playersBySmallId = new Map<number, PlayerLiteView>();
  private playerViewsCache: PlayerLiteView[] = [];
  private rosterEpoch = 1;
  private playerViewsCacheEpoch = 0;
  private playerColorsEpoch = 1;
  private readonly playerColorsDirtyEpochBySmallId = new Map<number, number>();
  private readonly embargoPairs = new Set<bigint>();
  private readonly friendlyPairs = new Set<bigint>();
  private relationsInitialized = false;
  private readonly emptyCosmetics = {} as PlayerCosmetics;

  constructor(
    private tileState: Uint16Array,
    private terrainData: Uint8Array,
    private readonly mapWidth: number,
    private readonly mapHeight: number,
    private theme: Theme,
    private readonly myClientId: ClientID | null,
    private readonly cosmeticsByClientID: Map<ClientID, PlayerCosmetics>,
  ) {
    void 0;
  }

  getMyClientId(): ClientID | null {
    return this.myClientId;
  }

  getTheme(): Theme {
    return this.theme;
  }

  getPatternsEnabled(): boolean {
    return this.patternsEnabled;
  }

  getCosmetics(clientId: ClientID | null): PlayerCosmetics {
    if (!clientId) {
      return this.emptyCosmetics;
    }
    return this.cosmeticsByClientID.get(clientId) ?? this.emptyCosmetics;
  }

  private static pairKey(a: number, b: number): bigint {
    const lo = Math.min(a, b) >>> 0;
    const hi = Math.max(a, b) >>> 0;
    return (BigInt(lo) << 32n) | BigInt(hi);
  }

  hasEmbargoPair(aSmallId: number, bSmallId: number): boolean {
    return this.embargoPairs.has(GameViewAdapter.pairKey(aSmallId, bSmallId));
  }

  hasFriendlyPair(aSmallId: number, bSmallId: number): boolean {
    return this.friendlyPairs.has(GameViewAdapter.pairKey(aSmallId, bSmallId));
  }

  markPlayerColorsDirty(smallId: number): void {
    this.playerColorsDirtyEpochBySmallId.delete(smallId);
  }

  consumePlayerColorsDirty(smallId: number): boolean {
    const last = this.playerColorsDirtyEpochBySmallId.get(smallId) ?? 0;
    if (last === this.playerColorsEpoch) {
      return false;
    }
    this.playerColorsDirtyEpochBySmallId.set(smallId, this.playerColorsEpoch);
    return true;
  }

  private upsertDefensePost(
    id: number,
    tile: TileRef,
    ownerSmallId: number,
  ): void {
    const existing = this.defensePostsById.get(id);
    if (existing) {
      if (
        existing.tile() !== tile ||
        existing.owner().smallID() !== ownerSmallId
      ) {
        existing.set(tile, ownerSmallId);
        this.defensePostsDirty = true;
      }
      return;
    }

    const unit = new DefensePostUnit(id, tile, ownerSmallId);
    unit.index = this.defensePosts.length;
    this.defensePosts.push(unit);
    this.defensePostsById.set(id, unit);
    this.defensePostsDirty = true;
  }

  private removeDefensePost(id: number): void {
    const existing = this.defensePostsById.get(id);
    if (!existing) {
      return;
    }

    const idx = existing.index;
    const last = this.defensePosts.pop();
    if (last && last !== existing) {
      this.defensePosts[idx] = last;
      last.index = idx;
    }
    this.defensePostsById.delete(id);
    this.defensePostsDirty = true;
  }

  consumeDefensePostsDirty(): boolean {
    const dirty = this.defensePostsDirty;
    this.defensePostsDirty = false;
    return dirty;
  }

  consumePlayersDirty(): boolean {
    const dirty = this.playersDirty;
    this.playersDirty = false;
    return dirty;
  }

  consumeRosterDirty(): boolean {
    const dirty = this.rosterDirty;
    this.rosterDirty = false;
    return dirty;
  }

  setPatternsEnabled(enabled: boolean): void {
    if (this.patternsEnabled === enabled) {
      return;
    }
    this.patternsEnabled = enabled;
    this.playersDirty = true;
    this.playerColorsEpoch++;
  }

  /**
   * Update adapter with latest game update data.
   * Invalidates caches so they're recomputed on next access.
   */
  update(gu: GameUpdateViewData): void {
    this.lastUpdate = gu;

    const playerUpdates = (gu.updates?.[GameUpdateType.Player] ??
      []) as PlayerUpdate[];
    let rosterChanged = false;
    let paletteRelevantChanged = false;
    for (const p of playerUpdates) {
      const small = p.smallID;
      if (small <= 0) {
        continue;
      }
      const existing = this.playersBySmallId.get(small);
      if (existing) {
        const prev = existing.data;
        existing.data = p;
        const teamChanged = (prev.team ?? null) !== (p.team ?? null);
        const colorRelevantChanged =
          teamChanged ||
          prev.clientID !== p.clientID ||
          prev.playerType !== p.playerType ||
          prev.isAlive !== p.isAlive ||
          prev.isDisconnected !== p.isDisconnected;
        if (colorRelevantChanged) {
          existing.markColorsDirty();
          paletteRelevantChanged = true;
        }
        if (teamChanged) {
          // Team changes affect "friendly" relations matrix across many pairs.
          // Treat it like a roster change to force a full relations rebuild.
          rosterChanged = true;
        }
      } else {
        this.playersBySmallId.set(small, new PlayerLiteView(this, p));
        rosterChanged = true;
        paletteRelevantChanged = true;
      }
    }

    if (rosterChanged) {
      this.rosterDirty = true;
      this.rosterEpoch++;
    }
    if (rosterChanged || paletteRelevantChanged) {
      this.playersDirty = true;
    }

    const shouldRebuildRelationsSnapshot =
      rosterChanged || (!this.relationsInitialized && playerUpdates.length > 0);
    if (shouldRebuildRelationsSnapshot) {
      // Rebuild relations snapshot from authoritative PlayerUpdate state.
      // This ensures correct initial relations without relying on event history.
      this.embargoPairs.clear();
      this.friendlyPairs.clear();

      const idToSmall = new Map<string, number>();
      for (const v of this.playersBySmallId.values()) {
        idToSmall.set(v.data.id, v.data.smallID);
      }
      for (const v of this.playersBySmallId.values()) {
        const a = v.data.smallID;
        if (a <= 0) continue;

        for (const b of v.data.allies ?? []) {
          if (typeof b === "number" && b > 0) {
            this.friendlyPairs.add(GameViewAdapter.pairKey(a, b));
          }
        }

        for (const otherId of v.data.embargoes ?? []) {
          if (typeof otherId !== "string") continue;
          const b = idToSmall.get(otherId) ?? 0;
          if (b > 0) {
            this.embargoPairs.add(GameViewAdapter.pairKey(a, b));
          }
        }
      }

      this.relationsInitialized = true;
    }

    const embargoUpdates = (gu.updates?.[GameUpdateType.EmbargoEvent] ??
      []) as EmbargoUpdate[];
    for (const e of embargoUpdates) {
      const key = GameViewAdapter.pairKey(e.playerID, e.embargoedID);
      if (e.event === "start") {
        this.embargoPairs.add(key);
      } else {
        this.embargoPairs.delete(key);
      }
    }

    const allianceReplies = (gu.updates?.[
      GameUpdateType.AllianceRequestReply
    ] ?? []) as AllianceRequestReplyUpdate[];
    for (const e of allianceReplies) {
      if (!e.accepted) {
        continue;
      }
      this.friendlyPairs.add(
        GameViewAdapter.pairKey(e.request.requestorID, e.request.recipientID),
      );
    }

    const brokeAllianceUpdates = (gu.updates?.[GameUpdateType.BrokeAlliance] ??
      []) as BrokeAllianceUpdate[];
    for (const e of brokeAllianceUpdates) {
      this.friendlyPairs.delete(
        GameViewAdapter.pairKey(e.traitorID, e.betrayedID),
      );
    }

    const expiredUpdates = (gu.updates?.[GameUpdateType.AllianceExpired] ??
      []) as AllianceExpiredUpdate[];
    for (const e of expiredUpdates) {
      this.friendlyPairs.delete(
        GameViewAdapter.pairKey(e.player1ID, e.player2ID),
      );
    }

    const unitUpdates = (gu.updates?.[GameUpdateType.Unit] ??
      []) as UnitUpdate[];
    for (const u of unitUpdates) {
      if (u.unitType !== UnitType.DefensePost) {
        continue;
      }

      const removed =
        u.markedForDeletion !== false ||
        !u.isActive ||
        u.underConstruction === true;
      if (removed) {
        this.removeDefensePost(u.id);
      } else {
        this.upsertDefensePost(u.id, u.pos, u.ownerID);
      }
    }
  }

  width(): number {
    return this.mapWidth;
  }

  height(): number {
    return this.mapHeight;
  }

  x(tile: TileRef): number {
    return tile % this.mapWidth;
  }

  y(tile: TileRef): number {
    return (tile / this.mapWidth) | 0;
  }

  playerBySmallID(smallId: number): any | null {
    return this.playersBySmallId.get(smallId) ?? null;
  }

  units(...types: UnitType[]): any[] {
    if (types.length === 1 && types[0] === UnitType.DefensePost) {
      return this.defensePosts;
    }
    return [];
  }

  /**
   * Return the authoritative tile state view.
   *
   * Important: this must be the live backing buffer, because GPU update passes
   * read from it when individual tiles are marked dirty.
   */
  tileStateView(): Uint16Array {
    return this.tileState;
  }

  /**
   * Return the immutable terrain data view.
   */
  terrainDataView(): Uint8Array {
    return this.terrainData;
  }

  /**
   * Convert Game players to PlayerView-like objects for rendering.
   *
   * Important: this must match the *main-thread* PlayerView color selection,
   * otherwise the worker-rendered territory will disagree with UI.
   */
  playerViews(): any[] {
    if (this.playerViewsCacheEpoch !== this.rosterEpoch) {
      this.playerViewsCache = [...this.playersBySmallId.values()];
      this.playerViewsCacheEpoch = this.rosterEpoch;
    }
    return this.playerViewsCache;
  }

  /**
   * Get my player for highlighting (returns null in worker context).
   */
  myPlayer(): any | null {
    // Return null for now - this is used for highlighting
    // Could be implemented if we track clientID in worker
    return null;
  }

  /**
   * Get recently updated tiles from last game update.
   */
  recentlyUpdatedTiles(): TileRef[] {
    if (!this.lastUpdate) {
      return [];
    }
    // packedTileUpdates encode [tileRef << 16 | state] as bigint.
    const packed = this.lastUpdate.packedTileUpdates;
    const out: TileRef[] = new Array(packed.length);
    for (let i = 0; i < packed.length; i++) {
      out[i] = Number(packed[i] >> 16n);
    }
    return out;
  }
}
