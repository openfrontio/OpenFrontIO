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
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import { TerritoryWebGLRenderer } from "./TerritoryWebGLRenderer";

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
  private transitionActive = false;
  private transitionDurationMs = 500;
  private transitionTiles: TileRef[] = [];
  private transitionStartTimes: Uint16Array | null = null;
  private transitionActiveMask: Uint8Array | null = null;
  private lastGameTick = 0;
  private lastTickTime = 0;
  private lastTickDurationMs = 100;

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
    this.lastTickTime = this.nowMs();
  }

  shouldTransform(): boolean {
    return true;
  }

  tick() {
    const tickProfile = FrameProfiler.start();
    const now = this.nowMs();
    this.updateTickTiming(now);
    if (this.game.inSpawnPhase()) {
      this.spawnHighlight();
    }

    const patternsEnabled = this.userSettings.territoryPatterns();
    if (this.cachedTerritoryPatternsEnabled !== patternsEnabled) {
      this.cachedTerritoryPatternsEnabled = patternsEnabled;
      this.redraw();
    }
    this.refreshPaletteIfNeeded();

    this.game.recentlyUpdatedTiles().forEach((t) => this.markTile(t));
    this.beginTileTransitions(this.game.recentlyUpdatedOwnerTiles(), now);
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
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const previousTerritory = this.highlightedTerritory;
    const territory = this.getTerritoryAtCell(cell);

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

  private getTerritoryAtCell(cell: { x: number; y: number }) {
    const tile = this.game.ref(cell.x, cell.y);
    if (!tile) {
      return null;
    }
    if (!this.game.hasOwner(tile)) {
      return null;
    }
    const owner = this.game.owner(tile);
    return owner instanceof PlayerView ? owner : null;
  }

  redraw() {
    this.lastMyPlayerSmallId = this.game.myPlayer()?.smallID() ?? null;
    this.cachedTerritoryPatternsEnabled = this.userSettings.territoryPatterns();
    this.configureRenderers();
    this.transitionActive = false;
    this.transitionTiles = [];
    this.ensureTransitionScratch();
    this.transitionStartTimes?.fill(0);
    this.transitionActiveMask?.fill(0);

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
    const baseColor = this.theme.spawnHighlightSelfColor();
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
    this.updateTransitionState(now);

    const renderTerritoryStart = FrameProfiler.start();
    this.territoryRenderer.render();
    FrameProfiler.end("TerritoryLayer:renderTerritory", renderTerritoryStart);

    const drawTerritoryStart = FrameProfiler.start();
    context.drawImage(
      this.territoryRenderer.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );
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

  private ensureTransitionScratch() {
    const size = this.game.width() * this.game.height();
    if (
      !this.transitionStartTimes ||
      this.transitionStartTimes.length !== size
    ) {
      this.transitionStartTimes = new Uint16Array(size);
      this.transitionActiveMask = new Uint8Array(size);
    }
  }

  private updateTickTiming(now: number) {
    const currentTick = this.game.ticks();
    if (currentTick === this.lastGameTick) {
      return;
    }
    if (this.lastGameTick !== 0) {
      const tickDelta = Math.max(1, currentTick - this.lastGameTick);
      const elapsed = now - this.lastTickTime;
      const estimate = elapsed / tickDelta;
      this.lastTickDurationMs = Math.max(50, Math.min(200, estimate));
    }
    this.lastGameTick = currentTick;
    this.lastTickTime = now;
  }

  private beginTileTransitions(
    changes: Array<{ tile: TileRef; previousOwner: number; newOwner: number }>,
    now: number,
  ) {
    if (!this.territoryRenderer) {
      return;
    }
    this.ensureTransitionScratch();
    const startTimes = this.transitionStartTimes!;
    const activeMask = this.transitionActiveMask!;
    const renderer = this.territoryRenderer;
    if (changes.length === 0) {
      return;
    }
    const nowPacked = this.packTransitionTime(now);
    const startPacked = nowPacked | 0x8000;

    for (const change of changes) {
      if (change.newOwner === change.previousOwner) {
        continue;
      }
      const tile = change.tile;
      if (activeMask[tile] === 0) {
        activeMask[tile] = 1;
        this.transitionTiles.push(tile);
      }
      startTimes[tile] = nowPacked;
      renderer.setTransitionTile(tile, change.previousOwner, startPacked);
    }

    this.transitionActive = this.transitionTiles.length > 0;
  }

  private updateTransitionState(now: number) {
    if (!this.territoryRenderer) {
      return;
    }
    this.ensureTransitionScratch();
    const nowPacked = this.packTransitionTime(now);
    this.territoryRenderer.setTransitionTime(
      nowPacked,
      this.transitionDurationMs,
    );

    if (!this.transitionActive || this.transitionTiles.length === 0) {
      return;
    }

    const startTimes = this.transitionStartTimes!;
    const activeMask = this.transitionActiveMask!;
    const tiles = this.transitionTiles;
    const duration = this.transitionDurationMs;
    let writeIndex = 0;

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const start = startTimes[tile];
      if (start === 0) {
        activeMask[tile] = 0;
        this.territoryRenderer.clearTransitionTile(
          tile,
          this.game.ownerID(tile),
        );
        continue;
      }
      const elapsed = this.transitionElapsed(nowPacked, start);
      if (elapsed >= duration) {
        activeMask[tile] = 0;
        startTimes[tile] = 0;
        this.territoryRenderer.clearTransitionTile(
          tile,
          this.game.ownerID(tile),
        );
      } else {
        tiles[writeIndex++] = tile;
      }
    }
    tiles.length = writeIndex;
    this.transitionActive = tiles.length > 0;
  }

  private packTransitionTime(now: number): number {
    const wrap = 32768;
    return Math.floor(now) % wrap | 0;
  }

  private transitionElapsed(nowPacked: number, startPacked: number): number {
    const wrap = 32768;
    if (nowPacked >= startPacked) {
      return nowPacked - startPacked;
    }
    return wrap - startPacked + nowPacked;
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
}
