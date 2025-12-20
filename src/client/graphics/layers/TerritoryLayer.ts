import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import {
  ColoredTeams,
  PlayerType,
  Team,
  UnitType,
} from "../../../core/game/Game";
import { euclDistFN, TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { PseudoRandom } from "../../../core/PseudoRandom";
import {
  AlternateViewEvent,
  ContextMenuEvent,
  DragEvent,
  MouseOverEvent,
  TerritoryWebGLStatusEvent,
  ToggleTerritoryWebGLEvent,
} from "../../InputHandler";
import { FrameProfiler } from "../FrameProfiler";
import { resolveHoverTarget } from "../HoverTarget";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";
import {
  CanvasTerritoryRenderer,
  TerritoryRendererStrategy,
  WebglTerritoryRenderer,
} from "./TerritoryRenderers";
import { TerritoryWebGLRenderer } from "./TerritoryWebGLRenderer";

export class TerritoryLayer implements Layer {
  profileName(): string {
    return "TerritoryLayer:renderLayer";
  }

  private userSettings: UserSettings;
  private borderAnimTime = 0;

  private cachedTerritoryPatternsEnabled: boolean | undefined;

  private tileToRenderQueue: PriorityQueue<{
    tile: TileRef;
    lastUpdate: number;
  }> = new PriorityQueue((a, b) => {
    return a.lastUpdate - b.lastUpdate;
  });
  private random = new PseudoRandom(123);
  private theme: Theme;

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  private highlightedTerritory: PlayerView | null = null;
  private territoryRenderer: TerritoryRendererStrategy | null = null;

  private alternativeView = false;
  private lastDragTime = 0;
  private nodrawDragDuration = 200;
  private lastMousePosition: { x: number; y: number } | null = null;

  private refreshRate = 10; //refresh every 10ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;
  private lastMyPlayerSmallId: number | null = null;
  private useWebGL: boolean;
  private webglSupported = true;

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
    this.useWebGL = this.userSettings.territoryWebGL();
  }

  shouldTransform(): boolean {
    return true;
  }

  async paintPlayerBorder(player: PlayerView) {
    const tiles = await player.borderTiles();
    tiles.borderTiles.forEach((tile: TileRef) => {
      this.paintTerritory(tile, true); // Immediately paint the tile instead of enqueueing
    });
  }

  tick() {
    const tickProfile = FrameProfiler.start();
    if (this.game.inSpawnPhase()) {
      this.spawnHighlight();
    }

    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    const playerUpdates =
      updates !== null ? updates[GameUpdateType.Player] : [];
    let needsRelationRefresh = playerUpdates.length > 0;
    unitUpdates.forEach((update) => {
      if (update.unitType === UnitType.DefensePost) {
        // Only update borders if the defense post is not under construction
        if (update.underConstruction) {
          return; // Skip barrier creation while under construction
        }

        const tile = update.pos;
        this.game
          .bfs(tile, euclDistFN(tile, this.game.config().defensePostRange()))
          .forEach((t) => {
            if (
              this.game.isBorder(t) &&
              (this.game.ownerID(t) === update.ownerID ||
                this.game.ownerID(t) === update.lastOwnerID)
            ) {
              this.enqueueTile(t);
            }
          });
      }
    });

    // Detect alliance mutations
    const myPlayer = this.game.myPlayer();
    if (myPlayer) {
      updates?.[GameUpdateType.BrokeAlliance]?.forEach((update) => {
        const territory = this.game.playerBySmallID(update.betrayedID);
        if (territory && territory instanceof PlayerView) {
          this.redrawBorder(territory);
          needsRelationRefresh = true;
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
            this.redrawBorder(territory);
            needsRelationRefresh = true;
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
          this.redrawBorder(player, embargoed);
          needsRelationRefresh = true;
        }
      });
    }
    if (needsRelationRefresh) {
      this.territoryRenderer?.refreshPalette();
    }

    const focusedPlayer = this.game.focusedPlayer();
    if (focusedPlayer !== this.lastFocusedPlayer) {
      if (this.territoryRenderer) {
        // Force a full repaint so the GPU textures match the new focus context
        // (e.g., when jumping to another location during spawn).
        this.redraw();
      } else {
        if (this.lastFocusedPlayer) {
          this.paintPlayerBorder(this.lastFocusedPlayer);
        }
        if (focusedPlayer) {
          this.paintPlayerBorder(focusedPlayer);
        }
      }
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
        // Optionally, this could be broken down to teammate or enemy and simplified to green and red, respectively
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
    // Range: [minPadding..maxPadding]
    const radius =
      minRad + (maxRad - minRad) * (0.5 + 0.5 * Math.sin(this.borderAnimTime));

    const baseColor = this.theme.spawnHighlightSelfColor(); //white
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
      baseColor, // Always draw white static semi-transparent ring
      teamColor, // Pass the breathing ring color. White for FFA, Duos, Trios, Quads. Transparent team color for TEAM games.
    );
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
    this.eventBus.on(ToggleTerritoryWebGLEvent, () => {
      this.userSettings.toggleTerritoryWebGL();
      this.useWebGL = this.userSettings.territoryWebGL();
      this.redraw();
    });
    this.eventBus.on(DragEvent, (e) => {
      // TODO: consider re-enabling this on mobile or low end devices for smoother dragging.
      // this.lastDragTime = Date.now();
    });
    this.redraw();
  }

  onMouseOver(event: MouseOverEvent) {
    this.lastMousePosition = { x: event.x, y: event.y };
    this.updateHighlightedTerritory();
  }

  private updateHighlightedTerritory() {
    const supportsHover =
      this.alternativeView || this.territoryRenderer !== null;
    if (!supportsHover) {
      return;
    }

    if (!this.lastMousePosition) {
      return;
    }

    const cell = this.transformHandler.screenToWorldCoordinates(
      this.lastMousePosition.x,
      this.lastMousePosition.y,
    );
    const previousTerritory = this.highlightedTerritory;
    const territory = resolveHoverTarget(this.game, cell).player;

    if (territory) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    if (previousTerritory?.id() !== this.highlightedTerritory?.id()) {
      if (this.territoryRenderer?.isWebGL()) {
        this.territoryRenderer.setHover(
          this.highlightedTerritory?.smallID() ?? null,
        );
      } else {
        const territories: PlayerView[] = [];
        if (previousTerritory) {
          territories.push(previousTerritory);
        }
        if (this.highlightedTerritory) {
          territories.push(this.highlightedTerritory);
        }
        this.redrawBorder(...territories);
      }
    }
  }

  redraw() {
    console.log("redrew territory layer");
    this.lastMyPlayerSmallId = this.game.myPlayer()?.smallID() ?? null;
    this.configureRenderers();
    this.territoryRenderer?.redraw();

    // Add a second canvas for highlights
    this.highlightCanvas = document.createElement("canvas");
    const highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    if (highlightContext === null) throw new Error("2d context not supported");
    this.highlightContext = highlightContext;
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();

    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
  }

  private configureRenderers() {
    this.territoryRenderer = null;

    if (!this.useWebGL) {
      this.territoryRenderer = new CanvasTerritoryRenderer(
        this.game,
        this.theme,
      );
      this.territoryRenderer.setAlternativeView(this.alternativeView);
      this.territoryRenderer.setHoverHighlightOptions(
        this.hoverHighlightOptions(),
      );
      this.webglSupported = true;
      this.emitWebGLStatus(
        false,
        false,
        this.webglSupported,
        "WebGL territory layer hidden.",
      );
      return;
    }

    const { renderer, reason } = TerritoryWebGLRenderer.create(
      this.game,
      this.theme,
    );
    if (renderer) {
      const strategy = new WebglTerritoryRenderer(renderer, this.game);
      strategy.setAlternativeView(this.alternativeView);
      strategy.markAllDirty();
      strategy.refreshPalette();
      strategy.setHoverHighlightOptions(this.hoverHighlightOptions());
      strategy.setHover(this.highlightedTerritory?.smallID() ?? null);
      this.territoryRenderer = strategy;
      this.webglSupported = true;
      this.emitWebGLStatus(true, true, true, undefined);
      return;
    }

    const fallbackReason =
      reason ??
      "WebGL not available. Using canvas fallback for borders and fill.";
    this.territoryRenderer = new CanvasTerritoryRenderer(this.game, this.theme);
    this.territoryRenderer.setAlternativeView(this.alternativeView);
    this.territoryRenderer.setHoverHighlightOptions(
      this.hoverHighlightOptions(),
    );
    this.webglSupported = false;
    this.emitWebGLStatus(true, false, false, fallbackReason);
  }

  /**
   * Central configuration for WebGL border hover styling.
   * Keeps main view and alternate view behavior explicit and tweakable.
   */
  private hoverHighlightOptions() {
    const baseColor = this.theme.spawnHighlightSelfColor();
    const rgba = baseColor.rgba;

    if (this.alternativeView) {
      // Alternate view: borders are the primary visual, so make hover stronger
      return {
        color: { r: rgba.r, g: rgba.g, b: rgba.b },
        strength: 0.8,
        pulseStrength: 0.45,
        pulseSpeed: Math.PI * 2,
      };
    }

    // Main view: keep highlight noticeable but a bit subtler
    return {
      color: { r: rgba.r, g: rgba.g, b: rgba.b },
      strength: 0.6,
      pulseStrength: 0.35,
      pulseSpeed: Math.PI * 2,
    };
  }

  private emitWebGLStatus(
    enabled: boolean,
    active: boolean,
    supported: boolean,
    message?: string,
  ) {
    this.eventBus.emit(
      new TerritoryWebGLStatusEvent(enabled, active, supported, message),
    );
  }

  redrawBorder(...players: PlayerView[]) {
    return Promise.all(
      players.map(async (player) => {
        const tiles = await player.borderTiles();
        tiles.borderTiles.forEach((tile: TileRef) => {
          this.paintTerritory(tile, true);
        });
      }),
    );
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    const canRefresh =
      now > this.lastDragTime + this.nodrawDragDuration &&
      now > this.lastRefresh + this.refreshRate;
    if (canRefresh) {
      this.lastRefresh = now;
      const renderTerritoryStart = FrameProfiler.start();
      this.renderTerritory();
      FrameProfiler.end("TerritoryLayer:renderTerritory", renderTerritoryStart);
    }

    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const vx0 = Math.max(0, topLeft.x);
    const vy0 = Math.max(0, topLeft.y);
    const vx1 = Math.min(this.game.width() - 1, bottomRight.x);
    const vy1 = Math.min(this.game.height() - 1, bottomRight.y);

    const w = vx1 - vx0 + 1;
    const h = vy1 - vy0 + 1;
    if (this.territoryRenderer) {
      this.territoryRenderer.render(
        context,
        {
          x: vx0,
          y: vy0,
          width: w,
          height: h,
        },
        canRefresh,
      );
    }

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

  renderTerritory() {
    if (!this.territoryRenderer) {
      return;
    }
    let numToRender = Math.floor(this.tileToRenderQueue.size() / 10);
    if (
      numToRender === 0 ||
      this.game.inSpawnPhase() ||
      this.territoryRenderer.isWebGL()
    ) {
      numToRender = this.tileToRenderQueue.size();
    }

    const useNeighborPaint = !(this.territoryRenderer?.isWebGL() ?? false);
    const neighborsToPaint: TileRef[] = [];
    const mainSpan = FrameProfiler.start();
    while (numToRender > 0) {
      numToRender--;

      const entry = this.tileToRenderQueue.pop();
      if (!entry) {
        break;
      }

      const tile = entry.tile;
      this.paintTerritory(tile);

      if (useNeighborPaint) {
        for (const neighbor of this.game.neighbors(tile)) {
          neighborsToPaint.push(neighbor);
        }
      }
    }
    FrameProfiler.end("TerritoryLayer:renderTerritory.mainPaint", mainSpan);

    if (useNeighborPaint && neighborsToPaint.length > 0) {
      const neighborSpan = FrameProfiler.start();
      for (const neighbor of neighborsToPaint) {
        this.paintTerritory(neighbor, true); //this is a misuse of the _Border parameter, making it a maybe stale border
      }
      FrameProfiler.end(
        "TerritoryLayer:renderTerritory.neighborPaint",
        neighborSpan,
      );
    }
  }

  paintTerritory(tile: TileRef, _maybeStaleBorder: boolean = false) {
    this.territoryRenderer?.paintTile(tile);
  }

  clearTile(tile: TileRef) {
    this.territoryRenderer?.clearTile(tile);
  }

  enqueueTile(tile: TileRef) {
    this.tileToRenderQueue.push({
      tile: tile,
      lastUpdate: this.game.ticks() + this.random.nextFloat(0, 0.5),
    });
  }

  async enqueuePlayerBorder(player: PlayerView) {
    const playerBorderTiles = await player.borderTiles();
    playerBorderTiles.borderTiles.forEach((tile: TileRef) => {
      this.enqueueTile(tile);
    });
  }

  paintHighlightTile(tile: TileRef, color: Colord, alpha: number) {
    this.clearTile(tile);
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
    // Transparency matches the highlight color provided
    const transparent = transparentColor.alpha(0);
    const radGrad = ctx.createRadialGradient(cx, cy, minRad, cx, cy, maxRad);

    // Pixels with radius < minRad are transparent
    radGrad.addColorStop(0, transparent.toRgbString());
    // The ring then starts with solid highlight color
    radGrad.addColorStop(0.01, transparentColor.toRgbString());
    radGrad.addColorStop(0.1, transparentColor.toRgbString());
    // The outer edge of the ring is transparent
    radGrad.addColorStop(1, transparent.toRgbString());

    // Draw an arc at the max radius and fill with the created radial gradient
    ctx.arc(cx, cy, maxRad, 0, Math.PI * 2);
    ctx.fillStyle = radGrad;
    ctx.closePath();
    ctx.fill();

    const breatheInner = breathingColor.alpha(0);
    // Draw a solid ring around the starting location with outer radius = the breathing radius
    ctx.beginPath();
    const radGrad2 = ctx.createRadialGradient(cx, cy, minRad, cx, cy, radius);
    // Pixels with radius < minRad are transparent
    radGrad2.addColorStop(0, breatheInner.toRgbString());
    // The ring then starts with solid highlight color
    radGrad2.addColorStop(0.01, breathingColor.toRgbString());
    // The ring is solid throughout
    radGrad2.addColorStop(1, breathingColor.toRgbString());

    // Draw an arc at the current breathing radius and fill with the created "gradient"
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = radGrad2;
    ctx.fill();
  }
}
