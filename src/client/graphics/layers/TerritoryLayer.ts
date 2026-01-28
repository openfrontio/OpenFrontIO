import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { ColoredTeams, PlayerType, Team } from "../../../core/game/Game";
import { euclDistFN, TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  AlternateViewEvent,
  ContextMenuEvent,
  MouseOverEvent,
} from "../../InputHandler";
import { FrameProfiler } from "../FrameProfiler";
import { getHoverInfo } from "../HoverInfo";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { TerritoryWebGLRenderer } from "./TerritoryWebGLRenderer";

const CONTEST_ID_MASK = 0x7fff;
const CONTEST_ATTACKER_EVER_BIT = 0x8000;
const CONTEST_TIME_WRAP = 32768;
const DEFAULT_CONTEST_DURATION_TICKS = 2;
const ENABLE_CONTEST_TRACKING = false;
const CONTEST_STRENGTH_EMA_ALPHA = 0.8;
const CONTEST_STRENGTH_MIN = 0.01;
const CONTEST_STRENGTH_MAX = 0.95;
const DEBUG_TERRITORY_OVERLAY = true;

type ContestComponent = {
  id: number;
  attacker: number;
  defender: number;
  lastActivityPacked: number;
  tiles: TileRef[];
  strength: number;
};

export class TerritoryLayer implements Layer {
  profileName(): string {
    return "TerritoryLayer:renderLayer";
  }

  private userSettings: UserSettings;
  private borderAnimTime = 0;

  private cachedTerritoryPatternsEnabled: boolean | undefined;

  private theme: Theme;

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  private highlightedTerritory: PlayerView | null = null;
  private territoryRenderer: TerritoryWebGLRenderer | null = null;

  private alternativeView = false;
  private lastMousePosition: { x: number; y: number } | null = null;

  private lastFocusedPlayer: PlayerView | null = null;
  private lastMyPlayerSmallId: number | null = null;
  private lastPaletteSignature: string | null = null;
  private contestDurationTicks = DEFAULT_CONTEST_DURATION_TICKS;
  private contestActive = false;
  private contestNextId = 1;
  private contestFreeIds: number[] = [];
  private contestComponentIds: Uint16Array | null = null;
  private contestPrevOwners: Uint16Array | null = null;
  private contestAttackers: Uint16Array | null = null;
  private contestTileIndices: Int32Array | null = null;
  private contestComponents = new Map<number, ContestComponent>();
  private contestTileCount = 0;
  private contestEnabled = ENABLE_CONTEST_TRACKING;
  private tickSnapshotPending = false;
  private tickTimeMsCurrent = 0;
  private tickTimeMsPrev = 0;
  private tickTimeMsOlder = 0;
  private tickNumberCurrent: number | null = null;
  private tickNumberPrev: number | null = null;
  private tickNumberOlder: number | null = null;
  private interpolationDelayMs = 100;
  private lastInterpolationPair: "prevCurrent" | "olderPrev" = "prevCurrent";

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    userSettings: UserSettings,
  ) {
    this.userSettings = userSettings;
    this.theme = game.config().theme();
    this.cachedTerritoryPatternsEnabled = undefined;
    this.lastMyPlayerSmallId = game.myPlayer()?.smallID() ?? null;
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const tickProfile = FrameProfiler.start();
    const now = this.nowMs();
    const currentTheme = this.game.config().theme();
    if (currentTheme !== this.theme) {
      this.theme = currentTheme;
      this.redraw();
    }
    if (this.game.inSpawnPhase()) {
      this.spawnHighlight();
    }

    const patternsEnabled = this.userSettings.territoryPatterns();
    if (this.cachedTerritoryPatternsEnabled !== patternsEnabled) {
      this.cachedTerritoryPatternsEnabled = patternsEnabled;
      this.redraw();
    }
    this.refreshPaletteIfNeeded();

    const tickNumber = this.game.ticks();
    if (this.tickNumberCurrent !== tickNumber) {
      this.tickNumberOlder = this.tickNumberPrev;
      this.tickNumberPrev = this.tickNumberCurrent;
      this.tickNumberCurrent = tickNumber;

      this.tickTimeMsOlder = this.tickTimeMsPrev;
      this.tickTimeMsPrev = this.tickTimeMsCurrent;
      this.tickTimeMsCurrent = now;

      if (this.territoryRenderer) {
        this.tickSnapshotPending = true;
      }
    }

    this.game.recentlyUpdatedTiles().forEach((t) => this.markTile(t));
    if (this.contestEnabled) {
      const ownerUpdates = this.game.recentlyUpdatedOwnerTiles();
      const nowTickPacked = this.packContestTick(this.game.ticks());
      this.applyContestChanges(ownerUpdates, nowTickPacked);
      this.updateContestState(nowTickPacked);
      this.updateContestStrengths();
      let tileCount = 0;
      for (const component of this.contestComponents.values()) {
        tileCount += component.tiles.length;
      }
      this.contestTileCount = tileCount;
    } else {
      this.contestTileCount = 0;
      this.contestActive = false;
    }
    const updates = this.game.updatesSinceLastTick();

    // Detect alliance mutations
    const myPlayer = this.game.myPlayer();
    if (myPlayer) {
      updates?.[GameUpdateType.BrokeAlliance]?.forEach((update) => {
        const territory = this.game.playerBySmallID(update.betrayedID);
        if (territory && territory instanceof PlayerView) {
          this.territoryRenderer?.refreshPalette();
        }
      });

      updates?.[GameUpdateType.AllianceRequestReply]?.forEach((update) => {
        if (
          update.accepted &&
          (update.request.requestorID === myPlayer.smallID() ||
            update.request.recipientID === myPlayer.smallID())
        ) {
          const territoryId =
            update.request.requestorID === myPlayer.smallID()
              ? update.request.recipientID
              : update.request.requestorID;
          const territory = this.game.playerBySmallID(territoryId);
          if (territory && territory instanceof PlayerView) {
            this.territoryRenderer?.refreshPalette();
          }
        }
      });
      updates?.[GameUpdateType.EmbargoEvent]?.forEach((update) => {
        const player = this.game.playerBySmallID(update.playerID) as PlayerView;
        const embargoed = this.game.playerBySmallID(
          update.embargoedID,
        ) as PlayerView;

        if (
          player.id() === myPlayer?.id() ||
          embargoed.id() === myPlayer?.id()
        ) {
          this.territoryRenderer?.refreshPalette();
        }
      });
    }

    const focusedPlayer = this.game.focusedPlayer();
    if (focusedPlayer !== this.lastFocusedPlayer) {
      this.redraw();
      this.lastFocusedPlayer = focusedPlayer;
    }

    const currentMyPlayer = this.game.myPlayer()?.smallID() ?? null;
    if (currentMyPlayer !== this.lastMyPlayerSmallId) {
      this.redraw();
    }
    FrameProfiler.end("TerritoryLayer:tick", tickProfile);
  }

  private spawnHighlight() {
    if (this.game.ticks() % 5 === 0) {
      return;
    }

    this.highlightContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );

    this.drawFocusedPlayerHighlight();

    const humans = this.game
      .playerViews()
      .filter((p) => p.type() === PlayerType.Human);

    const focusedPlayer = this.game.focusedPlayer();
    const teamColors = Object.values(ColoredTeams);
    for (const human of humans) {
      if (human === focusedPlayer) {
        continue;
      }
      const center = human.nameLocation();
      if (!center) {
        continue;
      }
      const centerTile = this.game.ref(center.x, center.y);
      if (!centerTile) {
        continue;
      }
      let color = this.theme.spawnHighlightColor();
      const myPlayer = this.game.myPlayer();
      if (myPlayer !== null && myPlayer !== human && myPlayer.team() === null) {
        // In FFA games (when team === null), use default yellow spawn highlight color
        color = this.theme.spawnHighlightColor();
      } else if (myPlayer !== null && myPlayer !== human) {
        // In Team games, the spawn highlight color becomes that player's team color
        const team = human.team();
        if (team !== null && teamColors.includes(team)) {
          color = this.theme.teamColor(team);
        } else {
          if (myPlayer.isFriendly(human)) {
            color = this.theme.spawnHighlightTeamColor();
          } else {
            color = this.theme.spawnHighlightColor();
          }
        }
      }

      for (const tile of this.game.bfs(
        centerTile,
        euclDistFN(centerTile, 9, true),
      )) {
        if (!this.game.hasOwner(tile)) {
          this.paintHighlightTile(tile, color, 255);
        }
      }
    }
  }

  private drawFocusedPlayerHighlight() {
    const focusedPlayer = this.game.focusedPlayer();

    if (!focusedPlayer) {
      return;
    }
    const center = focusedPlayer.nameLocation();
    if (!center) {
      return;
    }
    // Breathing border animation
    this.borderAnimTime += 0.5;
    const minRad = 8;
    const maxRad = 24;
    const radius =
      minRad + (maxRad - minRad) * (0.5 + 0.5 * Math.sin(this.borderAnimTime));

    const baseColor = this.theme.spawnHighlightSelfColor();
    let teamColor: Colord | null = null;

    const team: Team | null = focusedPlayer.team();
    if (team !== null && Object.values(ColoredTeams).includes(team)) {
      teamColor = this.theme.teamColor(team).alpha(0.5);
    } else {
      teamColor = baseColor;
    }

    this.drawBreathingRing(
      center.x,
      center.y,
      minRad,
      maxRad,
      radius,
      baseColor,
      teamColor,
    );

    this.drawTeammateHighlights(minRad, maxRad, radius);
  }

  private drawTeammateHighlights(
    minRad: number,
    maxRad: number,
    radius: number,
  ) {
    const myPlayer = this.game.myPlayer();
    if (myPlayer === null || myPlayer.team() === null) {
      return;
    }

    const teammates = this.game
      .playerViews()
      .filter((p) => p !== myPlayer && myPlayer.isOnSameTeam(p));

    const teammateMinRad = 5;
    const teammateMaxRad = 14;
    const teammateRadius =
      teammateMinRad +
      (teammateMaxRad - teammateMinRad) *
        ((radius - minRad) / (maxRad - minRad));

    const teamColors = Object.values(ColoredTeams);
    for (const teammate of teammates) {
      const center = teammate.nameLocation();
      if (!center) {
        continue;
      }

      const team = teammate.team();
      let baseColor: Colord;
      let breathingColor: Colord;

      if (team !== null && teamColors.includes(team)) {
        baseColor = this.theme.teamColor(team).alpha(0.5);
        breathingColor = this.theme.teamColor(team).alpha(0.5);
      } else {
        baseColor = this.theme.spawnHighlightTeamColor();
        breathingColor = this.theme.spawnHighlightTeamColor();
      }

      this.drawBreathingRing(
        center.x,
        center.y,
        teammateMinRad,
        teammateMaxRad,
        teammateRadius,
        baseColor,
        breathingColor,
      );
    }
  }

  init() {
    this.eventBus.on(MouseOverEvent, (e) => this.onMouseOver(e));
    this.eventBus.on(ContextMenuEvent, (e) => this.onMouseOver(e));
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
      this.territoryRenderer?.setAlternativeView(this.alternativeView);
      this.territoryRenderer?.markAllDirty();
      this.territoryRenderer?.setHoverHighlightOptions(
        this.hoverHighlightOptions(),
      );
    });
    this.redraw();
  }

  onMouseOver(event: MouseOverEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
    this.updateHighlightedTerritory();
  }

  private updateHighlightedTerritory() {
    if (!this.lastMousePosition || !this.territoryRenderer) {
      return;
    }

    const cell = this.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    const previousTerritory = this.highlightedTerritory;
    const info = getHoverInfo(this.game, cell);
    let territory: PlayerView | null = null;
    if (info.player) {
      territory = info.player;
    } else if (info.unit) {
      territory = info.unit.owner();
    }

    if (territory) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    if (previousTerritory?.id() !== this.highlightedTerritory?.id()) {
      this.territoryRenderer.setHoveredPlayerId(
        this.highlightedTerritory?.smallID() ?? null,
      );
    }
  }

  redraw() {
    this.lastMyPlayerSmallId = this.game.myPlayer()?.smallID() ?? null;
    this.cachedTerritoryPatternsEnabled = this.userSettings.territoryPatterns();
    this.configureRenderers();
    if (this.contestEnabled) {
      this.ensureContestScratch();
      this.syncContestStateToRenderer();
    } else {
      this.contestActive = false;
      this.contestComponents.clear();
      this.contestFreeIds = [];
      this.contestNextId = 1;
    }

    // Add a second canvas for highlights
    this.highlightCanvas = document.createElement("canvas");
    const highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    if (highlightContext === null) throw new Error("2d context not supported");
    this.highlightContext = highlightContext;
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();
  }

  private configureRenderers() {
    const { renderer, reason } = TerritoryWebGLRenderer.create(
      this.game,
      this.theme,
    );
    if (!renderer) {
      throw new Error(reason ?? "WebGL2 is required for territory rendering.");
    }

    this.territoryRenderer = renderer;
    this.territoryRenderer.setContestEnabled(this.contestEnabled);
    this.territoryRenderer.setAlternativeView(this.alternativeView);
    this.territoryRenderer.markAllDirty();
    this.territoryRenderer.refreshPalette();
    this.territoryRenderer.setHoverHighlightOptions(
      this.hoverHighlightOptions(),
    );
    this.territoryRenderer.setHoveredPlayerId(
      this.highlightedTerritory?.smallID() ?? null,
    );
    this.lastPaletteSignature = this.computePaletteSignature();
  }

  private hoverHighlightOptions() {
    const baseColor = this.theme.playerHighlightColor();
    const rgba = baseColor.rgba;

    if (this.alternativeView) {
      return {
        color: { r: rgba.r, g: rgba.g, b: rgba.b },
        strength: 0.8,
        pulseStrength: 0.45,
        pulseSpeed: Math.PI * 2,
      };
    }

    return {
      color: { r: rgba.r, g: rgba.g, b: rgba.b },
      strength: 0.6,
      pulseStrength: 0.35,
      pulseSpeed: Math.PI * 2,
    };
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.territoryRenderer) {
      return;
    }
    const now = this.nowMs();
    if (this.tickSnapshotPending) {
      this.territoryRenderer.snapshotStateForSmoothing();
      this.tickSnapshotPending = false;
    }
    this.updateInterpolationState(now);

    const renderTerritoryStart = FrameProfiler.start();
    this.territoryRenderer.setViewSize(
      context.canvas.width,
      context.canvas.height,
    );
    const viewOffset = this.transformHandler.viewOffset();
    this.territoryRenderer.setViewTransform(
      this.transformHandler.scale,
      viewOffset.x,
      viewOffset.y,
    );
    this.territoryRenderer.render();
    FrameProfiler.end("TerritoryLayer:renderTerritory", renderTerritoryStart);

    const drawTerritoryStart = FrameProfiler.start();
    // Draw the WebGL territory in screen space; overlays still use world space.
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.drawImage(
      this.territoryRenderer.canvas,
      0,
      0,
      context.canvas.width,
      context.canvas.height,
    );
    context.restore();
    FrameProfiler.end("TerritoryLayer:drawTerritoryCanvas", drawTerritoryStart);

    if (this.game.inSpawnPhase()) {
      const highlightDrawStart = FrameProfiler.start();
      context.drawImage(
        this.highlightCanvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
      FrameProfiler.end(
        "TerritoryLayer:drawHighlightCanvas",
        highlightDrawStart,
      );
    }

    if (DEBUG_TERRITORY_OVERLAY) {
      const overlayStart = FrameProfiler.start();
      this.drawDebugOverlay(context);
      FrameProfiler.end("TerritoryLayer:debugOverlay", overlayStart);
    }
  }

  private markTile(tile: TileRef) {
    this.territoryRenderer?.markTile(tile);
  }

  paintHighlightTile(tile: TileRef, color: Colord, alpha: number) {
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    this.highlightContext.fillStyle = color.alpha(alpha / 255).toRgbString();
    this.highlightContext.fillRect(x, y, 1, 1);
  }

  clearHighlightTile(tile: TileRef) {
    const x = this.game.x(tile);
    const y = this.game.y(tile);
    this.highlightContext.clearRect(x, y, 1, 1);
  }

  private drawBreathingRing(
    cx: number,
    cy: number,
    minRad: number,
    maxRad: number,
    radius: number,
    transparentColor: Colord,
    breathingColor: Colord,
  ) {
    const ctx = this.highlightContext;
    if (!ctx) return;

    // Draw a semi-transparent ring around the starting location
    ctx.beginPath();
    const transparent = transparentColor.alpha(0);
    const radGrad = ctx.createRadialGradient(cx, cy, minRad, cx, cy, maxRad);

    radGrad.addColorStop(0, transparent.toRgbString());
    radGrad.addColorStop(0.01, transparentColor.toRgbString());
    radGrad.addColorStop(0.1, transparentColor.toRgbString());
    radGrad.addColorStop(1, transparent.toRgbString());

    ctx.arc(cx, cy, maxRad, 0, Math.PI * 2);
    ctx.fillStyle = radGrad;
    ctx.closePath();
    ctx.fill();

    const breatheInner = breathingColor.alpha(0);
    ctx.beginPath();
    const radGrad2 = ctx.createRadialGradient(cx, cy, minRad, cx, cy, radius);
    radGrad2.addColorStop(0, breatheInner.toRgbString());
    radGrad2.addColorStop(0.01, breathingColor.toRgbString());
    radGrad2.addColorStop(1, breathingColor.toRgbString());

    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = radGrad2;
    ctx.fill();
  }

  private nowMs(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  private ensureContestScratch() {
    const size = this.game.width() * this.game.height();
    if (!this.contestComponentIds || this.contestComponentIds.length !== size) {
      this.contestComponentIds = new Uint16Array(size);
      this.contestPrevOwners = new Uint16Array(size);
      this.contestAttackers = new Uint16Array(size);
      this.contestTileIndices = new Int32Array(size);
      this.contestTileIndices.fill(-1);
      this.contestComponents.clear();
      this.contestFreeIds = [];
      this.contestNextId = 1;
      this.contestActive = false;
    }
  }

  private updateInterpolationState(now: number) {
    if (!this.territoryRenderer) {
      return;
    }

    if (this.tickTimeMsPrev <= 0 || this.tickTimeMsCurrent <= 0) {
      this.lastInterpolationPair = "prevCurrent";
      this.territoryRenderer.setInterpolationPair("prevCurrent");
      this.territoryRenderer.setSmoothProgress(1);
      this.territoryRenderer.setSmoothEnabled(false);
      return;
    }

    const renderTime = now - this.interpolationDelayMs;

    let pair: "prevCurrent" | "olderPrev" = "prevCurrent";
    let fromTime = this.tickTimeMsPrev;
    let toTime = this.tickTimeMsCurrent;

    if (this.tickTimeMsOlder > 0 && renderTime < this.tickTimeMsPrev) {
      pair = "olderPrev";
      fromTime = this.tickTimeMsOlder;
      toTime = this.tickTimeMsPrev;
    }

    const denom = Math.max(1, Math.min(250, toTime - fromTime));
    const progress = Math.max(0, Math.min(1, (renderTime - fromTime) / denom));

    this.lastInterpolationPair = pair;
    this.territoryRenderer.setInterpolationPair(pair);
    this.territoryRenderer.setSmoothProgress(progress);
    this.territoryRenderer.setSmoothEnabled(true);
  }

  private applyContestChanges(
    changes: Array<{ tile: TileRef; previousOwner: number; newOwner: number }>,
    nowTickPacked: number,
  ) {
    if (!this.territoryRenderer || changes.length === 0) {
      return;
    }
    this.ensureContestScratch();

    for (const change of changes) {
      if (change.newOwner === change.previousOwner) {
        continue;
      }
      const tile = change.tile;
      const currentId = this.contestId(tile);
      if (currentId === 0) {
        this.startContestForTile(
          tile,
          change.previousOwner,
          change.newOwner,
          nowTickPacked,
        );
        continue;
      }

      const component = this.contestComponents.get(currentId);
      if (!component) {
        this.clearContestTile(tile);
        this.startContestForTile(
          tile,
          change.previousOwner,
          change.newOwner,
          nowTickPacked,
        );
        continue;
      }

      if (
        change.newOwner === component.attacker ||
        change.newOwner === component.defender
      ) {
        const attackerEver =
          change.newOwner === component.attacker || this.hasAttackerEver(tile);
        this.setContestTileData(
          tile,
          component.defender,
          component.attacker,
          component.id,
          attackerEver,
        );
        component.lastActivityPacked = nowTickPacked;
        this.territoryRenderer.setContestTime(component.id, nowTickPacked);
      } else {
        this.removeTileFromComponent(tile, component);
        this.startContestForTile(
          tile,
          change.previousOwner,
          change.newOwner,
          nowTickPacked,
        );
      }
    }
  }

  private updateContestStrengths() {
    if (!this.territoryRenderer) {
      return;
    }
    if (this.contestComponents.size === 0) {
      return;
    }

    const involvedIds = new Set<number>();
    for (const component of this.contestComponents.values()) {
      involvedIds.add(component.attacker);
      involvedIds.add(component.defender);
    }
    const totalTroopsById = this.buildTotalTroopsLookup(involvedIds);
    const attackTroopsById = this.buildAttackTroopsLookup(involvedIds);

    const pairStrength = new Map<number, number>();
    for (const component of this.contestComponents.values()) {
      const key = (component.attacker << 16) | component.defender;
      let strength = pairStrength.get(key);
      if (strength === undefined) {
        strength = this.computeContestStrength(
          component.attacker,
          component.defender,
          totalTroopsById,
          attackTroopsById,
        );
        pairStrength.set(key, strength);
      }
      component.strength =
        component.strength * (1 - CONTEST_STRENGTH_EMA_ALPHA) +
        strength * CONTEST_STRENGTH_EMA_ALPHA;
      component.strength = Math.max(
        CONTEST_STRENGTH_MIN,
        Math.min(CONTEST_STRENGTH_MAX, component.strength),
      );
      this.territoryRenderer.setContestStrength(
        component.id,
        component.strength,
      );
    }
  }

  private buildTotalTroopsLookup(
    involvedIds: Set<number>,
  ): Map<number, number> {
    const totals = new Map<number, number>();
    for (const id of involvedIds) {
      const player = this.game.playerBySmallID(id);
      if (player instanceof PlayerView) {
        totals.set(id, player.troops());
      }
    }
    return totals;
  }

  private buildAttackTroopsLookup(
    involvedIds: Set<number>,
  ): Map<number, Map<number, number>> {
    const totals = new Map<number, Map<number, number>>();
    for (const id of involvedIds) {
      const player = this.game.playerBySmallID(id);
      if (!(player instanceof PlayerView)) {
        continue;
      }
      const outgoing = player.outgoingAttacks();
      if (outgoing.length === 0) {
        continue;
      }
      for (const attack of outgoing) {
        if (!involvedIds.has(attack.targetID)) {
          continue;
        }
        let byTarget = totals.get(id);
        if (!byTarget) {
          byTarget = new Map<number, number>();
          totals.set(id, byTarget);
        }
        byTarget.set(
          attack.targetID,
          (byTarget.get(attack.targetID) ?? 0) + attack.troops,
        );
      }
    }
    return totals;
  }

  private computeContestStrength(
    attackerId: number,
    defenderId: number,
    totalTroopsById: Map<number, number>,
    attackTroopsById: Map<number, Map<number, number>>,
  ) {
    const attackerTroops = totalTroopsById.get(attackerId);
    const defenderTroops = totalTroopsById.get(defenderId);
    if (attackerTroops === undefined || defenderTroops === undefined) {
      return 0.5;
    }

    const attackerAttackTroops =
      attackTroopsById.get(attackerId)?.get(defenderId) ?? 0;
    const defenderAttackTroops =
      attackTroopsById.get(defenderId)?.get(attackerId) ?? 0;
    const attackerPower = attackerTroops + attackerAttackTroops;
    const defenderPower = defenderTroops + defenderAttackTroops;
    const totalPower = attackerPower + defenderPower;
    if (totalPower <= 0) {
      return 0.5;
    }
    return Math.max(0, Math.min(1, attackerPower / totalPower));
  }

  private updateContestState(nowTickPacked: number) {
    if (!this.territoryRenderer) {
      return;
    }
    this.ensureContestScratch();
    this.territoryRenderer.setContestNow(
      nowTickPacked,
      this.contestDurationTicks,
    );

    if (!this.contestActive) {
      return;
    }

    const expired: ContestComponent[] = [];
    for (const component of this.contestComponents.values()) {
      const elapsed = this.contestElapsed(
        nowTickPacked,
        component.lastActivityPacked,
      );
      if (elapsed >= this.contestDurationTicks) {
        expired.push(component);
      }
    }

    for (const component of expired) {
      this.expireContestComponent(component);
    }
  }

  private startContestForTile(
    tile: TileRef,
    defender: number,
    attacker: number,
    nowTickPacked: number,
  ): ContestComponent | null {
    if (attacker === defender || attacker === 0 || defender === 0) {
      return null;
    }
    const neighbors = this.collectNeighborComponents(tile, attacker, defender);
    let component: ContestComponent;
    if (neighbors.length === 0) {
      component = this.createContestComponent(
        attacker,
        defender,
        nowTickPacked,
      );
    } else {
      component = neighbors[0];
      for (let i = 1; i < neighbors.length; i++) {
        this.mergeContestComponents(component, neighbors[i]);
      }
    }

    this.addTileToComponent(tile, component, true);
    component.lastActivityPacked = nowTickPacked;
    this.territoryRenderer?.setContestTime(component.id, nowTickPacked);
    return component;
  }

  private collectNeighborComponents(
    tile: TileRef,
    attacker: number,
    defender: number,
  ): ContestComponent[] {
    const components: ContestComponent[] = [];
    const seen = new Set<number>();
    for (const neighbor of this.game.neighbors(tile)) {
      const id = this.contestId(neighbor);
      if (id === 0 || seen.has(id)) {
        continue;
      }
      const component = this.contestComponents.get(id);
      if (!component) {
        continue;
      }
      if (component.attacker === attacker && component.defender === defender) {
        components.push(component);
        seen.add(id);
      }
    }
    return components;
  }

  private createContestComponent(
    attacker: number,
    defender: number,
    nowTickPacked: number,
  ): ContestComponent {
    const id = this.allocateContestComponentId();
    const component: ContestComponent = {
      id,
      attacker,
      defender,
      lastActivityPacked: nowTickPacked,
      tiles: [],
      strength: 0.5,
    };
    this.contestComponents.set(id, component);
    this.contestActive = true;
    this.territoryRenderer?.ensureContestTimeCapacity(id);
    this.territoryRenderer?.setContestStrength(id, 0.5);
    return component;
  }

  private allocateContestComponentId(): number {
    const reused = this.contestFreeIds.pop();
    if (reused !== undefined) {
      return reused;
    }
    return this.contestNextId++;
  }

  private releaseContestComponentId(id: number) {
    if (id <= 0) {
      return;
    }
    this.contestFreeIds.push(id);
  }

  private addTileToComponent(
    tile: TileRef,
    component: ContestComponent,
    attackerEver: boolean,
  ) {
    this.setContestTileData(
      tile,
      component.defender,
      component.attacker,
      component.id,
      attackerEver,
    );
    this.contestTileIndices![tile] = component.tiles.length;
    component.tiles.push(tile);
    this.contestActive = true;
  }

  private removeTileFromComponent(tile: TileRef, component: ContestComponent) {
    const tileIndex = this.contestTileIndices![tile];
    const tiles = component.tiles;
    const lastIndex = tiles.length - 1;
    if (tileIndex >= 0 && tileIndex <= lastIndex) {
      if (tileIndex !== lastIndex) {
        const swapTile = tiles[lastIndex];
        tiles[tileIndex] = swapTile;
        this.contestTileIndices![swapTile] = tileIndex;
      }
      tiles.pop();
    }
    this.contestTileIndices![tile] = -1;
    this.clearContestTile(tile);
    if (component.tiles.length === 0) {
      this.territoryRenderer?.setContestStrength(component.id, 0);
      this.contestComponents.delete(component.id);
      this.releaseContestComponentId(component.id);
      this.contestActive = this.contestComponents.size > 0;
    }
  }

  private mergeContestComponents(
    target: ContestComponent,
    source: ContestComponent,
  ) {
    const targetSize = target.tiles.length;
    const sourceSize = source.tiles.length;
    const totalSize = targetSize + sourceSize;
    if (totalSize > 0) {
      target.strength = Math.min(
        1,
        (target.strength * targetSize + source.strength * sourceSize) /
          totalSize,
      );
    }
    for (const tile of source.tiles) {
      const attackerEver = this.hasAttackerEver(tile);
      this.setContestTileData(
        tile,
        target.defender,
        target.attacker,
        target.id,
        attackerEver,
      );
      this.contestTileIndices![tile] = target.tiles.length;
      target.tiles.push(tile);
    }
    target.lastActivityPacked = Math.max(
      target.lastActivityPacked,
      source.lastActivityPacked,
    );
    this.territoryRenderer?.setContestTime(
      target.id,
      target.lastActivityPacked,
    );
    this.contestComponents.delete(source.id);
    this.territoryRenderer?.setContestStrength(source.id, 0);
    this.releaseContestComponentId(source.id);
  }

  private expireContestComponent(component: ContestComponent) {
    for (const tile of component.tiles) {
      this.contestTileIndices![tile] = -1;
      this.clearContestTile(tile);
    }
    component.tiles.length = 0;
    this.territoryRenderer?.setContestStrength(component.id, 0);
    this.contestComponents.delete(component.id);
    this.releaseContestComponentId(component.id);
    this.contestActive = this.contestComponents.size > 0;
  }

  private setContestTileData(
    tile: TileRef,
    defender: number,
    attacker: number,
    componentId: number,
    attackerEver: boolean,
  ) {
    this.contestPrevOwners![tile] = defender;
    this.contestAttackers![tile] = attacker;
    this.contestComponentIds![tile] =
      (componentId & CONTEST_ID_MASK) |
      (attackerEver ? CONTEST_ATTACKER_EVER_BIT : 0);
    this.territoryRenderer?.setContestTile(
      tile,
      defender,
      attacker,
      componentId,
      attackerEver,
    );
  }

  private clearContestTile(tile: TileRef) {
    this.contestPrevOwners![tile] = 0;
    this.contestAttackers![tile] = 0;
    this.contestComponentIds![tile] = 0;
    this.territoryRenderer?.clearContestTile(tile);
  }

  private contestId(tile: TileRef): number {
    return this.contestComponentIds![tile] & CONTEST_ID_MASK;
  }

  private hasAttackerEver(tile: TileRef): boolean {
    return (this.contestComponentIds![tile] & CONTEST_ATTACKER_EVER_BIT) !== 0;
  }

  private packContestTick(tick: number): number {
    return Math.floor(tick) % CONTEST_TIME_WRAP;
  }

  private contestElapsed(nowPacked: number, startPacked: number): number {
    if (nowPacked >= startPacked) {
      return nowPacked - startPacked;
    }
    return CONTEST_TIME_WRAP - startPacked + nowPacked;
  }

  private syncContestStateToRenderer() {
    if (!this.territoryRenderer) {
      return;
    }
    if (!this.contestComponentIds) {
      return;
    }
    this.contestActive = this.contestComponents.size > 0;
    let maxId = 0;
    for (const component of this.contestComponents.values()) {
      maxId = Math.max(maxId, component.id);
    }
    if (maxId > 0) {
      this.territoryRenderer.ensureContestTimeCapacity(maxId);
      this.territoryRenderer.ensureContestStrengthCapacity(maxId);
    }
    for (const component of this.contestComponents.values()) {
      this.territoryRenderer.setContestTime(
        component.id,
        component.lastActivityPacked,
      );
      this.territoryRenderer.setContestStrength(
        component.id,
        component.strength,
      );
      for (const tile of component.tiles) {
        const packed = this.contestComponentIds![tile];
        const attackerEver = (packed & CONTEST_ATTACKER_EVER_BIT) !== 0;
        this.territoryRenderer.setContestTile(
          tile,
          component.defender,
          component.attacker,
          component.id,
          attackerEver,
        );
      }
    }
  }

  private computePaletteSignature(): string {
    let maxSmallId = 0;
    for (const player of this.game.playerViews()) {
      maxSmallId = Math.max(maxSmallId, player.smallID());
    }
    const patternsEnabled = this.userSettings.territoryPatterns();
    return `${this.game.playerViews().length}:${maxSmallId}:${patternsEnabled ? 1 : 0}`;
  }

  private refreshPaletteIfNeeded() {
    if (!this.territoryRenderer) {
      return;
    }
    const signature = this.computePaletteSignature();
    if (signature !== this.lastPaletteSignature) {
      this.lastPaletteSignature = signature;
      this.territoryRenderer.refreshPalette();
    }
  }

  private drawDebugOverlay(context: CanvasRenderingContext2D) {
    if (!this.territoryRenderer) {
      return;
    }
    const stats = this.territoryRenderer.getDebugStats();
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.font = "12px monospace";
    context.textBaseline = "top";
    const jfaStatus = stats.jfaSupported
      ? "on"
      : `off (${stats.jfaDisabledReason ?? "disabled"})`;
    const lines = [
      `map: ${stats.mapWidth}x${stats.mapHeight}`,
      `view: ${stats.viewWidth}x${stats.viewHeight}`,
      `scale: ${stats.viewScale.toFixed(2)}`,
      `offset: ${stats.viewOffsetX.toFixed(1)}, ${stats.viewOffsetY.toFixed(1)}`,
      `smooth: ${stats.smoothEnabled ? "on" : "off"} ${stats.smoothProgress.toFixed(2)} pair ${this.lastInterpolationPair}`,
      `tick: ${this.tickNumberCurrent ?? "-"} prev ${this.tickNumberPrev ?? "-"}`,
      `delayMs: ${this.interpolationDelayMs.toFixed(0)}`,
      `smoothPrereq: prevCopy ${stats.prevStateCopySupported ? "yes" : "no"}`,
      `jfa: ${jfaStatus} dirty ${stats.jfaDirty ? "yes" : "no"}`,
      `contests: ${this.contestEnabled ? "on" : "off"} comps ${this.contestComponents.size}`,
      `contestTiles: ${this.contestTileCount}`,
      `contestTicks: ${this.contestDurationTicks}`,
      `hovered: ${stats.hoveredPlayerId}`,
    ];
    const padding = 6;
    const lineHeight = 14;
    let maxWidth = 0;
    for (const line of lines) {
      maxWidth = Math.max(maxWidth, context.measureText(line).width);
    }
    const width = Math.ceil(maxWidth + padding * 2);
    const height = padding * 2 + lines.length * lineHeight;
    context.fillStyle = "rgba(0, 0, 0, 0.6)";
    context.fillRect(10, 10, width, height);
    context.fillStyle = "rgba(255, 255, 255, 0.9)";
    let y = 10 + padding;
    for (const line of lines) {
      context.fillText(line, 10 + padding, y);
      y += lineHeight;
    }
    context.restore();
  }
}
