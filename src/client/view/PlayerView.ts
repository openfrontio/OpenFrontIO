import { Colord, colord } from "colord";
import { base64url } from "jose";
import { ColorPalette } from "../../core/CosmeticSchemas";
import { PatternDecoder } from "../../core/PatternDecoder";
import { ClientID, PlayerCosmetics } from "../../core/Schemas";
import { createRandomName } from "../../core/Util";
import {
  BuildableUnit,
  Cell,
  EmojiMessage,
  Gold,
  NameViewData,
  PlayerActions,
  PlayerBorderTiles,
  PlayerBuildableUnitType,
  PlayerID,
  PlayerProfile,
  PlayerType,
  Team,
  Tick,
  UnitType,
} from "../../core/game/Game";
import { TileRef } from "../../core/game/GameMap";
import { applyStateUpdate } from "../../core/game/GameUpdateUtils";
import {
  AllianceView,
  AttackUpdate,
  PlayerUpdate,
} from "../../core/game/GameUpdates";
import { UserSettings } from "../../core/game/UserSettings";
import { PlayerState, PlayerStatic, PlayerTypeEnum } from "../render/types";
import { themeProvider } from "../theme/ThemeProvider";
import { GameView } from "./GameView";
import { UnitView } from "./UnitView";

const userSettings: UserSettings = new UserSettings();

const FRIENDLY_TINT_TARGET = { r: 0, g: 255, b: 0, a: 1 };
const EMBARGO_TINT_TARGET = { r: 255, g: 0, b: 0, a: 1 };
const BORDER_TINT_RATIO = 0.35;

function gamePlayerTypeToEnum(t: PlayerType): PlayerTypeEnum {
  switch (t) {
    case PlayerType.Human:
      return PlayerTypeEnum.Human;
    case PlayerType.Bot:
      return PlayerTypeEnum.Bot;
    case PlayerType.Nation:
      return PlayerTypeEnum.Nation;
    default:
      return PlayerTypeEnum.Bot;
  }
}

// First-emission updates from the engine always include every field; these
// builders assert non-null for that contract. Subsequent diffs are partial
// and flow through applyStateUpdate() below.
function staticFromUpdate(pu: PlayerUpdate): PlayerStatic {
  return {
    smallID: pu.smallID!,
    id: pu.id,
    name: pu.name!,
    displayName: pu.displayName!,
    clientID: pu.clientID ?? null,
    playerType: gamePlayerTypeToEnum(pu.playerType!),
    team: pu.team ?? null,
    isLobbyCreator: pu.isLobbyCreator!,
  };
}

function stateFromUpdate(pu: PlayerUpdate): PlayerState {
  // embargoes: Set<PlayerID strings> on the wire, but the renderer stores
  // smallIDs (numbers). GameView fills these in via setEmbargoes() because
  // it has the PlayerID → smallID lookup table.
  return {
    smallID: pu.smallID!,
    isAlive: pu.isAlive!,
    isDisconnected: pu.isDisconnected!,
    tilesOwned: pu.tilesOwned!,
    gold: Number(pu.gold!),
    troops: pu.troops!,
    isTraitor: pu.isTraitor!,
    traitorRemainingTicks: Math.max(0, pu.traitorRemainingTicks ?? 0),
    inDoomsdayClock: pu.inDoomsdayClock ?? false,
    markedDoomsdayClockTick: pu.markedDoomsdayClockTick ?? -1,
    betrayals: pu.betrayals!,
    hasSpawned: pu.hasSpawned!,
    spawnTile: pu.spawnTile,
    lastDeleteUnitTick: pu.lastDeleteUnitTick!,
    allies: pu.allies!.slice(),
    embargoes: [],
    targets: pu.targets!.slice(),
    outgoingAttacks: pu.outgoingAttacks!,
    incomingAttacks: pu.incomingAttacks!,
    outgoingAllianceRequests: pu.outgoingAllianceRequests!.slice(),
    alliances: pu.alliances!,
    outgoingEmojis: pu.outgoingEmojis!,
  };
}

export class PlayerView {
  public anonymousName: string | null = null;
  private decoder?: PatternDecoder;

  /** Long-lived renderer state — mutated in place by applyUpdate(). */
  public state: PlayerState;
  /** Static header data — set once at construction, never mutated. */
  public static: PlayerStatic;

  // Assigned via computeColors() in the constructor; re-assignable on theme change.
  private _territoryColor!: Colord;
  private _borderColor!: Colord;
  private _railColor!: Colord;
  // Update here to include structure light and dark colors
  private _structureColors!: { light: Colord; dark: Colord };

  // Pre-computed border color variants
  private _borderColorNeutral!: Colord;
  private _borderColorFriendly!: Colord;
  private _borderColorEmbargo!: Colord;
  private _borderColorDefendedNeutral!: { light: Colord; dark: Colord };
  private _borderColorDefendedFriendly!: { light: Colord; dark: Colord };
  private _borderColorDefendedEmbargo!: { light: Colord; dark: Colord };

  constructor(
    private game: GameView,
    data: PlayerUpdate,
    // Undefined until the worker's first name placement for this player.
    public nameData: NameViewData | undefined,
    public cosmetics: PlayerCosmetics,
  ) {
    this.state = stateFromUpdate(data);
    this.static = staticFromUpdate(data);

    // First emission always carries name + playerType (see staticFromUpdate).
    if (data.clientID === game.myClientID()) {
      this.anonymousName = data.name!;
    } else {
      this.anonymousName = createRandomName(data.name!, data.playerType!);
    }

    this.computeColors();

    const pattern = userSettings.territoryPatterns()
      ? this.cosmetics.pattern
      : undefined;
    this.decoder =
      pattern === undefined
        ? undefined
        : new PatternDecoder(pattern, base64url.decode);
  }

  /**
   * Compute every theme-derived color (fill, border, structure, and the
   * neutral/friendly/embargo border variants) from the active theme. Re-callable
   * so a mid-game theme change — e.g. toggling colorblind mode — can refresh them.
   */
  private computeColors(): void {
    const theme = themeProvider.current();

    const defaultTerritoryColor = theme.territoryColor(this);
    const defaultBorderColor = theme.borderColor(defaultTerritoryColor);

    const pattern = userSettings.territoryPatterns()
      ? this.cosmetics.pattern
      : undefined;
    if (pattern) {
      pattern.colorPalette ??= {
        name: "",
        primaryColor: defaultTerritoryColor.toHex(),
        secondaryColor: defaultBorderColor.toHex(),
      } satisfies ColorPalette;
    }

    if (this.team() === null) {
      this._territoryColor = colord(
        this.cosmetics.color?.color ??
          pattern?.colorPalette?.primaryColor ??
          defaultTerritoryColor.toHex(),
      );
    } else {
      this._territoryColor = defaultTerritoryColor;
    }

    this._structureColors = theme.structureColors(this._territoryColor);

    const maybeFocusedBorderColor =
      this.game.myClientID() === this.static.clientID
        ? theme.focusedBorderColor()
        : defaultBorderColor;

    this._borderColor = new Colord(
      pattern?.colorPalette?.secondaryColor ??
        this.cosmetics.color?.color ??
        maybeFocusedBorderColor.toHex(),
    );

    // Rail color (only used for the local player's rails): white for
    // visibility, flipped to black when the territory is too light for white
    // to read against it. Patterns paint both colors, so average them.
    const railBackdropBrightness = pattern
      ? (this._territoryColor.brightness() + this._borderColor.brightness()) / 2
      : this._territoryColor.brightness();
    this._railColor =
      railBackdropBrightness > 0.8
        ? colord("rgb(0,0,0)")
        : theme.focusedBorderColor();

    const baseRgb = this._borderColor.toRgb();

    this._borderColorNeutral = this._borderColor;

    this._borderColorFriendly = colord({
      r: Math.round(
        baseRgb.r * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.r * BORDER_TINT_RATIO,
      ),
      g: Math.round(
        baseRgb.g * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.g * BORDER_TINT_RATIO,
      ),
      b: Math.round(
        baseRgb.b * (1 - BORDER_TINT_RATIO) +
          FRIENDLY_TINT_TARGET.b * BORDER_TINT_RATIO,
      ),
      a: baseRgb.a,
    });

    this._borderColorEmbargo = colord({
      r: Math.round(
        baseRgb.r * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.r * BORDER_TINT_RATIO,
      ),
      g: Math.round(
        baseRgb.g * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.g * BORDER_TINT_RATIO,
      ),
      b: Math.round(
        baseRgb.b * (1 - BORDER_TINT_RATIO) +
          EMBARGO_TINT_TARGET.b * BORDER_TINT_RATIO,
      ),
      a: baseRgb.a,
    });

    this._borderColorDefendedNeutral = theme.defendedBorderColors(
      this._borderColorNeutral,
    );
    this._borderColorDefendedFriendly = theme.defendedBorderColors(
      this._borderColorFriendly,
    );
    this._borderColorDefendedEmbargo = theme.defendedBorderColors(
      this._borderColorEmbargo,
    );
  }

  /** Recompute colors after the active theme changes (e.g. colorblind toggle). */
  refreshColors(): void {
    this.computeColors();
  }

  /**
   * Update mutable state in place. Called by GameView.update() each tick the
   * player appears in the PlayerUpdate stream.
   */
  applyUpdate(pu: PlayerUpdate): void {
    applyStateUpdate(this.state, pu);
  }

  /** Set the renderer-format embargoes (smallIDs). */
  setEmbargoSmallIDs(smallIDs: number[]): void {
    this.state.embargoes = smallIDs;
  }

  territoryColor(tile?: TileRef): Colord {
    if (tile === undefined || this.decoder === undefined) {
      return this._territoryColor;
    }
    const isPrimary = this.decoder.isPrimary(
      this.game.x(tile),
      this.game.y(tile),
    );
    return isPrimary ? this._territoryColor : this._borderColor;
  }

  structureColors(): { light: Colord; dark: Colord } {
    return this._structureColors;
  }

  railColor(): Colord {
    return this._railColor;
  }

  /**
   * Border color for a tile:
   * - Tints by neighbor relations (embargo → red, friendly → green, else neutral).
   * - If defended, applies theme checkerboard to the tinted color.
   */
  borderColor(tile?: TileRef, isDefended: boolean = false): Colord {
    if (tile === undefined) {
      return this._borderColor;
    }

    const { hasEmbargo, hasFriendly } = this.borderRelationFlags(tile);

    let baseColor: Colord;
    let defendedColors: { light: Colord; dark: Colord };

    if (hasEmbargo) {
      baseColor = this._borderColorEmbargo;
      defendedColors = this._borderColorDefendedEmbargo;
    } else if (hasFriendly) {
      baseColor = this._borderColorFriendly;
      defendedColors = this._borderColorDefendedFriendly;
    } else {
      baseColor = this._borderColorNeutral;
      defendedColors = this._borderColorDefendedNeutral;
    }

    if (!isDefended) {
      return baseColor;
    }

    const x = this.game.x(tile);
    const y = this.game.y(tile);
    const lightTile =
      (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
    return lightTile ? defendedColors.light : defendedColors.dark;
  }

  /**
   * Border relation flags for a tile, used by both CPU and WebGL renderers.
   */
  borderRelationFlags(tile: TileRef): {
    hasEmbargo: boolean;
    hasFriendly: boolean;
  } {
    const mySmallID = this.smallID();
    let hasEmbargo = false;
    let hasFriendly = false;

    for (const n of this.game.neighbors(tile)) {
      if (!this.game.hasOwner(n)) {
        continue;
      }

      const otherOwner = this.game.owner(n);
      if (!otherOwner.isPlayer() || otherOwner.smallID() === mySmallID) {
        continue;
      }

      if (this.hasEmbargo(otherOwner)) {
        hasEmbargo = true;
        break;
      }

      if (this.isFriendly(otherOwner) || otherOwner.isFriendly(this)) {
        hasFriendly = true;
      }
    }
    return { hasEmbargo, hasFriendly };
  }

  async actions(
    tile?: TileRef,
    units?: readonly PlayerBuildableUnitType[] | null,
  ): Promise<PlayerActions> {
    return this.game.worker.playerInteraction(
      this.id(),
      tile && this.game.x(tile),
      tile && this.game.y(tile),
      units,
    );
  }

  async buildables(
    tile?: TileRef,
    units?: readonly PlayerBuildableUnitType[],
  ): Promise<BuildableUnit[]> {
    return this.game.worker.playerBuildables(
      this.id(),
      tile && this.game.x(tile),
      tile && this.game.y(tile),
      units,
    );
  }

  async borderTiles(): Promise<PlayerBorderTiles> {
    return this.game.worker.playerBorderTiles(this.id());
  }

  outgoingAttacks(): AttackUpdate[] {
    return this.state.outgoingAttacks;
  }

  incomingAttacks(): AttackUpdate[] {
    return this.state.incomingAttacks;
  }

  async attackClusteredPositions(
    attackID?: string,
  ): Promise<{ id: string; positions: Cell[] }[]> {
    return this.game.worker.attackClusteredPositions(this.smallID(), attackID);
  }

  units(...types: UnitType[]): UnitView[] {
    return this.game
      .units(...types)
      .filter((u) => u.owner().smallID() === this.smallID());
  }

  nameLocation(): NameViewData | undefined {
    return this.nameData;
  }

  smallID(): number {
    return this.state.smallID;
  }

  name(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.static.name;
  }
  displayName(): string {
    return this.anonymousName !== null && userSettings.anonymousNames()
      ? this.anonymousName
      : this.static.displayName;
  }

  clientID(): ClientID | null {
    return this.static.clientID;
  }
  id(): PlayerID {
    return this.static.id;
  }
  team(): Team | null {
    return this.static.team;
  }
  type(): PlayerType {
    // Map PlayerStatic's numeric enum back to engine string enum.
    switch (this.static.playerType) {
      case PlayerTypeEnum.Human:
        return PlayerType.Human;
      case PlayerTypeEnum.Bot:
        return PlayerType.Bot;
      case PlayerTypeEnum.Nation:
        return PlayerType.Nation;
      default:
        return PlayerType.Bot;
    }
  }
  isAlive(): boolean {
    return this.state.isAlive;
  }
  isPlayer(): this is PlayerView {
    return true;
  }
  numTilesOwned(): number {
    return this.state.tilesOwned;
  }
  allies(): PlayerView[] {
    return this.state.allies.map(
      (a) => this.game.playerBySmallID(a) as PlayerView,
    );
  }
  targets(): PlayerView[] {
    return this.state.targets.map(
      (id) => this.game.playerBySmallID(id) as PlayerView,
    );
  }
  gold(): Gold {
    // Engine Gold is bigint; renderer state stores number. Convert back at the
    // accessor for game-code that still expects bigint semantics.
    return BigInt(this.state.gold);
  }

  troops(): number {
    return this.state.troops;
  }

  totalUnitLevels(type: UnitType): number {
    return this.units(type)
      .filter((unit) => !unit.isUnderConstruction())
      .map((unit) => unit.level())
      .reduce((a, b) => a + b, 0);
  }

  isMe(): boolean {
    return this.smallID() === this.game.myPlayer()?.smallID();
  }

  isLobbyCreator(): boolean {
    return this.static.isLobbyCreator;
  }

  isAlliedWith(other: PlayerView): boolean {
    return this.state.allies.some((n) => other.smallID() === n);
  }

  isOnSameTeam(other: PlayerView): boolean {
    return this.static.team !== null && this.static.team === other.static.team;
  }

  isFriendly(other: PlayerView): boolean {
    return this.isAlliedWith(other) || this.isOnSameTeam(other);
  }

  isRequestingAllianceWith(other: PlayerView) {
    return this.state.outgoingAllianceRequests.some((id) => other.id() === id);
  }

  alliances(): AllianceView[] {
    return this.state.alliances;
  }

  hasEmbargoAgainst(other: PlayerView): boolean {
    return this.state.embargoes.includes(other.smallID());
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
    const result: PlayerView[] = [];

    // Add own targets
    for (const id of this.state.targets) {
      result.push(this.game.playerBySmallID(id) as PlayerView);
    }

    // Add allies' targets
    for (const allyID of this.state.allies) {
      const ally = this.game.playerBySmallID(allyID) as PlayerView;
      for (const targetId of ally.state.targets) {
        result.push(this.game.playerBySmallID(targetId) as PlayerView);
      }
    }

    // Add teammates' targets
    const myTeam = this.static.team;
    if (myTeam !== null) {
      for (const p of this.game.playerViews()) {
        if (p !== this && p.static.team === myTeam) {
          for (const targetId of p.state.targets) {
            result.push(this.game.playerBySmallID(targetId) as PlayerView);
          }
        }
      }
    }

    return result;
  }

  hasTransitiveTarget(sid: number): boolean {
    if (this.state.targets.includes(sid)) return true;

    for (const allyID of this.state.allies) {
      const ally = this.game.playerBySmallID(allyID) as PlayerView;
      if (ally && ally.state.targets.includes(sid)) {
        return true;
      }
    }

    const myTeam = this.static.team;
    if (myTeam !== null) {
      for (const p of this.game.playerViews()) {
        if (
          p !== this &&
          p.static.team === myTeam &&
          p.state.targets.includes(sid)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  isTraitor(): boolean {
    return this.state.isTraitor;
  }
  getTraitorRemainingTicks(): number {
    return this.state.traitorRemainingTicks;
  }
  inDoomsdayClock(): boolean {
    return this.state.inDoomsdayClock;
  }
  doomsdayClockTicks(): number {
    return this.inDoomsdayClock()
      ? this.game.ticks() - this.state.markedDoomsdayClockTick
      : 0;
  }
  betrayals(): number {
    return this.state.betrayals;
  }
  outgoingEmojis(): EmojiMessage[] {
    return this.state.outgoingEmojis;
  }

  hasSpawned(): boolean {
    return this.state.hasSpawned;
  }
  isDisconnected(): boolean {
    return this.state.isDisconnected;
  }

  lastDeleteUnitTick(): Tick {
    return this.state.lastDeleteUnitTick;
  }

  deleteUnitCooldown(): number {
    return (
      Math.max(
        0,
        this.game.config().deleteUnitCooldown() -
          (this.game.ticks() + 1 - this.lastDeleteUnitTick()),
      ) / 10
    );
  }
}
