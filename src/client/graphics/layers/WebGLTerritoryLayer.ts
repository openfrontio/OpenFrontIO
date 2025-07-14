import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Colord } from "colord";
import { Theme } from "../../../core/configuration/Config";
import { EventBus } from "../../../core/EventBus";
import { Cell, PlayerType, UnitType } from "../../../core/game/Game";
import { euclDistFN, TileRef } from "../../../core/game/GameMap";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView, PlayerView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { AlternateViewEvent, DragEvent } from "../../InputHandler";
import { TransformHandler } from "../TransformHandler";
import { WebGLUtils } from "../webgl/WebGLUtils";
import { Layer } from "./Layer";
import { TerritoryLayer } from "./TerritoryLayer";

export class WebGLTerritoryLayer implements Layer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private fallbackLayer: TerritoryLayer | null = null;
  private isWebGLInitialized = false;
  private theme: Theme;
  private textureUniformLocation: WebGLUniformLocation | null = null;
  private needsRedraw = false;

  private userSettings: UserSettings;
  private textureData: Uint8Array | null = null;
  private tileToRenderQueue: PriorityQueue<{
    tile: TileRef;
    lastUpdate: number;
  }> = new PriorityQueue((a, b) => {
    return a.lastUpdate - b.lastUpdate;
  });
  private random = new PseudoRandom(123);

  // Used for spawn highlighting
  private highlightCanvas: HTMLCanvasElement;
  private highlightContext: CanvasRenderingContext2D;

  private alternativeView = false;
  private lastDragTime = 0;
  private nodrawDragDuration = 200;

  private refreshRate = 10; // refresh every 10ms
  private lastRefresh = 0;

  private lastFocusedPlayer: PlayerView | null = null;

  private static readonly VERTEX_SHADER_SOURCE = `
    attribute vec2 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;
    
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
      v_texCoord = a_texCoord;
    }
  `;

  private static readonly FRAGMENT_SHADER_SOURCE = `
    precision mediump float;
    uniform sampler2D u_texture;
    varying vec2 v_texCoord;
    
    void main() {
      gl_FragColor = texture2D(u_texture, v_texCoord);
    }
  `;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    userSettings: UserSettings,
  ) {
    this.userSettings = userSettings;
    this.theme = game.config().theme();
    this.canvas = document.createElement("canvas");

    // Initialize highlight canvas
    this.highlightCanvas = document.createElement("canvas");
    const highlightContext = this.highlightCanvas.getContext("2d", {
      alpha: true,
    });
    if (highlightContext === null) throw new Error("2d context not supported");
    this.highlightContext = highlightContext;
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
    if (this.fallbackLayer) {
      this.fallbackLayer.tick();
      return;
    }

    if (!this.isWebGLInitialized) {
      return;
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

    if (!this.game.inSpawnPhase()) {
      return;
    }
    if (this.game.ticks() % 5 === 0) {
      return;
    }

    this.highlightContext.clearRect(
      0,
      0,
      this.game.width(),
      this.game.height(),
    );
    const humans = this.game
      .playerViews()
      .filter((p) => p.type() === PlayerType.Human);

    for (const human of humans) {
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
      if (
        myPlayer !== null &&
        myPlayer !== human &&
        myPlayer.isFriendly(human)
      ) {
        color = this.theme.selfColor();
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

  init() {
    console.log("WEBGL TERRITORY LAYER: Initializing WebGL territory layer");

    this.eventBus.on(AlternateViewEvent, (e) => {
      this.alternativeView = e.alternateView;
    });
    this.eventBus.on(DragEvent, (e) => {
      // TODO: consider re-enabling this on mobile or low end devices for smoother dragging.
      // this.lastDragTime = Date.now();
    });

    if (!WebGLUtils.isWebGLSupported()) {
      console.warn(
        "🟢 WEBGL TERRITORY LAYER: WebGL not supported, falling back to canvas territory layer",
      );
      this.fallbackToCanvas();
      return;
    }

    if (this.initWebGL()) {
      console.log(
        "🟢 WEBGL TERRITORY LAYER: WebGL territory layer initialized successfully - YOU SHOULD SEE TERRITORY COLORS!",
      );
      this.isWebGLInitialized = true;
      this.redraw();
    } else {
      console.warn(
        "🟢 WEBGL TERRITORY LAYER: WebGL initialization failed, falling back to canvas territory layer",
      );
      this.fallbackToCanvas();
    }
  }

  redraw() {
    if (!this.isWebGLInitialized) {
      if (this.fallbackLayer) {
        this.fallbackLayer.redraw();
      }
      return;
    }

    console.log("🟢 WEBGL TERRITORY LAYER: redrew territory layer");

    // Set up highlight canvas dimensions
    this.highlightCanvas.width = this.game.width();
    this.highlightCanvas.height = this.game.height();

    // Initialize texture data and render all territories
    this.initTextureData();
    this.game.forEachTile((t) => {
      this.paintTerritory(t);
    });
    this.uploadTextureData();
    this.needsRedraw = true;
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (this.fallbackLayer) {
      this.fallbackLayer.renderLayer(context);
      return;
    }

    if (!this.isWebGLInitialized) {
      return;
    }

    const now = Date.now();
    if (
      now > this.lastDragTime + this.nodrawDragDuration &&
      now > this.lastRefresh + this.refreshRate
    ) {
      this.lastRefresh = now;
      this.renderTerritory();
    }

    if (this.needsRedraw) {
      this.renderToCanvas();
      this.needsRedraw = false;
    }

    if (this.alternativeView) {
      return;
    }

    context.drawImage(
      this.canvas,
      -this.game.width() / 2,
      -this.game.height() / 2,
      this.game.width(),
      this.game.height(),
    );

    if (this.game.inSpawnPhase()) {
      context.drawImage(
        this.highlightCanvas,
        -this.game.width() / 2,
        -this.game.height() / 2,
        this.game.width(),
        this.game.height(),
      );
    }
  }

  private initWebGL(): boolean {
    this.canvas.width = this.game.width();
    this.canvas.height = this.game.height();

    this.gl = this.canvas.getContext("webgl") as WebGLRenderingContext | null;
    if (!this.gl) {
      console.error("Failed to get WebGL context");
      return false;
    }

    const vertexShader = WebGLUtils.createShader(
      this.gl,
      this.gl.VERTEX_SHADER,
      WebGLTerritoryLayer.VERTEX_SHADER_SOURCE,
    );
    const fragmentShader = WebGLUtils.createShader(
      this.gl,
      this.gl.FRAGMENT_SHADER,
      WebGLTerritoryLayer.FRAGMENT_SHADER_SOURCE,
    );

    if (!vertexShader || !fragmentShader) {
      console.error("Failed to create shaders");
      return false;
    }

    // Create program
    this.program = WebGLUtils.createProgram(
      this.gl,
      vertexShader,
      fragmentShader,
    );
    if (!this.program) {
      console.error("Failed to create shader program");
      return false;
    }

    // Format: [x, y, u, v] for each vertex
    const vertexData = new Float32Array([
      // Position    // Texture coords
      -1.0,
      -1.0,
      0.0,
      1.0, // Bottom left
      1.0,
      -1.0,
      1.0,
      1.0, // Bottom right
      -1.0,
      1.0,
      0.0,
      0.0, // Top left
      1.0,
      1.0,
      1.0,
      0.0, // Top right
    ]);

    const vertexBuffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vertexBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertexData, this.gl.STATIC_DRAW);

    const positionAttributeLocation = this.gl.getAttribLocation(
      this.program,
      "a_position",
    );
    this.gl.enableVertexAttribArray(positionAttributeLocation);
    this.gl.vertexAttribPointer(
      positionAttributeLocation,
      2, // 2 components per vertex (x, y)
      this.gl.FLOAT,
      false,
      4 * 4, // stride: 4 floats * 4 bytes per float
      0, // offset: start at beginning
    );

    // Set up texture coordinate attribute
    const texCoordAttributeLocation = this.gl.getAttribLocation(
      this.program,
      "a_texCoord",
    );
    this.gl.enableVertexAttribArray(texCoordAttributeLocation);
    this.gl.vertexAttribPointer(
      texCoordAttributeLocation,
      2, // 2 components per vertex (u, v)
      this.gl.FLOAT,
      false,
      4 * 4, // stride: 4 floats * 4 bytes per float
      2 * 4, // offset: skip 2 floats (x, y) to get to texture coords
    );

    // Create territory texture
    this.texture = this.createTerritoryTexture();
    if (!this.texture) {
      console.error("Failed to create territory texture");
      return false;
    }

    // Cache uniform location to avoid lookup on every frame
    this.textureUniformLocation = this.gl.getUniformLocation(
      this.program,
      "u_texture",
    );

    return true;
  }

  private createTerritoryTexture(): WebGLTexture | null {
    if (!this.gl) {
      return null;
    }

    const width = this.game.width();
    const height = this.game.height();
    this.textureData = new Uint8Array(width * height * 4); // RGBA

    // Initialize with transparent pixels
    this.initTextureData();

    const texture = WebGLUtils.createTexture(
      this.gl,
      width,
      height,
      this.textureData,
    );
    return texture;
  }

  private initTextureData() {
    if (!this.textureData) {
      return;
    }

    // Initialize all pixels as transparent
    this.game.forEachTile((tile) => {
      const cell = new Cell(this.game.x(tile), this.game.y(tile));
      const index = cell.y * this.game.width() + cell.x;
      const offset = index * 4;
      this.textureData![offset + 3] = 0; // Set alpha to 0 (fully transparent)
    });
  }

  private uploadTextureData() {
    if (!this.gl || !this.texture || !this.textureData) {
      return;
    }

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.game.width(),
      this.game.height(),
      0,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      this.textureData,
    );
  }

  private renderToCanvas(): void {
    if (!this.gl || !this.program || !this.texture) {
      return;
    }

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Enable blending for transparency
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);

    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.useProgram(this.program);
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
    if (this.textureUniformLocation) {
      this.gl.uniform1i(this.textureUniformLocation, 0);
    }

    // Draw the textured quad
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  private renderTerritory() {
    let numToRender = Math.floor(this.tileToRenderQueue.size() / 10);
    if (numToRender === 0 || this.game.inSpawnPhase()) {
      numToRender = this.tileToRenderQueue.size();
    }

    let needsUpload = false;

    while (numToRender > 0) {
      numToRender--;

      const entry = this.tileToRenderQueue.pop();
      if (!entry) {
        break;
      }

      const tile = entry.tile;
      this.paintTerritory(tile);
      needsUpload = true;

      for (const neighbor of this.game.neighbors(tile)) {
        this.paintTerritory(neighbor, true);
      }
    }

    if (needsUpload) {
      this.uploadTextureData();
      this.needsRedraw = true;
    }
  }

  paintTerritory(tile: TileRef, isBorder: boolean = false) {
    if (isBorder && !this.game.hasOwner(tile)) {
      return;
    }
    if (!this.game.hasOwner(tile)) {
      if (this.game.hasFallout(tile)) {
        this.paintTile(tile, this.theme.falloutColor(), 150);
        return;
      }
      this.clearTile(tile);
      return;
    }

    const owner = this.game.owner(tile) as PlayerView;
    if (this.game.isBorder(tile)) {
      const playerIsFocused = owner && this.game.focusedPlayer() === owner;
      if (
        this.game.hasUnitNearby(
          tile,
          this.game.config().defensePostRange(),
          UnitType.DefensePost,
          owner.id(),
        )
      ) {
        const borderColors = this.theme.defendedBorderColors(owner);
        const x = this.game.x(tile);
        const y = this.game.y(tile);
        const lightTile =
          (x % 2 === 0 && y % 2 === 0) || (y % 2 === 1 && x % 2 === 1);
        const borderColor = lightTile ? borderColors.light : borderColors.dark;
        this.paintTile(tile, borderColor, 255);
      } else {
        const useBorderColor = playerIsFocused
          ? this.theme.focusedBorderColor()
          : this.theme.borderColor(owner);
        this.paintTile(tile, useBorderColor, 255);
      }
    } else {
      // For now, only render solid colors (no patterns)
      this.paintTile(tile, this.theme.territoryColor(owner), 150);
    }
  }

  paintTile(tile: TileRef, color: Colord, alpha: number) {
    if (!this.textureData) {
      return;
    }

    const offset = tile * 4;
    this.textureData[offset] = color.rgba.r;
    this.textureData[offset + 1] = color.rgba.g;
    this.textureData[offset + 2] = color.rgba.b;
    this.textureData[offset + 3] = alpha;
  }

  clearTile(tile: TileRef) {
    if (!this.textureData) {
      return;
    }

    const offset = tile * 4;
    this.textureData[offset + 3] = 0; // Set alpha to 0 (fully transparent)
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

  private fallbackToCanvas(): void {
    this.fallbackLayer = new TerritoryLayer(
      this.game,
      this.eventBus,
      this.transformHandler,
      this.userSettings,
    );
    this.fallbackLayer.init();
  }
}
