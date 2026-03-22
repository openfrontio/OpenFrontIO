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
  DragEvent,
  MouseOverEvent,
} from "../../InputHandler";
import { FrameProfiler } from "../FrameProfiler";
import { TransformHandler } from "../TransformHandler";
import { Layer } from "./Layer";

interface TerritoryChunk {
  x: number;
  y: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  imageData: ImageData;
  alternativeImageData: ImageData;
  dirty: boolean;
  highlightCanvas: HTMLCanvasElement;
  highlightContext: CanvasRenderingContext2D;
}

export class TerritoryLayer implements Layer {
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

  private highlightedTerritory: PlayerView | null = null;

  private alternativeView = false;
  private alternativeViewChanged = false;
  private lastDragTime = 0;
  private nodrawDragDuration = 200;
  private lastMousePosition: { x: number; y: number } | null = null;

  private refreshRate = 10; //refresh every 10ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;

  // Chunking state
  private chunks: TerritoryChunk[] = [];
  private chunkSize = 1024;
  private chunksX: number = 0;
  private chunksY: number = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    userSettings: UserSettings,
  ) {
    this.userSettings = userSettings;
    this.theme = game.config().theme();
    this.cachedTerritoryPatternsEnabled = undefined;
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
  }

  private spawnHighlight() {
    if (this.game.ticks() % 5 === 0) {
      return;
    }

    for (const chunk of this.chunks) {
      chunk.highlightContext.clearRect(0, 0, chunk.width, chunk.height);
    }

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
      teamColor, // Pass the breathing ring color
    );

    // Draw breathing rings for teammates in team games
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

    // Smaller radius for teammates
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
    this.eventBus.on(AlternateViewEvent, (e) => {
      if (this.alternativeView !== e.alternateView) {
        this.alternativeView = e.alternateView;
        this.alternativeViewChanged = true;
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
    if (!this.alternativeView) {
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
    const territory = this.getTerritoryAtCell(cell);

    if (territory) {
      this.highlightedTerritory = territory;
    } else {
      this.highlightedTerritory = null;
    }

    if (previousTerritory?.id() !== this.highlightedTerritory?.id()) {
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

  private getTerritoryAtCell(cell: { x: number; y: number }) {
    const tile = this.game.ref(cell.x, cell.y);
    if (!tile) {
      return null;
    }
    // If the tile has no owner, it is either a fallout tile or a terra nullius tile.
    if (!this.game.hasOwner(tile)) {
      return null;
    }
    const owner = this.game.owner(tile);
    return owner instanceof PlayerView ? owner : null;
  }

  redraw() {
    console.log("redrew territory layer");
    this.chunks = [];
    const width = this.game.width();
    const height = this.game.height();
    this.chunksX = Math.ceil(width / this.chunkSize);
    this.chunksY = Math.ceil(height / this.chunkSize);

    for (let cy = 0; cy < this.chunksY; cy++) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        const x = cx * this.chunkSize;
        const y = cy * this.chunkSize;
        const w = Math.min(this.chunkSize, width - x);
        const h = Math.min(this.chunkSize, height - y);

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("2d context not supported");

        const imageData = context.createImageData(w, h);
        const alternativeImageData = context.createImageData(w, h);

        const highlightCanvas = document.createElement("canvas");
        highlightCanvas.width = w;
        highlightCanvas.height = h;
        const highlightContext = highlightCanvas.getContext("2d", {
          alpha: true,
        });
        if (!highlightContext) throw new Error("2d context not supported");

        this.chunks.push({
          x,
          y,
          width: w,
          height: h,
          canvas,
          context,
          imageData,
          alternativeImageData,
          dirty: true,
          highlightCanvas,
          highlightContext,
        });
      }
    }

    this.initImageData();

    for (const chunk of this.chunks) {
      chunk.context.putImageData(
        this.alternativeView ? chunk.alternativeImageData : chunk.imageData,
        0,
        0,
      );
      chunk.dirty = false;
    }

    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
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
      const tx = this.game.x(tile);
      const ty = this.game.y(tile);
      const cx = Math.floor(tx / this.chunkSize);
      const cy = Math.floor(ty / this.chunkSize);
      const chunk = this.chunks[cy * this.chunksX + cx];

      const lx = tx - chunk.x;
      const ly = ty - chunk.y;
      const offset = (ly * chunk.width + lx) * 4;

      chunk.imageData.data[offset + 3] = 0;
      chunk.alternativeImageData.data[offset + 3] = 0;
    });
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.transformHandler.scale < 1) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "low";
    } else {
      context.imageSmoothingEnabled = false;
    }

    const now = Date.now();
    if (
      now > this.lastDragTime + this.nodrawDragDuration &&
      now > this.lastRefresh + this.refreshRate
    ) {
      this.lastRefresh = now;
      const renderTerritoryStart = FrameProfiler.start();
      this.renderTerritory();
      FrameProfiler.end("TerritoryLayer:renderTerritory", renderTerritoryStart);

      const putImageStart = FrameProfiler.start();
      for (const chunk of this.chunks) {
        if (chunk.dirty || this.alternativeViewChanged) {
          chunk.context.putImageData(
            this.alternativeView ? chunk.alternativeImageData : chunk.imageData,
            0,
            0,
          );
          chunk.dirty = false;
        }
      }
      this.alternativeViewChanged = false;
      FrameProfiler.end("TerritoryLayer:putImageData", putImageStart);
    }

    const drawCanvasStart = FrameProfiler.start();
    const [topLeft, bottomRight] = this.transformHandler.screenBoundingRect();
    const vx0 = topLeft.x;
    const vy0 = topLeft.y;
    const vx1 = bottomRight.x;
    const vy1 = bottomRight.y;

    const offsetX = -this.game.width() / 2;
    const offsetY = -this.game.height() / 2;
    const overlap = 0.5 / this.transformHandler.scale;

    for (const chunk of this.chunks) {
      if (
        chunk.x + chunk.width < vx0 ||
        chunk.x > vx1 ||
        chunk.y + chunk.height < vy0 ||
        chunk.y > vy1
      ) {
        continue;
      }
      context.drawImage(
        chunk.canvas,
        offsetX + chunk.x,
        offsetY + chunk.y,
        chunk.width + overlap,
        chunk.height + overlap,
      );
    }
    FrameProfiler.end("TerritoryLayer:drawCanvas", drawCanvasStart);

    if (this.game.inSpawnPhase()) {
      const highlightDrawStart = FrameProfiler.start();
      for (const chunk of this.chunks) {
        if (
          chunk.x + chunk.width < vx0 ||
          chunk.x > vx1 ||
          chunk.y + chunk.height < vy0 ||
          chunk.y > vy1
        ) {
          continue;
        }
        context.drawImage(
          chunk.highlightCanvas,
          offsetX + chunk.x,
          offsetY + chunk.y,
          chunk.width + overlap,
          chunk.height + overlap,
        );
      }
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

  paintTerritory(tile: TileRef, isBorder: boolean = false) {
    if (isBorder && !this.game.hasOwner(tile)) {
      return;
    }

    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        this.paintTile(false, tile, this.theme.falloutColor(), 150);
        this.paintTile(true, tile, this.theme.falloutColor(), 150);
        return;
      }
      this.clearTile(tile);
      return;
    }
    const owner = this.game.owner(tile) as PlayerView;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const isHighlighted =
      this.highlightedTerritory &&
      this.highlightedTerritory.id() === owner.id();
    const myPlayer = this.game.myPlayer();

    if (this.game.isBorder(tile)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const playerIsFocused = owner && this.game.focusedPlayer() === owner;
      if (myPlayer) {
        const alternativeColor = this.alternateViewColor(owner);
        this.paintTile(true, tile, alternativeColor, 255);
      }
      const isDefended = this.game.hasUnitNearby(
        tile,
        this.game.config().defensePostRange(),
        UnitType.DefensePost,
        owner.id(),
      );

      this.paintTile(false, tile, owner.borderColor(tile, isDefended), 255);
    } else {
      // Alternative view only shows borders.
      this.clearAlternativeTile(tile);

      this.paintTile(false, tile, owner.territoryColor(tile), 150);
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
    this.paintTile(true, tile, color, 255);
  }

  paintTile(
    isAlternative: boolean,
    tile: TileRef,
    color: Colord,
    alpha: number,
  ) {
    const tx = this.game.x(tile);
    const ty = this.game.y(tile);
    const cx = Math.floor(tx / this.chunkSize);
    const cy = Math.floor(ty / this.chunkSize);
    const chunk = this.chunks[cy * this.chunksX + cx];

    if (!chunk) return; // Prevent out of bounds exceptions on edges

    const lx = tx - chunk.x;
    const ly = ty - chunk.y;
    const offset = (ly * chunk.width + lx) * 4;

    const data = isAlternative
      ? chunk.alternativeImageData.data
      : chunk.imageData.data;
    data[offset] = color.rgba.r;
    data[offset + 1] = color.rgba.g;
    data[offset + 2] = color.rgba.b;
    data[offset + 3] = alpha;

    chunk.dirty = true;
  }

  clearTile(tile: TileRef) {
    const tx = this.game.x(tile);
    const ty = this.game.y(tile);
    const cx = Math.floor(tx / this.chunkSize);
    const cy = Math.floor(ty / this.chunkSize);
    const chunk = this.chunks[cy * this.chunksX + cx];

    if (!chunk) return;

    const lx = tx - chunk.x;
    const ly = ty - chunk.y;
    const offset = (ly * chunk.width + lx) * 4;

    chunk.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
    chunk.alternativeImageData.data[offset + 3] = 0;
    chunk.dirty = true;
  }

  clearAlternativeTile(tile: TileRef) {
    const tx = this.game.x(tile);
    const ty = this.game.y(tile);
    const cx = Math.floor(tx / this.chunkSize);
    const cy = Math.floor(ty / this.chunkSize);
    const chunk = this.chunks[cy * this.chunksX + cx];

    if (!chunk) return;

    const lx = tx - chunk.x;
    const ly = ty - chunk.y;
    const offset = (ly * chunk.width + lx) * 4;

    chunk.alternativeImageData.data[offset + 3] = 0; // Set alpha to 0
    chunk.dirty = true;
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
    const tx = this.game.x(tile);
    const ty = this.game.y(tile);
    const cx = Math.floor(tx / this.chunkSize);
    const cy = Math.floor(ty / this.chunkSize);
    const chunk = this.chunks[cy * this.chunksX + cx];

    if (!chunk) return;

    const lx = tx - chunk.x;
    const ly = ty - chunk.y;

    chunk.highlightContext.fillStyle = color.alpha(alpha / 255).toRgbString();
    chunk.highlightContext.fillRect(lx, ly, 1, 1);
  }

  clearHighlightTile(tile: TileRef) {
    const tx = this.game.x(tile);
    const ty = this.game.y(tile);
    const cx = Math.floor(tx / this.chunkSize);
    const cy = Math.floor(ty / this.chunkSize);
    const chunk = this.chunks[cy * this.chunksX + cx];

    if (!chunk) return;

    const lx = tx - chunk.x;
    const ly = ty - chunk.y;
    chunk.highlightContext.clearRect(lx, ly, 1, 1);
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
    const minX = cx - maxRad;
    const maxX = cx + maxRad;
    const minY = cy - maxRad;
    const maxY = cy + maxRad;

    const startCX = Math.max(0, Math.floor(minX / this.chunkSize));
    const endCX = Math.min(this.chunksX - 1, Math.floor(maxX / this.chunkSize));
    const startCY = Math.max(0, Math.floor(minY / this.chunkSize));
    const endCY = Math.min(this.chunksY - 1, Math.floor(maxY / this.chunkSize));

    for (let y = startCY; y <= endCY; y++) {
      for (let x = startCX; x <= endCX; x++) {
        const chunk = this.chunks[y * this.chunksX + x];
        if (!chunk) continue;
        const ctx = chunk.highlightContext;

        ctx.save();
        ctx.translate(-chunk.x, -chunk.y);

        // Draw a semi-transparent ring around the starting location
        ctx.beginPath();
        // Transparency matches the highlight color provided
        const transparent = transparentColor.alpha(0);
        const radGrad = ctx.createRadialGradient(
          cx,
          cy,
          minRad,
          cx,
          cy,
          maxRad,
        );

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
        const radGrad2 = ctx.createRadialGradient(
          cx,
          cy,
          minRad,
          cx,
          cy,
          radius,
        );
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

        ctx.restore();
      }
    }
  }
}
