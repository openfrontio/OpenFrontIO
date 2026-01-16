import { Theme } from "../../../../core/configuration/Config";
import { UnitType } from "../../../../core/game/Game";
import { GameView } from "../../../../core/game/GameView";

/**
 * Alignment helper for texture uploads.
 */
function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

/**
 * Manages authoritative GPU textures and buffers (ground truth data).
 * All compute and render passes read from this data.
 */
export class GroundTruthData {
  public static readonly PALETTE_RESERVED_SLOTS = 10;
  public static readonly PALETTE_FALLOUT_INDEX = 0;

  // Textures
  public readonly stateTexture: GPUTexture;
  public readonly terrainTexture: GPUTexture;
  public readonly paletteTexture: GPUTexture;
  public readonly defendedTexture: GPUTexture;

  // Buffers
  public readonly uniformBuffer: GPUBuffer;
  public readonly defenseParamsBuffer: GPUBuffer;
  public updatesBuffer: GPUBuffer | null = null;
  public defensePostsBuffer: GPUBuffer | null = null;

  // Staging arrays for buffer uploads
  private updatesStaging: Uint32Array | null = null;
  private defensePostsStaging: Uint32Array | null = null;

  // Buffer capacities
  private updatesCapacity = 0;
  private defensePostsCapacity = 0;

  // State tracking
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly state: Uint16Array;
  private needsStateUpload = true;
  private needsPaletteUpload = true;
  private paletteWidth = 1;
  private defensePostsCount = 0;
  private needsDefensePostsUpload = true;

  // Uniform data arrays
  private readonly uniformData = new Float32Array(12);
  private readonly defenseParamsData = new Uint32Array(4);

  // View state (updated by renderer)
  private viewWidth = 1;
  private viewHeight = 1;
  private viewScale = 1;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
  private alternativeView = false;
  private highlightedOwnerId = -1;

  // Defense state
  private defendedEpoch = 1;
  private lastDefenseRange = -1;
  private lastDefensePostsCount = -1;

  private constructor(
    private readonly device: GPUDevice,
    private readonly game: GameView,
    private readonly theme: Theme,
    state: Uint16Array,
    mapWidth: number,
    mapHeight: number,
  ) {
    this.state = state;
    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const GPUTextureUsage = (globalThis as any).GPUTextureUsage;
    const UNIFORM = GPUBufferUsage?.UNIFORM ?? 0x40;
    const COPY_DST_BUF = GPUBufferUsage?.COPY_DST ?? 0x8;
    const COPY_DST_TEX = GPUTextureUsage?.COPY_DST ?? 0x2;
    const TEXTURE_BINDING = GPUTextureUsage?.TEXTURE_BINDING ?? 0x4;
    const STORAGE_BINDING = GPUTextureUsage?.STORAGE_BINDING ?? 0x8;

    // Render uniforms: 3x vec4f = 48 bytes
    this.uniformBuffer = device.createBuffer({
      size: 48,
      usage: UNIFORM | COPY_DST_BUF,
    });

    // Defense params: 4x u32 = 16 bytes
    this.defenseParamsBuffer = device.createBuffer({
      size: 16,
      usage: UNIFORM | COPY_DST_BUF,
    });

    // State texture (r32uint)
    this.stateTexture = device.createTexture({
      size: { width: mapWidth, height: mapHeight },
      format: "r32uint",
      usage: COPY_DST_TEX | TEXTURE_BINDING | STORAGE_BINDING,
    });

    // Defended texture (r32uint)
    this.defendedTexture = device.createTexture({
      size: { width: mapWidth, height: mapHeight },
      format: "r32uint",
      usage: TEXTURE_BINDING | STORAGE_BINDING,
    });

    // Palette texture (rgba8unorm)
    this.paletteTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: "rgba8unorm",
      usage: COPY_DST_TEX | TEXTURE_BINDING,
    });

    // Terrain texture (rgba8unorm)
    this.terrainTexture = device.createTexture({
      size: { width: mapWidth, height: mapHeight },
      format: "rgba8unorm",
      usage: COPY_DST_TEX | TEXTURE_BINDING,
    });
  }

  static create(
    device: GPUDevice,
    game: GameView,
    theme: Theme,
    state: Uint16Array,
  ): GroundTruthData {
    return new GroundTruthData(
      device,
      game,
      theme,
      state,
      game.width(),
      game.height(),
    );
  }

  // =====================
  // View state setters
  // =====================

  setViewSize(width: number, height: number): void {
    this.viewWidth = Math.max(1, Math.floor(width));
    this.viewHeight = Math.max(1, Math.floor(height));
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number): void {
    this.viewScale = scale;
    this.viewOffsetX = offsetX;
    this.viewOffsetY = offsetY;
  }

  setAlternativeView(enabled: boolean): void {
    this.alternativeView = enabled;
  }

  setHighlightedOwnerId(ownerSmallId: number | null): void {
    this.highlightedOwnerId = ownerSmallId ?? -1;
  }

  // =====================
  // Upload methods
  // =====================

  uploadState(): void {
    if (!this.needsStateUpload) {
      return;
    }
    this.needsStateUpload = false;

    // Convert 16-bit CPU state to 32-bit array
    const u32State = new Uint32Array(this.state.length);
    for (let i = 0; i < this.state.length; i++) {
      u32State[i] = this.state[i];
    }

    const bytesPerTexel = Uint32Array.BYTES_PER_ELEMENT;
    const fullBytesPerRow = this.mapWidth * bytesPerTexel;

    if (fullBytesPerRow % 256 === 0) {
      this.device.queue.writeTexture(
        { texture: this.stateTexture },
        u32State,
        { bytesPerRow: fullBytesPerRow, rowsPerImage: this.mapHeight },
        {
          width: this.mapWidth,
          height: this.mapHeight,
          depthOrArrayLayers: 1,
        },
      );
    } else {
      // Fallback: upload row-by-row with padding
      const paddedBytesPerRow = align(fullBytesPerRow, 256);
      const scratch = new Uint32Array(paddedBytesPerRow / 4);
      for (let y = 0; y < this.mapHeight; y++) {
        const start = y * this.mapWidth;
        scratch.set(u32State.subarray(start, start + this.mapWidth), 0);
        this.device.queue.writeTexture(
          { texture: this.stateTexture, origin: { x: 0, y } },
          scratch,
          { bytesPerRow: paddedBytesPerRow, rowsPerImage: 1 },
          { width: this.mapWidth, height: 1, depthOrArrayLayers: 1 },
        );
      }
    }
  }

  uploadTerrain(): void {
    const bytesPerRow = this.mapWidth * 4;
    const paddedBytesPerRow = align(bytesPerRow, 256);
    const row = new Uint8Array(paddedBytesPerRow);

    const toByte = (value: number): number =>
      Math.max(0, Math.min(255, Math.round(value)));

    for (let y = 0; y < this.mapHeight; y++) {
      row.fill(0);
      for (let x = 0; x < this.mapWidth; x++) {
        const tile = y * this.mapWidth + x;
        const rgba = this.theme.terrainColor(this.game, tile).rgba;
        const idx = x * 4;
        row[idx] = toByte(rgba.r);
        row[idx + 1] = toByte(rgba.g);
        row[idx + 2] = toByte(rgba.b);
        row[idx + 3] = 255;
      }

      this.device.queue.writeTexture(
        { texture: this.terrainTexture, origin: { x: 0, y } },
        row,
        { bytesPerRow: paddedBytesPerRow, rowsPerImage: 1 },
        { width: this.mapWidth, height: 1, depthOrArrayLayers: 1 },
      );
    }
  }

  uploadPalette(): boolean {
    if (!this.needsPaletteUpload) {
      return false;
    }
    this.needsPaletteUpload = false;

    let maxSmallId = 0;
    for (const player of this.game.playerViews()) {
      maxSmallId = Math.max(maxSmallId, player.smallID());
    }
    const nextPaletteWidth =
      GroundTruthData.PALETTE_RESERVED_SLOTS + Math.max(1, maxSmallId + 1);

    let textureRecreated = false;
    if (nextPaletteWidth !== this.paletteWidth) {
      this.paletteWidth = nextPaletteWidth;
      (this.paletteTexture as any).destroy?.();
      const GPUTextureUsage = (globalThis as any).GPUTextureUsage;
      const COPY_DST_TEX = GPUTextureUsage?.COPY_DST ?? 0x2;
      const TEXTURE_BINDING = GPUTextureUsage?.TEXTURE_BINDING ?? 0x4;
      (this as any).paletteTexture = this.device.createTexture({
        size: { width: this.paletteWidth, height: 1 },
        format: "rgba8unorm",
        usage: COPY_DST_TEX | TEXTURE_BINDING,
      });
      textureRecreated = true;
    }

    const bytes = new Uint8Array(this.paletteWidth * 4);

    // Store special colors in reserved slots (0-9)
    const falloutIdx = GroundTruthData.PALETTE_FALLOUT_INDEX * 4;
    bytes[falloutIdx] = 120;
    bytes[falloutIdx + 1] = 255;
    bytes[falloutIdx + 2] = 71;
    bytes[falloutIdx + 3] = 255;

    // Store player colors starting at index 10
    for (const player of this.game.playerViews()) {
      const id = player.smallID();
      if (id <= 0) continue;
      const rgba = player.territoryColor().rgba;
      const idx = (GroundTruthData.PALETTE_RESERVED_SLOTS + id) * 4;
      bytes[idx] = rgba.r;
      bytes[idx + 1] = rgba.g;
      bytes[idx + 2] = rgba.b;
      bytes[idx + 3] = 255;
    }

    const bytesPerRow = align(this.paletteWidth * 4, 256);
    const padded =
      bytesPerRow === this.paletteWidth * 4
        ? bytes
        : (() => {
            const tmp = new Uint8Array(bytesPerRow);
            tmp.set(bytes);
            return tmp;
          })();

    this.device.queue.writeTexture(
      { texture: this.paletteTexture },
      padded,
      { bytesPerRow, rowsPerImage: 1 },
      { width: this.paletteWidth, height: 1, depthOrArrayLayers: 1 },
    );

    return textureRecreated;
  }

  uploadDefensePosts(): void {
    if (!this.needsDefensePostsUpload) {
      return;
    }
    this.needsDefensePostsUpload = false;

    const posts = this.collectDefensePosts();
    this.defensePostsCount = posts.length;

    if (this.defensePostsCount > 0) {
      this.ensureDefensePostsBuffer(this.defensePostsCount);
    }

    if (
      this.defensePostsCount > 0 &&
      this.defensePostsStaging &&
      this.defensePostsBuffer
    ) {
      for (let i = 0; i < this.defensePostsCount; i++) {
        const p = posts[i];
        this.defensePostsStaging[i * 3] = p.x >>> 0;
        this.defensePostsStaging[i * 3 + 1] = p.y >>> 0;
        this.defensePostsStaging[i * 3 + 2] = p.ownerId >>> 0;
      }
      this.device.queue.writeBuffer(
        this.defensePostsBuffer,
        0,
        this.defensePostsStaging.subarray(0, this.defensePostsCount * 3),
      );
    }
  }

  private collectDefensePosts(): Array<{
    x: number;
    y: number;
    ownerId: number;
  }> {
    const posts: Array<{ x: number; y: number; ownerId: number }> = [];
    const units = this.game.units(UnitType.DefensePost) as any[];
    for (const u of units) {
      if (!u.isActive() || u.isUnderConstruction()) {
        continue;
      }
      const tile = u.tile();
      posts.push({
        x: this.game.x(tile),
        y: this.game.y(tile),
        ownerId: u.owner().smallID(),
      });
    }
    return posts;
  }

  private ensureDefensePostsBuffer(capacity: number): void {
    if (this.defensePostsBuffer && capacity <= this.defensePostsCapacity) {
      return;
    }

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const STORAGE = GPUBufferUsage?.STORAGE ?? 0x10;
    const COPY_DST_BUF = GPUBufferUsage?.COPY_DST ?? 0x8;

    this.defensePostsCapacity = Math.max(
      8,
      Math.pow(2, Math.ceil(Math.log2(Math.max(1, capacity)))),
    );

    const bytesPerPost = 12; // 3 * u32
    const bufferSize = this.defensePostsCapacity * bytesPerPost;

    if (this.defensePostsBuffer) {
      (this.defensePostsBuffer as any).destroy?.();
    }

    (this as any).defensePostsBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: STORAGE | COPY_DST_BUF,
    });

    this.defensePostsStaging = new Uint32Array(this.defensePostsCapacity * 3);
  }

  ensureUpdatesBuffer(capacity: number): GPUBuffer {
    if (this.updatesBuffer && capacity <= this.updatesCapacity) {
      return this.updatesBuffer;
    }

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const STORAGE = GPUBufferUsage?.STORAGE ?? 0x10;
    const COPY_DST_BUF = GPUBufferUsage?.COPY_DST ?? 0x8;

    this.updatesCapacity = Math.max(
      256,
      Math.pow(2, Math.ceil(Math.log2(capacity))),
    );
    const bufferSize = this.updatesCapacity * 8; // Each update is 8 bytes

    if (this.updatesBuffer) {
      (this.updatesBuffer as any).destroy?.();
    }

    (this as any).updatesBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: STORAGE | COPY_DST_BUF,
    });

    this.updatesStaging = new Uint32Array(this.updatesCapacity * 2);
    return this.updatesBuffer;
  }

  getUpdatesStaging(): Uint32Array {
    this.updatesStaging ??= new Uint32Array(this.updatesCapacity * 2);
    return this.updatesStaging;
  }

  // =====================
  // Uniform buffer updates
  // =====================

  writeUniformBuffer(timeSec: number): void {
    this.uniformData[0] = this.mapWidth;
    this.uniformData[1] = this.mapHeight;
    this.uniformData[2] = this.viewScale;
    this.uniformData[3] = timeSec;
    this.uniformData[4] = this.viewOffsetX;
    this.uniformData[5] = this.viewOffsetY;
    this.uniformData[6] = this.alternativeView ? 1 : 0;
    this.uniformData[7] = this.highlightedOwnerId;
    this.uniformData[8] = this.viewWidth;
    this.uniformData[9] = this.viewHeight;
    this.uniformData[10] = 0;
    this.uniformData[11] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  writeDefenseParamsBuffer(): void {
    const range = this.game.config().defensePostRange() >>> 0;
    this.defenseParamsData[0] = range;
    this.defenseParamsData[1] = this.defensePostsCount >>> 0;
    this.defenseParamsData[2] = this.defendedEpoch >>> 0;
    this.defenseParamsData[3] = 0;
    this.device.queue.writeBuffer(
      this.defenseParamsBuffer,
      0,
      this.defenseParamsData,
    );
  }

  // =====================
  // State getters/setters
  // =====================

  getDefendedEpoch(): number {
    return this.defendedEpoch;
  }

  incrementDefendedEpoch(): void {
    this.defendedEpoch = (this.defendedEpoch + 1) >>> 0;
    if (this.defendedEpoch === 0) {
      this.defendedEpoch = 1;
    }
  }

  getDefensePostsCount(): number {
    return this.defensePostsCount;
  }

  getLastDefenseRange(): number {
    return this.lastDefenseRange;
  }

  setLastDefenseRange(range: number): void {
    this.lastDefenseRange = range;
  }

  getLastDefensePostsCount(): number {
    return this.lastDefensePostsCount;
  }

  setLastDefensePostsCount(count: number): void {
    this.lastDefensePostsCount = count;
  }

  markPaletteDirty(): void {
    this.needsPaletteUpload = true;
  }

  markDefensePostsDirty(): void {
    this.needsDefensePostsUpload = true;
  }

  getState(): Uint16Array {
    return this.state;
  }

  getMapWidth(): number {
    return this.mapWidth;
  }

  getMapHeight(): number {
    return this.mapHeight;
  }

  getGame(): GameView {
    return this.game;
  }

  getTheme(): Theme {
    return this.theme;
  }
}
