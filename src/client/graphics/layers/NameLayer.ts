import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { AllPlayers, Cell, nukeTypes, PlayerID } from "../../../core/game/Game";
import { GameUpdateType, UnitUpdate } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { AlternateViewEvent } from "../../InputHandler";
import { renderTroops } from "../../Utils";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import allianceIcon from "/images/AllianceIcon.svg?url";
import allianceIconFaded from "/images/AllianceIconFaded.svg?url";
import allianceRequestBlackIcon from "/images/AllianceRequestBlackIcon.svg?url";
import allianceRequestWhiteIcon from "/images/AllianceRequestWhiteIcon.svg?url";
import crownIcon from "/images/CrownIcon.svg?url";
import disconnectedIcon from "/images/DisconnectedIcon.svg?url";
import embargoBlackIcon from "/images/EmbargoBlackIcon.svg?url";
import embargoWhiteIcon from "/images/EmbargoWhiteIcon.svg?url";
import nukeRedIcon from "/images/NukeIconRed.svg?url";
import nukeWhiteIcon from "/images/NukeIconWhite.svg?url";
import questionMarkIcon from "/images/QuestionMarkIcon.svg?url";
import targetIcon from "/images/TargetIcon.svg?url";
import traitorIcon from "/images/TraitorIcon.svg?url";

type CachedImage = {
  img: HTMLImageElement;
  src: string;
};

type CustomFlagLayer = {
  maskSrc: string;
  colorKey: string;
};

type CustomFlagRenderCache = {
  w: number;
  h: number;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scratch: HTMLCanvasElement;
  scratchCtx: CanvasRenderingContext2D;
  layers: CustomFlagLayer[];
  isAnimated: boolean;
  lastRenderedAtMs: number;
};

type PlayerIconsSharedState = {
  firstPlaceId: PlayerID | null;
  transitiveTargets: ReadonlySet<PlayerView> | null;
  nukingPlayers: ReadonlySet<PlayerID>;
  nukesTargetingMe: ReadonlySet<PlayerID>;
  isDarkMode: boolean;
  emojisEnabled: boolean;
};

type PlayerRenderCache = {
  lastTick: number;
  lastFont: string;
  lastName: string;
  lastTroops: bigint | number;
  troopsText: string;
  nameTextWidth: number;
  troopsTextWidth: number;
};

export class NameLayer implements Layer {
  private lastSharedStateUpdatedAtMs = 0;
  private sharedState: PlayerIconsSharedState | null = null;
  private imageCache = new Map<string, CachedImage>();
  private customFlagCache = new Map<string, CustomFlagRenderCache>();
  private playerCache = new Map<PlayerID, PlayerRenderCache>();
  private theme: Theme = this.game.config().theme();
  private isVisible: boolean = true;
  private readonly sharedStateRefreshMs = 200;
  private readonly customFlagRefreshMs = 120;
  private readonly nukeTypeSet = new Set(nukeTypes);

  private lastTickDerivedAt = -1;
  private tickFirstPlaceId: PlayerID | null = null;
  private tickTransitiveTargets: ReadonlySet<PlayerView> | null = null;

  private nukeStateInitialized = false;
  private nukeUnitState = new Map<
    number,
    { ownerId: PlayerID; targetingMe: boolean }
  >();
  private nukingCounts = new Map<PlayerID, number>();
  private nukesTargetingMeCounts = new Map<PlayerID, number>();
  private nukingPlayers = new Set<PlayerID>();
  private nukesTargetingMe = new Set<PlayerID>();

  constructor(
    private game: GameView,
    private transformHandler: TransformHandler,
    private eventBus: EventBus,
  ) {}

  shouldTransform(): boolean {
    return false;
  }

  redraw() {
    this.theme = this.game.config().theme();
    this.sharedState = null;
  }

  public init() {
    this.eventBus.on(AlternateViewEvent, (e) => this.onAlternateViewChange(e));
  }

  private onAlternateViewChange(event: AlternateViewEvent) {
    this.isVisible = !event.alternateView;
  }

  public renderLayer(mainContex: CanvasRenderingContext2D) {
    if (!this.isVisible) {
      return;
    }

    const nowMs = performance.now();
    this.processTickDerivedState();
    const sharedState = this.getSharedState(nowMs);
    this.renderPlayers(mainContex, sharedState, nowMs);
  }

  private getSharedState(nowMs: number): PlayerIconsSharedState {
    if (
      this.sharedState !== null &&
      nowMs - this.lastSharedStateUpdatedAtMs < this.sharedStateRefreshMs
    ) {
      this.sharedState.firstPlaceId = this.tickFirstPlaceId;
      this.sharedState.transitiveTargets = this.tickTransitiveTargets;
      this.sharedState.nukingPlayers = this.nukingPlayers;
      this.sharedState.nukesTargetingMe = this.nukesTargetingMe;
      return this.sharedState;
    }

    this.lastSharedStateUpdatedAtMs = nowMs;

    const userSettings = this.game.config().userSettings();
    const isDarkMode = userSettings?.darkMode() ?? false;
    const emojisEnabled = userSettings?.emojis() ?? false;

    this.sharedState = {
      firstPlaceId: this.tickFirstPlaceId,
      transitiveTargets: this.tickTransitiveTargets,
      nukingPlayers: this.nukingPlayers,
      nukesTargetingMe: this.nukesTargetingMe,
      isDarkMode,
      emojisEnabled,
    };

    return this.sharedState;
  }

  private processTickDerivedState(): void {
    const tick = this.game.ticks();
    if (tick === this.lastTickDerivedAt) return;

    if (tick < this.lastTickDerivedAt) {
      this.resetTickDerivedState();
    }

    this.lastTickDerivedAt = tick;

    const myPlayer = this.game.myPlayer();
    this.tickTransitiveTargets =
      myPlayer !== null ? new Set(myPlayer.transitiveTargets()) : null;

    let firstPlaceId: PlayerID | null = null;
    let firstTiles = -Infinity;
    for (const player of this.game.playerViews()) {
      if (!player.isAlive()) continue;
      const tiles = player.numTilesOwned();
      if (tiles > firstTiles) {
        firstTiles = tiles;
        firstPlaceId = player.id();
      }
    }

    this.tickFirstPlaceId = firstPlaceId;
    this.ensureNukeStateInitialized();
    this.applyNukeUnitUpdates();
  }

  private resetTickDerivedState(): void {
    this.tickFirstPlaceId = null;
    this.tickTransitiveTargets = null;
    this.nukeStateInitialized = false;
    this.nukeUnitState.clear();
    this.nukingCounts.clear();
    this.nukesTargetingMeCounts.clear();
    this.nukingPlayers.clear();
    this.nukesTargetingMe.clear();
  }

  private ensureNukeStateInitialized(): void {
    if (this.nukeStateInitialized) return;
    this.nukeStateInitialized = true;

    const myPlayer = this.game.myPlayer();
    for (const unit of this.game.units(...nukeTypes)) {
      if (!unit.isActive()) continue;
      const owner = unit.owner();
      if (myPlayer && owner.id() === myPlayer.id()) continue;

      let targetingMe = false;
      if (myPlayer) {
        const target = unit.targetTile();
        if (target !== undefined) {
          const targetOwner = this.game.owner(target);
          if (
            targetOwner instanceof PlayerView &&
            targetOwner.id() === myPlayer.id()
          ) {
            targetingMe = true;
          }
        }
      }

      this.upsertNukeUnit(unit.id(), owner.id(), targetingMe);
    }
  }
  private applyNukeUnitUpdates(): void {
    const updates = this.game.updatesSinceLastTick();
    if (updates === null) return;

    const unitUpdates = updates[GameUpdateType.Unit] as
      | UnitUpdate[]
      | undefined;
    if (!unitUpdates || unitUpdates.length === 0) return;

    const myPlayer = this.game.myPlayer();
    const myPlayerId = myPlayer?.id() ?? null;

    for (const update of unitUpdates) {
      if (!this.nukeTypeSet.has(update.unitType)) continue;

      const ownerEntity = this.game.playerBySmallID(update.ownerID);
      if (!(ownerEntity instanceof PlayerView)) {
        this.removeNukeUnit(update.id);
        continue;
      }

      const ownerId = ownerEntity.id();
      const isOwnNuke = myPlayerId !== null && ownerId === myPlayerId;
      const isActive = update.isActive && !isOwnNuke;

      if (!isActive) {
        this.removeNukeUnit(update.id);
        continue;
      }

      let targetingMe = false;
      if (myPlayer && update.targetTile !== undefined) {
        const targetOwner = this.game.owner(update.targetTile);
        if (
          targetOwner instanceof PlayerView &&
          targetOwner.id() === myPlayerId
        ) {
          targetingMe = true;
        }
      }

      this.upsertNukeUnit(update.id, ownerId, targetingMe);
    }
  }

  private upsertNukeUnit(
    unitId: number,
    ownerId: PlayerID,
    targetingMe: boolean,
  ): void {
    const prev = this.nukeUnitState.get(unitId);
    if (prev) {
      if (prev.ownerId === ownerId && prev.targetingMe === targetingMe) {
        return;
      }
      this.decCount(this.nukingCounts, this.nukingPlayers, prev.ownerId);
      if (prev.targetingMe) {
        this.decCount(
          this.nukesTargetingMeCounts,
          this.nukesTargetingMe,
          prev.ownerId,
        );
      }
    }

    this.nukeUnitState.set(unitId, { ownerId, targetingMe });
    this.incCount(this.nukingCounts, this.nukingPlayers, ownerId);
    if (targetingMe) {
      this.incCount(
        this.nukesTargetingMeCounts,
        this.nukesTargetingMe,
        ownerId,
      );
    }
  }

  private removeNukeUnit(unitId: number): void {
    const prev = this.nukeUnitState.get(unitId);
    if (!prev) return;
    this.nukeUnitState.delete(unitId);
    this.decCount(this.nukingCounts, this.nukingPlayers, prev.ownerId);
    if (prev.targetingMe) {
      this.decCount(
        this.nukesTargetingMeCounts,
        this.nukesTargetingMe,
        prev.ownerId,
      );
    }
  }

  private incCount(
    map: Map<PlayerID, number>,
    set: Set<PlayerID>,
    id: PlayerID,
  ): void {
    const next = (map.get(id) ?? 0) + 1;
    map.set(id, next);
    if (next === 1) set.add(id);
  }

  private decCount(
    map: Map<PlayerID, number>,
    set: Set<PlayerID>,
    id: PlayerID,
  ): void {
    const prev = map.get(id) ?? 0;
    const next = prev - 1;
    if (next <= 0) {
      map.delete(id);
      set.delete(id);
      return;
    }
    map.set(id, next);
  }

  private renderPlayers(
    ctx: CanvasRenderingContext2D,
    sharedState: PlayerIconsSharedState,
    nowMs: number,
  ): void {
    const fontFamily = this.theme.font();
    const scale = this.transformHandler.scale;
    const tick = this.game.ticks();

    for (const player of this.game.playerViews()) {
      if (!player.isAlive()) {
        this.playerCache.delete(player.id());
        continue;
      }

      const nameLocation = player.nameLocation();
      if (!nameLocation) {
        this.playerCache.delete(player.id());
        continue;
      }

      const baseSize = Math.max(1, Math.floor(nameLocation.size));
      const size = scale * baseSize;
      const maxZoomScale = 17;
      if (size < 7 || (scale > maxZoomScale && size > 100)) {
        continue;
      }

      const worldCell = new Cell(nameLocation.x, nameLocation.y);
      if (!this.transformHandler.isOnScreen(worldCell)) {
        continue;
      }

      const screenPos =
        this.transformHandler.worldToScreenCoordinates(worldCell);
      const x = Math.round(screenPos.x);
      const y = Math.round(screenPos.y);

      const elementScale = Math.min(baseSize * 0.25, 3);
      const visualScale = scale * elementScale;

      const fontBase = Math.max(4, Math.floor(baseSize * 0.4));
      const fontPx = Math.max(4, Math.round(fontBase * visualScale));

      const iconBasePx = Math.min(fontBase * 1.5, 48);
      const iconPx = Math.max(8, Math.round(iconBasePx * visualScale));

      ctx.save();
      ctx.font = `${fontPx}px ${fontFamily}`;
      ctx.fillStyle = this.theme.textColor(player);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      const cache = this.getPlayerCache(player, ctx, tick);

      const iconsY = Math.round(y - fontPx * 1.1 - iconPx * 0.6);
      this.renderPlayerIcons(
        ctx,
        player,
        sharedState,
        x,
        iconsY,
        iconPx,
        fontFamily,
      );

      const flag = player.cosmetics.flag ?? null;
      const hasFlag = flag !== null && flag !== "";
      const flagW = hasFlag ? Math.round((fontPx * 3) / 4) : 0;
      const flagH = hasFlag ? fontPx : 0;
      const gapPx = hasFlag ? Math.max(2, Math.round(fontPx * 0.18)) : 0;

      const totalNameW = flagW + gapPx + cache.nameTextWidth;
      const nameLeftX = x - totalNameW / 2;

      if (hasFlag) {
        this.drawPlayerFlag(
          ctx,
          flag,
          nameLeftX,
          y - flagH / 2,
          flagW,
          flagH,
          nowMs,
        );
      }

      ctx.fillText(cache.lastName, nameLeftX + flagW + gapPx, y);

      ctx.textAlign = "center";
      ctx.fillText(cache.troopsText, x, Math.round(y + fontPx * 1.05));

      if (sharedState.transitiveTargets?.has(player) ?? false) {
        const targetSize = Math.round(iconPx * 1.1);
        this.drawImage(
          ctx,
          targetIcon,
          x - targetSize / 2,
          y - targetSize / 2,
          targetSize,
          targetSize,
        );
      }

      ctx.restore();
    }
  }

  private getPlayerCache(
    player: PlayerView,
    ctx: CanvasRenderingContext2D,
    tick: number,
  ): PlayerRenderCache {
    const id = player.id();
    const font = ctx.font;

    const existing = this.playerCache.get(id);
    if (existing && existing.lastTick === tick) {
      if (existing.lastFont !== font) {
        existing.lastFont = font;
        existing.nameTextWidth = ctx.measureText(existing.lastName).width;
        existing.troopsTextWidth = ctx.measureText(existing.troopsText).width;
      }
      return existing;
    }

    const name = player.name();
    const troops = player.troops();
    const troopsText = renderTroops(troops);

    if (existing) {
      if (existing.lastName !== name) {
        existing.lastName = name;
        existing.nameTextWidth = ctx.measureText(name).width;
      } else if (existing.lastFont !== font) {
        existing.nameTextWidth = ctx.measureText(name).width;
      }

      if (existing.troopsText !== troopsText) {
        existing.troopsText = troopsText;
        existing.troopsTextWidth = ctx.measureText(troopsText).width;
      } else if (existing.lastFont !== font) {
        existing.troopsTextWidth = ctx.measureText(troopsText).width;
      }

      existing.lastTick = tick;
      existing.lastFont = font;
      existing.lastTroops = troops;
      return existing;
    }

    const next: PlayerRenderCache = {
      lastTick: tick,
      lastFont: font,
      lastName: name,
      lastTroops: troops,
      troopsText,
      nameTextWidth: ctx.measureText(name).width,
      troopsTextWidth: ctx.measureText(troopsText).width,
    };
    this.playerCache.set(id, next);
    return next;
  }

  private drawPlayerFlag(
    ctx: CanvasRenderingContext2D,
    flag: string,
    x: number,
    y: number,
    w: number,
    h: number,
    nowMs: number,
  ): void {
    if (flag.startsWith("!")) {
      const custom = this.getCustomFlagCanvas(flag, w, h);
      if (!custom) return;
      this.renderCustomFlag(custom, nowMs);
      ctx.drawImage(custom.canvas, x, y, w, h);
      return;
    }

    this.drawImage(ctx, `/flags/${flag}.svg`, x, y, w, h);
  }

  private getCustomFlagCanvas(
    flag: string,
    w: number,
    h: number,
  ): CustomFlagRenderCache | null {
    const bucketW = Math.max(2, Math.round(w / 4) * 4);
    const bucketH = Math.max(2, Math.round(h / 4) * 4);
    const key = `${flag}@${bucketW}x${bucketH}`;

    const existing = this.customFlagCache.get(key);
    if (existing) return existing;

    const layers = this.parseCustomFlag(flag);
    if (layers === null || layers.length === 0) return null;

    let isAnimated = false;
    for (const layer of layers) {
      if (this.isSpecialFlagColor(layer.colorKey)) {
        isAnimated = true;
        break;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = bucketW;
    canvas.height = bucketH;
    const canvasCtx = canvas.getContext("2d");
    if (!canvasCtx) return null;

    const scratch = document.createElement("canvas");
    scratch.width = bucketW;
    scratch.height = bucketH;
    const scratchCtx = scratch.getContext("2d");
    if (!scratchCtx) return null;

    const next: CustomFlagRenderCache = {
      w: bucketW,
      h: bucketH,
      canvas,
      ctx: canvasCtx,
      scratch,
      scratchCtx,
      layers,
      isAnimated,
      lastRenderedAtMs: -Infinity,
    };
    this.customFlagCache.set(key, next);
    return next;
  }

  private parseCustomFlag(flag: string): CustomFlagLayer[] | null {
    if (!flag.startsWith("!")) return null;
    const code = flag.slice(1);
    if (code.length === 0) return null;

    const layers: CustomFlagLayer[] = [];
    for (const segment of code.split("_")) {
      const [layerKey, colorKey] = segment.split("-");
      if (!layerKey || !colorKey) continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(layerKey)) continue;
      if (!/^[a-zA-Z0-9#_-]+$/.test(colorKey)) continue;
      layers.push({
        maskSrc: `/flags/custom/${layerKey}.svg`,
        colorKey,
      });
    }
    return layers.length > 0 ? layers : null;
  }

  private renderCustomFlag(cache: CustomFlagRenderCache, nowMs: number): void {
    if (!cache.isAnimated && cache.lastRenderedAtMs !== -Infinity) return;
    if (
      cache.isAnimated &&
      nowMs - cache.lastRenderedAtMs < this.customFlagRefreshMs
    ) {
      return;
    }

    for (const layer of cache.layers) {
      const mask = this.getImage(layer.maskSrc);
      if (!mask.complete || mask.naturalWidth === 0) {
        return;
      }
    }

    cache.lastRenderedAtMs = nowMs;
    cache.ctx.clearRect(0, 0, cache.w, cache.h);

    for (const layer of cache.layers) {
      const mask = this.getImage(layer.maskSrc);
      cache.scratchCtx.clearRect(0, 0, cache.w, cache.h);
      cache.scratchCtx.globalCompositeOperation = "source-over";
      cache.scratchCtx.drawImage(mask, 0, 0, cache.w, cache.h);
      cache.scratchCtx.globalCompositeOperation = "source-in";

      cache.scratchCtx.fillStyle = this.resolveFlagColor(layer.colorKey, nowMs);
      cache.scratchCtx.fillRect(0, 0, cache.w, cache.h);
      cache.scratchCtx.globalCompositeOperation = "source-over";

      cache.ctx.drawImage(cache.scratch, 0, 0);
    }
  }

  private isSpecialFlagColor(colorKey: string): boolean {
    if (colorKey.startsWith("#")) return false;
    return !/^([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(colorKey);
  }

  private resolveFlagColor(colorKey: string, nowMs: number): string {
    if (!this.isSpecialFlagColor(colorKey)) {
      if (colorKey.startsWith("#")) return colorKey;
      if (/^([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(colorKey)) {
        return `#${colorKey}`;
      }
      return colorKey;
    }

    switch (colorKey) {
      case "rainbow":
        return this.sampleKeyframedColor(nowMs, 7000, [
          [0, "#990033"],
          [0.16, "#996600"],
          [0.32, "#336600"],
          [0.48, "#008080"],
          [0.64, "#1c3f99"],
          [0.8, "#5e0099"],
          [1, "#990033"],
        ]);
      case "bright-rainbow":
        return this.sampleKeyframedColor(nowMs, 7000, [
          [0, "#ff0000"],
          [0.16, "#ffa500"],
          [0.32, "#ffff00"],
          [0.48, "#00ff00"],
          [0.64, "#00ffff"],
          [0.8, "#0000ff"],
          [1, "#ff0000"],
        ]);
      case "copper-glow":
        return this.sampleKeyframedColor(nowMs, 3000, [
          [0, "#b87333"],
          [0.5, "#cd7f32"],
          [1, "#b87333"],
        ]);
      case "silver-glow":
        return this.sampleKeyframedColor(nowMs, 3000, [
          [0, "#c0c0c0"],
          [0.5, "#e0e0e0"],
          [1, "#c0c0c0"],
        ]);
      case "gold-glow":
        return this.sampleKeyframedColor(nowMs, 3000, [
          [0, "#ffd700"],
          [0.5, "#fff8dc"],
          [1, "#ffd700"],
        ]);
      case "neon":
        return this.sampleKeyframedColor(nowMs, 3000, [
          [0, "#39ff14"],
          [0.25, "#2aff60"],
          [0.5, "#00ff88"],
          [0.75, "#2aff60"],
          [1, "#39ff14"],
        ]);
      case "water":
        return this.sampleKeyframedColor(nowMs, 6200, [
          [0, "#00bfff"],
          [0.12, "#1e90ff"],
          [0.27, "#87cefa"],
          [0.45, "#4682b4"],
          [0.63, "#87cefa"],
          [0.8, "#1e90ff"],
          [1, "#00bfff"],
        ]);
      case "lava":
        return this.sampleKeyframedColor(nowMs, 6000, [
          [0, "#ff4500"],
          [0.2, "#ff6347"],
          [0.4, "#ff8c00"],
          [0.6, "#ff4500"],
          [0.8, "#ff0000"],
          [1, "#ff4500"],
        ]);
      default:
        return "#ffffff";
    }
  }

  private sampleKeyframedColor(
    nowMs: number,
    durationMs: number,
    stops: Array<[t: number, hex: string]>,
  ): string {
    const t = ((nowMs % durationMs) / durationMs) % 1;
    let a = stops[0];
    let b = stops[stops.length - 1];

    for (let i = 0; i < stops.length - 1; i++) {
      const s0 = stops[i];
      const s1 = stops[i + 1];
      if (t >= s0[0] && t <= s1[0]) {
        a = s0;
        b = s1;
        break;
      }
    }

    const span = Math.max(1e-6, b[0] - a[0]);
    const u = Math.max(0, Math.min(1, (t - a[0]) / span));
    return this.lerpHex(a[1], b[1], u);
  }

  private lerpHex(a: string, b: string, t: number): string {
    const ar = this.hexToRgb(a);
    const br = this.hexToRgb(b);
    const r = Math.round(ar.r + (br.r - ar.r) * t);
    const g = Math.round(ar.g + (br.g - ar.g) * t);
    const bl = Math.round(ar.b + (br.b - ar.b) * t);
    return `rgb(${r}, ${g}, ${bl})`;
  }

  private hexToRgb(hex: string): { r: number; g: number; b: number } {
    const h = hex.replace("#", "");
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return { r, g, b };
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return { r, g, b };
  }

  private renderPlayerIcons(
    ctx: CanvasRenderingContext2D,
    player: PlayerView,
    shared: PlayerIconsSharedState,
    centerX: number,
    centerY: number,
    iconPx: number,
    fontFamily: string,
  ): void {
    const myPlayer = this.game.myPlayer();

    const icons: Array<
      | { kind: "image"; src: string; alpha?: number }
      | {
          kind: "alliance-progress";
          fraction: number;
          hasExtensionRequest: boolean;
        }
      | { kind: "emoji"; text: string }
    > = [];

    if (shared.firstPlaceId !== null && player.id() === shared.firstPlaceId) {
      icons.push({ kind: "image", src: crownIcon });
    }

    if (player.isTraitor()) {
      const remainingTicks = player.getTraitorRemainingTicks();
      const remainingSeconds = Math.round((remainingTicks / 10) * 2) / 2;
      icons.push({
        kind: "image",
        src: traitorIcon,
        alpha: this.getTraitorIconAlpha(remainingSeconds),
      });
    }

    if (player.isDisconnected()) {
      icons.push({ kind: "image", src: disconnectedIcon });
    }

    if (myPlayer !== null && myPlayer.isAlliedWith(player)) {
      const allianceView = myPlayer
        .alliances()
        .find((a) => a.other === player.id());

      let fraction = 0;
      let hasExtensionRequest = false;
      if (allianceView) {
        const remaining = Math.max(
          0,
          allianceView.expiresAt - this.game.ticks(),
        );
        const duration = Math.max(1, this.game.config().allianceDuration());
        fraction = Math.max(0, Math.min(1, remaining / duration));
        hasExtensionRequest = allianceView.hasExtensionRequest;
      }

      icons.push({
        kind: "alliance-progress",
        fraction,
        hasExtensionRequest,
      });
    }

    if (myPlayer !== null && player.isRequestingAllianceWith(myPlayer)) {
      icons.push({
        kind: "image",
        src: shared.isDarkMode
          ? allianceRequestWhiteIcon
          : allianceRequestBlackIcon,
      });
    }

    if (shared.emojisEnabled) {
      const emojis = player
        .outgoingEmojis()
        .filter(
          (emoji) =>
            emoji.recipientID === AllPlayers ||
            emoji.recipientID === myPlayer?.smallID(),
        );
      if (emojis.length > 0) {
        icons.push({ kind: "emoji", text: emojis[0].message });
      }
    }

    if (myPlayer?.hasEmbargo(player)) {
      icons.push({
        kind: "image",
        src: shared.isDarkMode ? embargoWhiteIcon : embargoBlackIcon,
      });
    }

    if (shared.nukingPlayers.has(player.id())) {
      const isTargetingMe = shared.nukesTargetingMe.has(player.id());
      icons.push({
        kind: "image",
        src: isTargetingMe ? nukeRedIcon : nukeWhiteIcon,
      });
    }

    if (icons.length === 0) {
      return;
    }

    const gap = Math.max(2, Math.round(iconPx * 0.18));
    const totalW = icons.length * iconPx + (icons.length - 1) * gap;
    let x = centerX - totalW / 2;

    for (const icon of icons) {
      if (icon.kind === "emoji") {
        ctx.save();
        ctx.font = `${iconPx}px ${fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(icon.text, x + iconPx / 2, centerY);
        ctx.restore();
        x += iconPx + gap;
        continue;
      }

      if (icon.kind === "alliance-progress") {
        this.drawAllianceProgressIcon(
          ctx,
          x,
          centerY - iconPx / 2,
          iconPx,
          icon.fraction,
          icon.hasExtensionRequest,
        );
        x += iconPx + gap;
        continue;
      }

      if (icon.alpha !== undefined) {
        ctx.save();
        ctx.globalAlpha *= icon.alpha;
      }

      this.drawImage(ctx, icon.src, x, centerY - iconPx / 2, iconPx, iconPx);

      if (icon.alpha !== undefined) {
        ctx.restore();
      }

      x += iconPx + gap;
    }
  }

  private drawAllianceProgressIcon(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    fraction: number,
    hasExtensionRequest: boolean,
  ): void {
    this.drawImage(ctx, allianceIconFaded, x, y, size, size);

    const topCutPct = 20 + (1 - fraction) * 80 * 0.78;
    const topCutPx = (Math.max(0, Math.min(100, topCutPct)) / 100) * size;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y + topCutPx, size, size - topCutPx);
    ctx.clip();
    this.drawImage(ctx, allianceIcon, x, y, size, size);
    ctx.restore();

    if (hasExtensionRequest) {
      this.drawImage(ctx, questionMarkIcon, x, y, size, size);
    }
  }

  private getTraitorIconAlpha(remainingSeconds: number): number {
    if (remainingSeconds > 15) return 1;

    const clampedSeconds = Math.max(0, Math.min(15, remainingSeconds));
    const normalizedTime = clampedSeconds / 15;
    const easedProgress = 1 - Math.pow(1 - normalizedTime, 3);
    const maxDuration = 1.0;
    const minDuration = 0.2;
    const duration = minDuration + (maxDuration - minDuration) * easedProgress;

    const t = performance.now() / 1000;
    const phase = (t % duration) / duration;
    const triangle = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    return 0.3 + 0.7 * triangle;
  }

  private drawImage(
    ctx: CanvasRenderingContext2D,
    src: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const img = this.getImage(src);
    if (!img.complete || img.naturalWidth === 0) return;
    ctx.drawImage(img, x, y, w, h);
  }

  private getImage(src: string): HTMLImageElement {
    const cached = this.imageCache.get(src);
    if (cached) return cached.img;

    const img = new Image();
    img.decoding = "async";
    img.src = src;
    this.imageCache.set(src, { img, src });
    return img;
  }
}
