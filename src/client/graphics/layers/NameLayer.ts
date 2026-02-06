import { EventBus } from "../../../core/EventBus";
import { Theme } from "../../../core/configuration/Config";
import { AllPlayers, nukeTypes, PlayerID } from "../../../core/game/Game";
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

type PlayerIconRender =
  | { kind: "image"; src: string; alpha?: number }
  | {
      kind: "alliance-progress";
      fraction: number;
      hasExtensionRequest: boolean;
    }
  | { kind: "emoji"; text: string };

export class NameLayer implements Layer {
  private lastSharedStateUpdatedAtMs = 0;
  private sharedState: PlayerIconsSharedState | null = null;
  private imageCache = new Map<string, CachedImage>();
  private playerCache = new Map<PlayerID, PlayerRenderCache>();
  private theme: Theme = this.game.config().theme();
  private isVisible: boolean = true;
  private readonly sharedStateRefreshMs = 200;
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
    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const minX = topLeft.x;
    const maxX = bottomRight.x;
    const minY = topLeft.y;
    const maxY = bottomRight.y;
    const fontCache = new Map<string, string>();
    const iconsRowOpacity = 0.8;

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

      const worldX = nameLocation.x;
      const worldY = nameLocation.y;
      if (
        worldX <= minX ||
        worldX >= maxX ||
        worldY <= minY ||
        worldY >= maxY
      ) {
        continue;
      }

      const canvasPos = this.transformHandler.worldToCanvasCoordinatesXY(
        worldX,
        worldY,
      );
      const x = Math.round(canvasPos.x);
      const y = Math.round(canvasPos.y);

      const elementScale = Math.min(baseSize * 0.25, 3);
      const visualScale = scale * elementScale;

      const fontBase = Math.max(4, Math.floor(baseSize * 0.4));
      const fontPx = Math.max(4, fontBase * visualScale);

      const iconBasePx = Math.min(fontBase * 1.5, 48);
      const iconPx = iconBasePx * visualScale;
      const iconGapPx = 4 * visualScale;

      ctx.save();
      const fontKey = fontPx.toFixed(3);
      let font = fontCache.get(fontKey);
      if (!font) {
        font = `${fontKey}px ${fontFamily}`;
        fontCache.set(fontKey, font);
      }
      ctx.font = font;
      ctx.fillStyle = this.theme.textColor(player);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      const cache = this.getPlayerCache(player, ctx, tick);

      const icons = this.collectPlayerIcons(player, sharedState, nowMs);
      const hasIcons = icons.length > 0;
      const iconRowWidth = hasIcons
        ? icons.length * iconPx + (icons.length - 1) * iconGapPx
        : 0;
      const iconRowHeight = hasIcons ? iconPx : 0;

      const flag = player.cosmetics.flag ?? null;
      const hasFlag = flag !== null && flag !== "" && !flag.startsWith("!");
      const flagW = hasFlag ? (fontPx * 3) / 4 : 0;
      const flagH = hasFlag ? fontPx : 0;

      const nameRowWidth = flagW + cache.nameTextWidth;
      const troopsRowWidth = cache.troopsTextWidth;
      const elementWidth = Math.max(iconRowWidth, nameRowWidth, troopsRowWidth);
      const marginTop = -0.05 * elementWidth;
      const totalHeight = iconRowHeight + fontPx + fontPx + marginTop;

      const top = y - totalHeight / 2;
      const iconRowX = x - iconRowWidth / 2;
      const iconCenterY = top + iconRowHeight / 2;

      const nameRowY = top + iconRowHeight;
      const nameCenterY = nameRowY + fontPx / 2;
      const nameLeftX = x - nameRowWidth / 2;

      if (hasIcons) {
        this.drawPlayerIcons(
          ctx,
          icons,
          iconRowX,
          iconCenterY,
          iconPx,
          iconGapPx,
          fontFamily,
          iconsRowOpacity,
        );
      }

      if (sharedState.transitiveTargets?.has(player) ?? false) {
        const targetSize = iconPx;
        ctx.save();
        ctx.globalAlpha *= iconsRowOpacity;
        this.drawImage(
          ctx,
          targetIcon,
          x - targetSize / 2,
          y - targetSize / 2,
          targetSize,
          targetSize,
        );
        ctx.restore();
      }

      if (hasFlag) {
        this.drawImage(
          ctx,
          `/flags/${flag}.svg`,
          nameLeftX,
          nameCenterY - flagH / 2,
          flagW,
          flagH,
        );
      }

      ctx.fillText(cache.lastName, nameLeftX + flagW, nameCenterY);

      const troopsRowY = top + iconRowHeight + fontPx + marginTop;
      const troopsCenterY = troopsRowY + fontPx / 2;
      ctx.textAlign = "center";
      ctx.fillText(cache.troopsText, x, troopsCenterY);

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

  private collectPlayerIcons(
    player: PlayerView,
    shared: PlayerIconsSharedState,
    nowMs: number,
  ): PlayerIconRender[] {
    const myPlayer = this.game.myPlayer();

    const icons: PlayerIconRender[] = [];

    if (shared.firstPlaceId !== null && player.id() === shared.firstPlaceId) {
      icons.push({ kind: "image", src: crownIcon });
    }

    if (player.isTraitor()) {
      const remainingTicks = player.getTraitorRemainingTicks();
      const remainingSeconds = Math.round((remainingTicks / 10) * 2) / 2;
      icons.push({
        kind: "image",
        src: traitorIcon,
        alpha: this.getTraitorIconAlpha(remainingSeconds, nowMs),
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

    return icons;
  }

  private drawPlayerIcons(
    ctx: CanvasRenderingContext2D,
    icons: PlayerIconRender[],
    startX: number,
    centerY: number,
    iconPx: number,
    gapPx: number,
    fontFamily: string,
    rowOpacity: number,
  ): void {
    if (icons.length === 0) return;

    let x = startX;
    ctx.save();
    ctx.globalAlpha *= rowOpacity;

    for (const icon of icons) {
      if (icon.kind === "emoji") {
        ctx.save();
        ctx.font = `${iconPx.toFixed(3)}px ${fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(icon.text, x + iconPx / 2, centerY);
        ctx.restore();
        x += iconPx + gapPx;
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
        x += iconPx + gapPx;
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

      x += iconPx + gapPx;
    }

    ctx.restore();
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

  private getTraitorIconAlpha(remainingSeconds: number, nowMs: number): number {
    if (remainingSeconds > 15) return 1;

    const clampedSeconds = Math.max(0, Math.min(15, remainingSeconds));
    const normalizedTime = clampedSeconds / 15;
    const easedProgress = 1 - Math.pow(1 - normalizedTime, 3);
    const maxDuration = 1.0;
    const minDuration = 0.2;
    const duration = minDuration + (maxDuration - minDuration) * easedProgress;

    const t = nowMs / 1000;
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
