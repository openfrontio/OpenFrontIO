import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import {
  Cell,
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
  DragEvent,
  MouseOverEvent,
  TerritoryWebGLStatusEvent,
  ToggleTerritoryWebGLDebugBordersEvent,
  ToggleTerritoryWebGLEvent,
} from "../../InputHandler";
import { FrameProfiler } from "../FrameProfiler";
import { resolveHoverTarget } from "../HoverTargetResolver";
import { TransformHandler } from "../TransformHandler";
import { BorderRenderer, NullBorderRenderer } from "./BorderRenderer";
import { Layer } from "./Layer";
import { WebGLBorderRenderer } from "./WebGLBorderRenderer";

export class TerritoryLayer implements Layer {
  private userSettings: UserSettings;
  private canvas: HTMLCanvasElement;
  private context: CanvasRenderingContext2D;
  private imageData: ImageData;
  private alternativeImageData: ImageData;
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
  private borderRenderer: BorderRenderer = new NullBorderRenderer();

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
    if (this.game.inSpawnPhase()) {
      this.spawnHighlight();
    }

    this.game.recentlyUpdatedTiles().forEach((t) => this.enqueueTile(t));
    const updates = this.game.updatesSinceLastTick();
    const unitUpdates = updates !== null ? updates[GameUpdateType.Unit] : [];
    unitUpdates.forEach((update) => {
      if (update.unitType === UnitType.DefensePost) {
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
        }
      });
    }

    const focusedPlayer = this.game.focusedPlayer();
    if (focusedPlayer !== this.lastFocusedPlayer) {
      if (this.lastFocusedPlayer) {
        this.paintPlayerBorder(this.lastFocusedPlayer);
      }
      if (focusedPlayer) {
        this.paintPlayerBorder(focusedPlayer);
      }
      this.lastFocusedPlayer = focusedPlayer;
    }

    const currentMyPlayer = this.game.myPlayer()?.smallID() ?? null;
    if (currentMyPlayer !== this.lastMyPlayerSmallId) {
      this.redraw();
    }
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
    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
      this.borderRenderer.setAlternativeView(this.alternativeView);
      if (this.borderRenderer instanceof WebGLBorderRenderer) {
        this.borderRenderer.setHoverHighlightOptions(
          this.hoverHighlightOptions(),
        );
      }
    });
    this.eventBus.on(ToggleTerritoryWebGLEvent, () => {
      this.userSettings.toggleTerritoryWebGL();
      this.useWebGL = this.userSettings.territoryWebGL();
      this.redraw();
    });
    this.eventBus.on(ToggleTerritoryWebGLDebugBordersEvent, (e) => {
      if (this.borderRenderer instanceof WebGLBorderRenderer) {
        this.borderRenderer.setDebugPulseEnabled(e.enabled);
      }
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
      this.alternativeView || this.borderRenderer.drawsOwnBorders();
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
    if (!this.game.isValidCoord(cell.x, cell.y)) {
      return;
    }

    const previousTerritory = this.highlightedTerritory;
    const territory = resolveHoverTarget(this.game, cell).player;

    if (territory) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    if (previousTerritory?.id() !== this.highlightedTerritory?.id()) {
      if (this.borderRenderer.drawsOwnBorders()) {
        this.borderRenderer.setHoveredPlayerId(
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
    this.canvas = document.createElement("canvas");
    const context = this.canvas.getContext("2d");
    if (context === null) throw new Error("2d context not supported");
    this.context = context;
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    this.imageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.alternativeImageData = this.context.getImageData(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
    );
    this.initImageData();

    this.context.putImageData(
      this.alternativeView ? this.alternativeImageData : this.imageData,
      0,
      0,
    );

    this.configureBorderRenderer();

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

  private configureBorderRenderer() {
    if (!this.useWebGL) {
      this.borderRenderer = new NullBorderRenderer();
      this.webglSupported = true;
      this.emitWebGLStatus(
        false,
        false,
        this.webglSupported,
        "WebGL territory layer hidden.",
      );
      return;
    }

    const renderer = new WebGLBorderRenderer(this.game, this.theme);
    this.webglSupported = renderer.isSupported();
    if (renderer.isActive()) {
      this.borderRenderer = renderer;
      this.borderRenderer.setAlternativeView(this.alternativeView);
      this.borderRenderer.setHoveredPlayerId(
        this.highlightedTerritory?.smallID() ?? null,
      );
      renderer.setHoverHighlightOptions(this.hoverHighlightOptions());
      this.emitWebGLStatus(true, true, this.webglSupported);
    } else {
      this.borderRenderer = new NullBorderRenderer();
      this.emitWebGLStatus(
        true,
        false,
        this.webglSupported,
        "WebGL not available. Using canvas fallback for borders.",
      );
    }
  }

  /**
   * Central configuration for WebGL border hover styling.
   * Keeps main view and alternate view behavior explicit and tweakable.
   */
  private hoverHighlightOptions() {
    const baseColor = this.theme.spawnHighlightSelfColor();

    if (this.alternativeView) {
      // Alternate view: borders are the primary visual, so make hover stronger
      return {
        color: baseColor,
        strength: 0.8,
        pulseStrength: 0.45,
        pulseSpeed: Math.PI * 2,
      };
    }

    // Main view: keep highlight noticeable but a bit subtler
    return {
      color: baseColor,
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

  initImageData() {
    this.game.forEachTile((tile) => {
      const cell = new Cell(this.game.x(tile), this.game.y(tile));
      const index = cell.y * this.game.width() + cell.x;
      const offset = index * 4;
      this.imageData.data[offset + 3] = 0;
      this.alternativeImageData.data[offset + 3] = 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    const now = Date.now();
    const skipTerritoryCanvas =
      this.alternativeView && this.borderRenderer.drawsOwnBorders();

    if (
      now > this.lastDragTime + this.nodrawDragDuration &&
      now > this.lastRefresh + this.refreshRate
    ) {
      this.lastRefresh = now;
      const renderTerritoryStart = FrameProfiler.start();
      this.renderTerritory();
      FrameProfiler.end("TerritoryLayer:renderTerritory", renderTerritoryStart);

      const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
      const vx0 = Math.max(0, topLeft.x);
      const vy0 = Math.max(0, topLeft.y);
      const vx1 = Math.min(this.game.width() - 1, bottomRight.x);
      const vy1 = Math.min(this.game.height() - 1, bottomRight.y);

      const w = vx1 - vx0 + 1;
      const h = vy1 - vy0 + 1;

      // When WebGL borders are active and we're in alternative view, the 2D
      // territory buffer (alternativeImageData) is effectively transparent and
      // all visible work is done by the WebGL layer. Skip putImageData in that
      // case to avoid unnecessary CPU work each frame.
      const shouldBlitTerritories = !skipTerritoryCanvas;

      if (w > 0 && h > 0 && shouldBlitTerritories) {
        const putImageStart = FrameProfiler.start();
        this.context.putImageData(
          this.alternativeView ? this.alternativeImageData : this.imageData,
          0,
          0,
          vx0,
          vy0,
          w,
          h,
        );
        FrameProfiler.end("TerritoryLayer:putImageData", putImageStart);
      }
    }

    if (!skipTerritoryCanvas) {
      const drawCanvasStart = FrameProfiler.start();
      context.drawImage(
        this.canvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
      FrameProfiler.end("TerritoryLayer:drawCanvas", drawCanvasStart);
    }

    const borderRenderStart = FrameProfiler.start();
    this.borderRenderer.render(context);
    FrameProfiler.end(
      "TerritoryLayer:borderRenderer.render",
      borderRenderStart,
    );
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
    let numToRender = Math.floor(this.tileToRenderQueue.size() / 10);
    if (numToRender === 0 || this.game.inSpawnPhase()) {
      numToRender = this.tileToRenderQueue.size();
    }

    while (numToRender > 0) {
      numToRender--;

      const entry = this.tileToRenderQueue.pop();
      if (!entry) {
        break;
      }

      const tile = entry.tile;
      this.paintTerritory(tile);
      for (const neighbor of this.game.neighbors(tile)) {
        this.paintTerritory(neighbor, true);
      }
    }
  }

  paintTerritory(tile: TileRef, _maybeStaleBorder: boolean = false) {
    const cpuStart = FrameProfiler.start();
    const hasOwner = this.game.hasOwner(tile);
    const owner = hasOwner ? (this.game.owner(tile) as PlayerView) : null;
    const isBorderTile = this.game.isBorder(tile);
    const hasFallout = this.game.hasFallout(tile);
    let isDefended = false;
    const rendererHandlesBorders = this.borderRenderer.drawsOwnBorders();

    if (!owner) {
      if (hasFallout) {
        this.paintTile(this.imageData, tile, this.theme.falloutColor(), 150);
        this.paintTile(
          this.alternativeImageData,
          tile,
          this.theme.falloutColor(),
          150,
        );
      } else {
        this.clearTile(tile);
      }
    } else {
      const myPlayer = this.game.myPlayer();

      if (isBorderTile) {
        isDefended = this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        );

        if (rendererHandlesBorders) {
          this.paintTile(this.imageData, tile, owner.territoryColor(tile), 150);
        } else {
          if (myPlayer) {
            const alternativeColor = this.alternateViewColor(owner);
            this.paintTile(
              this.alternativeImageData,
              tile,
              alternativeColor,
              255,
            );
          }
          this.paintTile(
            this.imageData,
            tile,
            owner.borderColor(tile, isDefended),
            255,
          );
        }
      } else {
        if (!rendererHandlesBorders) {
          // Alternative view only shows borders.
          this.clearAlternativeTile(tile);
        }

        this.paintTile(this.imageData, tile, owner.territoryColor(tile), 150);
      }
    }
    FrameProfiler.end("TerritoryLayer:paintTerritory.cpu", cpuStart);

    if (rendererHandlesBorders) {
      if (_maybeStaleBorder && !isBorderTile) {
        this.borderRenderer.clearTile(tile);
      } else {
        const borderUpdateStart = FrameProfiler.start();
        this.borderRenderer.updateBorder(
          tile,
          owner,
          isBorderTile,
          isDefended,
          hasFallout,
        );
        FrameProfiler.end(
          "TerritoryLayer:borderRenderer.updateBorder",
          borderUpdateStart,
        );
      }
    }
  }

  alternateViewColor(other: PlayerView): Colord {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) {
      return this.theme.neutralColor();
    }
    if (other.smallID() === myPlayer.smallID()) {
      return this.theme.selfColor();
    }
    if (other.isFriendly(myPlayer)) {
      return this.theme.allyColor();
    }
    if (!other.hasEmbargo(myPlayer)) {
      return this.theme.neutralColor();
    }
    return this.theme.enemyColor();
  }

  paintAlternateViewTile(tile: TileRef, other: PlayerView) {
    const color = this.alternateViewColor(other);
    this.paintTile(this.alternativeImageData, tile, color, 255);
  }

  paintTile(imageData: ImageData, tile: TileRef, color: Colord, alpha: number) {
    const offset = tile * 4;
    imageData.data[offset] = color.rgba.r;
    imageData.data[offset + 1] = color.rgba.g;
    imageData.data[offset + 2] = color.rgba.b;
    imageData.data[offset + 3] = alpha;
  }

  clearTile(tile: TileRef) {
    this.borderRenderer.clearTile(tile);
    const offset = tile * 4;
    this.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
    this.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
  }

  clearAlternativeTile(tile: TileRef) {
    const offset = tile * 4;
    this.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
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
