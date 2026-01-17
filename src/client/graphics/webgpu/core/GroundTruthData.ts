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
  private static readonly MAX_OWNER_SLOTS = 0x1000; // ownerId is 12 bits

  // Textures
  public readonly stateTexture: GPUTexture;
  public readonly terrainTexture: GPUTexture;
  public readonly terrainDataTexture: GPUTexture;
  public readonly paletteTexture: GPUTexture;
  public readonly defendedStrengthTexture: GPUTexture;

  // Buffers
  public readonly uniformBuffer: GPUBuffer;
  public readonly terrainParamsBuffer: GPUBuffer;
  public readonly stateUpdateParamsBuffer: GPUBuffer;
  public readonly defendedStrengthParamsBuffer: GPUBuffer;
  public updatesBuffer: GPUBuffer | null = null;
  public readonly defenseOwnerOffsetsBuffer: GPUBuffer;
  public defensePostsByOwnerBuffer: GPUBuffer;
  public defendedDirtyTilesBuffer: GPUBuffer;

  // Staging arrays for buffer uploads
  private updatesStaging: Uint32Array | null = null;
  private defenseOwnerOffsetsStaging: Uint32Array;
  private defensePostsByOwnerStaging: Uint32Array | null = null;
  private defendedDirtyTilesStaging: Uint32Array | null = null;

  // Buffer capacities
  private updatesCapacity = 0;
  private defensePostsByOwnerCapacity = 0;
  private defendedDirtyTilesCapacity = 0;

  // State tracking
  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly state: Uint16Array;
  private readonly terrainData: Uint8Array;
  private needsStateUpload = true;
  private needsPaletteUpload = true;
  private needsTerrainDataUpload = true;
  private needsTerrainParamsUpload = true;
  private paletteWidth = 1;
  private needsDefensePostsUpload = true;
  private defensePostsTotalCount = 0;
  private defendedDirtyTilesCount = 0;
  private needsFullDefendedStrengthRecompute = false;
  private lastDefensePostKeys = new Set<string>();
  private defenseCircleRange = -1;
  private defenseCircleOffsets: Int16Array = new Int16Array(0); // [dx0, dy0, dx1, dy1, ...]

  // Uniform data arrays
  private readonly uniformData = new Float32Array(12);
  private readonly terrainParamsData = new Float32Array(24); // 6 vec4f: shore, water, shorelineWater, plainsBase, highlandBase, mountainBase
  private readonly stateUpdateParamsData = new Uint32Array(4); // updateCount, range, pad, pad
  private readonly defendedStrengthParamsData = new Uint32Array(4); // dirtyCount, range, pad, pad

  // View state (updated by renderer)
  private viewWidth = 1;
  private viewHeight = 1;
  private viewScale = 1;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
  private alternativeView = false;
  private highlightedOwnerId = -1;

  private constructor(
    private readonly device: GPUDevice,
    private readonly game: GameView,
    private readonly theme: Theme,
    state: Uint16Array,
    terrainData: Uint8Array,
    mapWidth: number,
    mapHeight: number,
  ) {
    this.state = state;
    this.terrainData = terrainData;
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

    // State update params: 4x u32 = 16 bytes
    this.stateUpdateParamsBuffer = device.createBuffer({
      size: 16,
      usage: UNIFORM | COPY_DST_BUF,
    });

    // Defended strength params: 4x u32 = 16 bytes
    this.defendedStrengthParamsBuffer = device.createBuffer({
      size: 16,
      usage: UNIFORM | COPY_DST_BUF,
    });

    // Terrain params: 6x vec4f = 96 bytes (shore, water, shorelineWater, plainsBase, highlandBase, mountainBase)
    this.terrainParamsBuffer = device.createBuffer({
      size: 96,
      usage: UNIFORM | COPY_DST_BUF,
    });

    // State texture (r32uint)
    this.stateTexture = device.createTexture({
      size: { width: mapWidth, height: mapHeight },
      format: "r32uint",
      usage: COPY_DST_TEX | TEXTURE_BINDING | STORAGE_BINDING,
    });

    // Defended strength texture (rgba8unorm, r channel used)
    this.defendedStrengthTexture = device.createTexture({
      size: { width: mapWidth, height: mapHeight },
      format: "rgba8unorm",
      usage: TEXTURE_BINDING | STORAGE_BINDING,
    });

    // Palette texture (rgba8unorm)
    this.paletteTexture = device.createTexture({
      size: { width: 1, height: 1 },
      format: "rgba8unorm",
      usage: COPY_DST_TEX | TEXTURE_BINDING,
    });

    // Terrain texture (rgba8unorm) - output of terrain compute shader
    this.terrainTexture = device.createTexture({
      size: { width: mapWidth, height: mapHeight },
      format: "rgba8unorm",
      usage: COPY_DST_TEX | TEXTURE_BINDING | STORAGE_BINDING,
    });

    // Terrain data texture (r8uint) - input terrain data (read-only in compute shader)
    this.terrainDataTexture = device.createTexture({
      size: { width: mapWidth, height: mapHeight },
      format: "r8uint",
      usage: COPY_DST_TEX | TEXTURE_BINDING,
    });

    const STORAGE = GPUBufferUsage?.STORAGE ?? 0x10;

    // Defense posts data: ownerOffsets[ownerId] = {start, count}, postsByOwner[start..] = {x,y}
    this.defenseOwnerOffsetsBuffer = device.createBuffer({
      size: GroundTruthData.MAX_OWNER_SLOTS * 8,
      usage: STORAGE | COPY_DST_BUF,
    });
    this.defenseOwnerOffsetsStaging = new Uint32Array(
      GroundTruthData.MAX_OWNER_SLOTS * 2,
    );

    this.defensePostsByOwnerBuffer = device.createBuffer({
      size: 8,
      usage: STORAGE | COPY_DST_BUF,
    });

    // Dirty tile indices to recompute defended strength when posts change
    this.defendedDirtyTilesBuffer = device.createBuffer({
      size: 4 * 8,
      usage: STORAGE | COPY_DST_BUF,
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
      game.terrainDataView(),
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

  /**
   * @deprecated Use terrain compute shader instead. This method is kept for fallback.
   */
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

  uploadTerrainData(): void {
    if (!this.needsTerrainDataUpload) {
      return;
    }
    this.needsTerrainDataUpload = false;

    const bytesPerRow = this.mapWidth;
    const paddedBytesPerRow = align(bytesPerRow, 256);

    if (paddedBytesPerRow === bytesPerRow) {
      // Direct upload if already aligned
      this.device.queue.writeTexture(
        { texture: this.terrainDataTexture },
        this.terrainData,
        { bytesPerRow, rowsPerImage: this.mapHeight },
        {
          width: this.mapWidth,
          height: this.mapHeight,
          depthOrArrayLayers: 1,
        },
      );
    } else {
      // Row-by-row upload with padding
      const row = new Uint8Array(paddedBytesPerRow);
      for (let y = 0; y < this.mapHeight; y++) {
        row.fill(0);
        const start = y * this.mapWidth;
        row.set(this.terrainData.subarray(start, start + this.mapWidth), 0);
        this.device.queue.writeTexture(
          { texture: this.terrainDataTexture, origin: { x: 0, y } },
          row,
          { bytesPerRow: paddedBytesPerRow, rowsPerImage: 1 },
          { width: this.mapWidth, height: 1, depthOrArrayLayers: 1 },
        );
      }
    }
  }

  uploadTerrainParams(): void {
    if (!this.needsTerrainParamsUpload) {
      return;
    }
    this.needsTerrainParamsUpload = false;

    // Extract theme colors directly from theme object (much faster than sampling tiles)
    const themeAny = this.theme as any;
    const isDark = themeAny.darkShore !== undefined;

    // Get shore color
    const shore = isDark ? themeAny.darkShore : themeAny.shore;
    const shoreColor = shore?.rgba ?? { r: 204, g: 203, b: 158, a: 255 };

    // Get water colors
    const water = isDark ? themeAny.darkWater : themeAny.water;
    const waterColor = water?.rgba ?? { r: 70, g: 132, b: 180, a: 255 };

    const shorelineWater = isDark
      ? themeAny.darkShorelineWater
      : themeAny.shorelineWater;
    const shorelineWaterColor = shorelineWater?.rgba ?? {
      r: 100,
      g: 143,
      b: 255,
      a: 255,
    };

    // Compute terrain base colors from formulas (no tile sampling needed)
    // Plains at mag 0: rgb(190, 220, 138) for pastel, rgb(140, 170, 88) for dark
    const plainsColor = isDark
      ? { r: 140, g: 170, b: 88, a: 255 }
      : { r: 190, g: 220, b: 138, a: 255 };

    // Highland at mag 10: rgb(220, 203, 158) for pastel, rgb(170, 153, 108) for dark
    const highlandColor = isDark
      ? { r: 170, g: 153, b: 108, a: 255 }
      : { r: 220, g: 203, b: 158, a: 255 };

    // Mountain at mag 20: rgb(240, 240, 240) for pastel, rgb(190, 190, 190) for dark
    const mountainColor = isDark
      ? { r: 190, g: 190, b: 190, a: 255 }
      : { r: 240, g: 240, b: 240, a: 255 };

    // Store colors as vec4f (RGBA normalized to 0-1)
    // Index 0-3: shore color
    this.terrainParamsData[0] = shoreColor.r / 255;
    this.terrainParamsData[1] = shoreColor.g / 255;
    this.terrainParamsData[2] = shoreColor.b / 255;
    this.terrainParamsData[3] = 1.0;

    // Index 4-7: water base color
    this.terrainParamsData[4] = waterColor.r / 255;
    this.terrainParamsData[5] = waterColor.g / 255;
    this.terrainParamsData[6] = waterColor.b / 255;
    this.terrainParamsData[7] = 1.0;

    // Index 8-11: shoreline water color
    this.terrainParamsData[8] = shorelineWaterColor.r / 255;
    this.terrainParamsData[9] = shorelineWaterColor.g / 255;
    this.terrainParamsData[10] = shorelineWaterColor.b / 255;
    this.terrainParamsData[11] = 1.0;

    // Index 12-15: plains base color (magnitude 0)
    this.terrainParamsData[12] = plainsColor.r / 255;
    this.terrainParamsData[13] = plainsColor.g / 255;
    this.terrainParamsData[14] = plainsColor.b / 255;
    this.terrainParamsData[15] = 1.0;

    // Index 16-19: highland base color (magnitude 10)
    this.terrainParamsData[16] = highlandColor.r / 255;
    this.terrainParamsData[17] = highlandColor.g / 255;
    this.terrainParamsData[18] = highlandColor.b / 255;
    this.terrainParamsData[19] = 1.0;

    // Index 20-23: mountain base color (magnitude 20)
    this.terrainParamsData[20] = mountainColor.r / 255;
    this.terrainParamsData[21] = mountainColor.g / 255;
    this.terrainParamsData[22] = mountainColor.b / 255;
    this.terrainParamsData[23] = 1.0;

    this.device.queue.writeBuffer(
      this.terrainParamsBuffer,
      0,
      this.terrainParamsData,
    );
  }

  markTerrainParamsDirty(): void {
    this.needsTerrainParamsUpload = true;
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

    const range = this.game.config().defensePostRange();
    const posts = this.collectDefensePosts();
    this.defensePostsTotalCount = posts.length;

    // Diff posts to produce dirty tiles for recompute (include removed + added).
    const nextKeys = new Set<string>();
    for (const p of posts) {
      nextKeys.add(`${p.ownerId},${p.x},${p.y}`);
    }

    const changedPosts: Array<{ x: number; y: number }> = [];
    for (const key of this.lastDefensePostKeys) {
      if (!nextKeys.has(key)) {
        const [ownerStr, xStr, yStr] = key.split(",");
        void ownerStr;
        changedPosts.push({ x: Number(xStr), y: Number(yStr) });
      }
    }
    for (const key of nextKeys) {
      if (!this.lastDefensePostKeys.has(key)) {
        const [ownerStr, xStr, yStr] = key.split(",");
        void ownerStr;
        changedPosts.push({ x: Number(xStr), y: Number(yStr) });
      }
    }
    this.lastDefensePostKeys = nextKeys;

    // Pack posts by owner into GPU buffers.
    this.packDefensePostsByOwner(posts);

    // Build dirty tiles around changed posts (so removals clear too).
    this.buildDefendedDirtyTiles(changedPosts, range);
  }

  getDefensePostsTotalCount(): number {
    return this.defensePostsTotalCount;
  }

  getDefendedDirtyTilesCount(): number {
    return this.defendedDirtyTilesCount;
  }

  needsDefendedFullRecompute(): boolean {
    return this.needsFullDefendedStrengthRecompute;
  }

  clearDefendedFullRecompute(): void {
    this.needsFullDefendedStrengthRecompute = false;
  }

  clearDefendedDirtyTiles(): void {
    this.defendedDirtyTilesCount = 0;
  }

  writeStateUpdateParamsBuffer(updateCount: number): void {
    this.stateUpdateParamsData[0] = updateCount >>> 0;
    this.stateUpdateParamsData[1] = this.game.config().defensePostRange() >>> 0;
    this.stateUpdateParamsData[2] = 0;
    this.stateUpdateParamsData[3] = 0;
    this.device.queue.writeBuffer(
      this.stateUpdateParamsBuffer,
      0,
      this.stateUpdateParamsData,
    );
  }

  writeDefendedStrengthParamsBuffer(dirtyCount: number): void {
    this.defendedStrengthParamsData[0] = dirtyCount >>> 0;
    this.defendedStrengthParamsData[1] =
      this.game.config().defensePostRange() >>> 0;
    this.defendedStrengthParamsData[2] = 0;
    this.defendedStrengthParamsData[3] = 0;
    this.device.queue.writeBuffer(
      this.defendedStrengthParamsBuffer,
      0,
      this.defendedStrengthParamsData,
    );
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

  private ensureDefensePostsByOwnerBuffer(capacityPosts: number): void {
    if (
      this.defensePostsByOwnerBuffer &&
      capacityPosts <= this.defensePostsByOwnerCapacity
    ) {
      return;
    }

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const STORAGE = GPUBufferUsage?.STORAGE ?? 0x10;
    const COPY_DST_BUF = GPUBufferUsage?.COPY_DST ?? 0x8;

    this.defensePostsByOwnerCapacity = Math.max(
      8,
      Math.pow(2, Math.ceil(Math.log2(Math.max(1, capacityPosts)))),
    );

    const bytesPerPost = 8; // 2 * u32 (x,y)
    const bufferSize = this.defensePostsByOwnerCapacity * bytesPerPost;

    (this.defensePostsByOwnerBuffer as any).destroy?.();
    this.defensePostsByOwnerBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: STORAGE | COPY_DST_BUF,
    });

    this.defensePostsByOwnerStaging = new Uint32Array(
      this.defensePostsByOwnerCapacity * 2,
    );
  }

  private ensureDefendedDirtyTilesBuffer(capacityTiles: number): void {
    if (
      this.defendedDirtyTilesBuffer &&
      capacityTiles <= this.defendedDirtyTilesCapacity
    ) {
      return;
    }

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const STORAGE = GPUBufferUsage?.STORAGE ?? 0x10;
    const COPY_DST_BUF = GPUBufferUsage?.COPY_DST ?? 0x8;

    this.defendedDirtyTilesCapacity = Math.max(
      256,
      Math.pow(2, Math.ceil(Math.log2(Math.max(1, capacityTiles)))),
    );

    const bufferSize = this.defendedDirtyTilesCapacity * 4; // u32 per tile

    (this.defendedDirtyTilesBuffer as any).destroy?.();
    this.defendedDirtyTilesBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: STORAGE | COPY_DST_BUF,
    });

    this.defendedDirtyTilesStaging = new Uint32Array(
      this.defendedDirtyTilesCapacity,
    );
  }

  private packDefensePostsByOwner(
    posts: Array<{ x: number; y: number; ownerId: number }>,
  ): void {
    // Reset counts
    this.defenseOwnerOffsetsStaging.fill(0);
    const counts = new Uint32Array(GroundTruthData.MAX_OWNER_SLOTS);
    for (const p of posts) {
      const owner = p.ownerId >>> 0;
      if (owner === 0 || owner >= GroundTruthData.MAX_OWNER_SLOTS) continue;
      counts[owner]++;
    }

    // Prefix sums into offsets (start,count) pairs.
    let running = 0;
    for (let owner = 0; owner < GroundTruthData.MAX_OWNER_SLOTS; owner++) {
      const count = counts[owner];
      this.defenseOwnerOffsetsStaging[owner * 2] = running;
      this.defenseOwnerOffsetsStaging[owner * 2 + 1] = count;
      running += count;
    }

    this.ensureDefensePostsByOwnerBuffer(running);
    if (!this.defensePostsByOwnerStaging) {
      throw new Error("defensePostsByOwnerStaging not allocated");
    }

    const writeCursor = new Uint32Array(GroundTruthData.MAX_OWNER_SLOTS);
    for (let owner = 0; owner < GroundTruthData.MAX_OWNER_SLOTS; owner++) {
      writeCursor[owner] = this.defenseOwnerOffsetsStaging[owner * 2];
    }

    for (const p of posts) {
      const owner = p.ownerId >>> 0;
      if (owner === 0 || owner >= GroundTruthData.MAX_OWNER_SLOTS) continue;
      const idx = writeCursor[owner]++;
      this.defensePostsByOwnerStaging[idx * 2] = p.x >>> 0;
      this.defensePostsByOwnerStaging[idx * 2 + 1] = p.y >>> 0;
    }

    this.device.queue.writeBuffer(
      this.defenseOwnerOffsetsBuffer,
      0,
      this.defenseOwnerOffsetsStaging,
    );
    if (running > 0) {
      this.device.queue.writeBuffer(
        this.defensePostsByOwnerBuffer,
        0,
        this.defensePostsByOwnerStaging.subarray(0, running * 2),
      );
    }
  }

  private ensureDefenseCircleOffsets(range: number): void {
    if (range === this.defenseCircleRange) {
      return;
    }
    this.defenseCircleRange = range;
    if (range <= 0) {
      this.defenseCircleOffsets = new Int16Array(0);
      return;
    }

    const offsets: number[] = [];
    const r2 = range * range;
    for (let dy = -range; dy <= range; dy++) {
      for (let dx = -range; dx <= range; dx++) {
        if (dx * dx + dy * dy <= r2) {
          offsets.push(dx, dy);
        }
      }
    }
    this.defenseCircleOffsets = new Int16Array(offsets);
  }

  private buildDefendedDirtyTiles(
    changedPosts: Array<{ x: number; y: number }>,
    range: number,
  ): void {
    if (changedPosts.length === 0) {
      this.defendedDirtyTilesCount = 0;
      this.needsFullDefendedStrengthRecompute = false;
      return;
    }

    this.ensureDefenseCircleOffsets(range);
    const offsets = this.defenseCircleOffsets;
    const offsetsCount = offsets.length / 2;
    if (offsetsCount === 0) {
      this.defendedDirtyTilesCount = 0;
      this.needsFullDefendedStrengthRecompute = false;
      return;
    }

    const worstCase = changedPosts.length * offsetsCount;
    const mapTiles = this.mapWidth * this.mapHeight;
    if (worstCase > mapTiles) {
      this.defendedDirtyTilesCount = 0;
      this.needsFullDefendedStrengthRecompute = true;
      return;
    }

    this.needsFullDefendedStrengthRecompute = false;
    this.ensureDefendedDirtyTilesBuffer(worstCase);
    if (!this.defendedDirtyTilesStaging) {
      throw new Error("defendedDirtyTilesStaging not allocated");
    }

    let cursor = 0;
    for (const post of changedPosts) {
      for (let i = 0; i < offsets.length; i += 2) {
        const x = post.x + offsets[i];
        const y = post.y + offsets[i + 1];
        if (x < 0 || y < 0 || x >= this.mapWidth || y >= this.mapHeight) {
          continue;
        }
        this.defendedDirtyTilesStaging[cursor++] =
          (y * this.mapWidth + x) >>> 0;
      }
    }

    this.defendedDirtyTilesCount = cursor;
    this.device.queue.writeBuffer(
      this.defendedDirtyTilesBuffer,
      0,
      this.defendedDirtyTilesStaging.subarray(0, cursor),
    );
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

    const buffer = this.device.createBuffer({
      size: bufferSize,
      usage: STORAGE | COPY_DST_BUF,
    });
    (this as any).updatesBuffer = buffer;

    this.updatesStaging = new Uint32Array(this.updatesCapacity * 2);
    return buffer;
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

  // =====================
  // State getters/setters
  // =====================

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
