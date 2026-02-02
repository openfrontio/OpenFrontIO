import { Theme } from "../../../core/configuration/Config";
import { UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, UnitView } from "../../../core/game/GameView";
import { createCanvas } from "../../Utils";

export interface TerritoryWebGLCreateResult {
  renderer: TerritoryWebGLRenderer | null;
  reason?: string;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

// Minimal territory renderer backed by WebGPU.
// Note: Name kept to minimize diff against the previous WebGL implementation.
export class TerritoryWebGLRenderer {
  public readonly canvas: HTMLCanvasElement;

  private readonly mapWidth: number;
  private readonly mapHeight: number;
  private readonly clearR: number;
  private readonly clearG: number;
  private readonly clearB: number;
  private viewWidth = 1;
  private viewHeight = 1;
  private viewScale = 1;
  private viewOffsetX = 0;
  private viewOffsetY = 0;
  private alternativeView = false;
  private highlightedOwnerId = -1;

  private readonly state: Uint16Array;
  // Track tiles that need to be updated on the GPU. Use a Set to avoid duplicates.
  private readonly pendingTiles: Set<number> = new Set();
  private needsFullRebuild = true;
  private needsPaletteUpload = true;
  // When using a GPU-authoritative state, the CPU does not upload state
  // textures after initialization. Keep this flag for initial upload only.
  private needsStateUpload = true;
  private paletteWidth = 1;

  // Render uniform layout (48 bytes):
  //   [0..3] mapResolution_viewScale
  //   [4..7] viewOffset
  //   [8..11] defenseParams (x=defensePostRange, y=defensePostsCount)
  private readonly uniformData = new Float32Array(12);

  // Compute uniform layout (16 bytes):
  //   [0..3] defenseParams (x=defensePostRange, y=defensePostsCount, z/w unused)
  private readonly computeUniformData = new Float32Array(4);

  private readonly computeParams = new Uint32Array(4);

  private stateBuffer: any | null = null;
  private computeParamsBuffer: any | null = null;
  private updatesBuffer: any | null = null;
  private updatesCapacity = 0;
  private updatesStaging: Uint32Array | null = null;

  // Defended tiles resources
  private defendedTex: any | null = null;
  private defensePostsBuffer: any | null = null;
  private defensePostsStaging: Uint32Array | null = null;
  private defensePostsCount = 0;
  private needsDefensePostsUpload = true;
  private defensePostsCapacity = 0;

  // Bind group layout and bind group for scatter (state update) compute pass
  private computeBindGroupLayoutScatter: any | null = null;
  private scatterBindGroup: any | null = null;
  // Compute pipelines for scatter/state update
  private computePipelineScatterState: any | null = null;

  // Clear defended texture pass
  private clearDefendedBindGroupLayout: any | null = null;
  private clearDefendedBindGroup: any | null = null;
  private computePipelineClearDefended: any | null = null;

  // Update defended texture pass
  private updateDefendedBindGroupLayout: any | null = null;
  private updateDefendedBindGroup: any | null = null;
  private computePipelineUpdateDefended: any | null = null;

  // WebGPU objects are intentionally typed as `any` to avoid requiring WebGPU
  // TypeScript libs in this repo.
  private device: any | null = null;
  private context: any | null = null;
  private canvasFormat: any | null = null;
  private pipeline: any | null = null;
  private bindGroupLayout: any | null = null;
  private bindGroup: any | null = null;
  private uniformBuffer: any | null = null; // For render shader (48 bytes)
  private computeUniformBuffer: any | null = null; // For compute shader (16 bytes, only defenseParams)
  private stateTexture: any | null = null;
  private terrainTexture: any | null = null;
  private paletteTexture: any | null = null;

  private initPromise: Promise<void> | null = null;
  private ready = false;

  private constructor(
    private readonly game: GameView,
    private readonly theme: Theme,
    state: Uint16Array,
  ) {
    this.canvas = createCanvas();
    this.canvas.style.pointerEvents = "none";
    this.mapWidth = game.width();
    this.mapHeight = game.height();
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.state = state;

    const bg = this.theme.backgroundColor().rgba;
    this.clearR = bg.r / 255;
    this.clearG = bg.g / 255;
    this.clearB = bg.b / 255;
  }

  static create(game: GameView, theme: Theme): TerritoryWebGLCreateResult {
    const state = game.tileStateView();
    const expected = game.width() * game.height();
    if (state.length !== expected) {
      return {
        renderer: null,
        reason: "Tile state buffer size mismatch; GPU renderer disabled.",
      };
    }

    const nav = globalThis.navigator as any;
    if (!nav?.gpu || typeof nav.gpu.requestAdapter !== "function") {
      return {
        renderer: null,
        reason: "WebGPU not available; GPU renderer disabled.",
      };
    }

    const renderer = new TerritoryWebGLRenderer(game, theme, state);
    renderer.startInit();
    return { renderer };
  }

  private startInit() {
    if (this.initPromise) return;
    this.initPromise = this.init();
  }

  private async init() {
    const nav = globalThis.navigator as any;
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return;
    }

    const device = await adapter.requestDevice();
    this.device = device;

    const context = this.canvas.getContext("webgpu");
    if (!context) {
      return;
    }
    this.context = context;

    this.canvasFormat =
      typeof nav.gpu.getPreferredCanvasFormat === "function"
        ? nav.gpu.getPreferredCanvasFormat()
        : "bgra8unorm";

    this.configureContext();
    this.createGpuResources();
    this.ready = true;
  }

  private configureContext() {
    if (!this.context || !this.device || !this.canvasFormat) return;
    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "opaque",
    });
  }

  private createGpuResources() {
    if (!this.device) return;

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const GPUTextureUsage = (globalThis as any).GPUTextureUsage;
    const UNIFORM = GPUBufferUsage?.UNIFORM ?? 0x40;
    //   const STORAGE = GPUBufferUsage?.STORAGE ?? 0x10;
    const COPY_DST_BUF = GPUBufferUsage?.COPY_DST ?? 0x8;
    const COPY_DST_TEX = GPUTextureUsage?.COPY_DST ?? 0x2;
    const TEXTURE_BINDING = GPUTextureUsage?.TEXTURE_BINDING ?? 0x4;
    const STORAGE_BINDING = GPUTextureUsage?.STORAGE_BINDING ?? 0x8;

    // Render uniform buffer: 3x vec4f = 48 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 48,
      usage: UNIFORM | COPY_DST_BUF,
    });

    // Compute uniform buffer: 1x vec4f = 16 bytes (only defenseParams)
    this.computeUniformBuffer = this.device.createBuffer({
      size: 16,
      usage: UNIFORM | COPY_DST_BUF,
    });

    // Create the state texture as a 32-bit unsigned integer texture. It
    // includes STORAGE_BINDING so it can be written in a compute shader and
    // TEXTURE_BINDING so it can be read in the fragment and compute shaders.
    this.stateTexture = this.device.createTexture({
      size: { width: this.mapWidth, height: this.mapHeight },
      format: "r32uint",
      usage: COPY_DST_TEX | TEXTURE_BINDING | STORAGE_BINDING,
    });

    // Defended tiles texture (uint 0/1). Using r32uint for broad WebGPU support.
    this.defendedTex = this.device.createTexture({
      size: { width: this.mapWidth, height: this.mapHeight },
      format: "r32uint",
      usage: TEXTURE_BINDING | STORAGE_BINDING,
    });

    this.paletteTexture = this.device.createTexture({
      size: { width: 1, height: 1 },
      format: "rgba8unorm",
      usage: COPY_DST_TEX | TEXTURE_BINDING,
    });

    this.terrainTexture = this.device.createTexture({
      size: { width: this.mapWidth, height: this.mapHeight },
      format: "rgba8unorm",
      usage: COPY_DST_TEX | TEXTURE_BINDING,
    });
    this.uploadTerrainTexture();

    const shader = this.device.createShaderModule({
      code: `
struct Uniforms {
  mapResolution_viewScale: vec4f, // x=mapW, y=mapH, z=viewScale, w=timeSec
  viewOffset: vec4f,              // x=offX, y=offY, z=alternativeView, w=highlightOwnerId
  defenseParams: vec4f,           // x=defensePostRange, y=defensePostsCount, z/w unused
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var stateTex: texture_2d<u32>;
@group(0) @binding(2) var defendedTex: texture_2d<u32>;
@group(0) @binding(3) var paletteTex: texture_2d<f32>;
@group(0) @binding(4) var terrainTex: texture_2d<f32>;

@vertex
fn vsMain(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let p = pos[vi];
  return vec4f(p, 0.0, 1.0);
}

fn composeBaseColor(texCoord: vec2i, owner: u32) -> vec4f {
  let terrain = textureLoad(terrainTex, texCoord, 0);
  if (owner == 0u) {
    return terrain;
  }

  let c = textureLoad(paletteTex, vec2i(i32(owner), 0), 0);
  let defended = textureLoad(defendedTex, texCoord, 0).x != 0u;
  var territoryRgb = c.rgb;
  if (defended) {
    territoryRgb = mix(territoryRgb, vec3f(1.0, 0.0, 1.0), 0.35);
  }

  return vec4f(mix(terrain.rgb, territoryRgb, 0.65), 1.0);
}

@fragment
fn fsMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let mapRes = u.mapResolution_viewScale.xy;
  let viewScale = u.mapResolution_viewScale.z;
  let timeSec = u.mapResolution_viewScale.w;
  let viewOffset = u.viewOffset.xy;
  let altView = u.viewOffset.z;
  let highlightId = u.viewOffset.w;

  // WebGPU fragment position is top-left origin and at pixel centers (0.5, 1.5, ...).
  let viewCoord = vec2f(pos.x - 0.5, pos.y - 0.5);
  let mapHalf = mapRes * 0.5;
  let mapCoord = (viewCoord - mapHalf) / viewScale + viewOffset + mapHalf;

  if (mapCoord.x < 0.0 || mapCoord.y < 0.0 || mapCoord.x >= mapRes.x || mapCoord.y >= mapRes.y) {
    discard;
  }

  let texCoord = vec2i(mapCoord);
  let state = textureLoad(stateTex, texCoord, 0).x;
  let owner = state & 0xFFFu;

  var outColor = composeBaseColor(texCoord, owner);

  // Apply alternative view (hide territory by showing terrain only)
  if (altView > 0.5 && owner != 0u) {
    outColor = textureLoad(terrainTex, texCoord, 0);
  }

  // Apply hover highlight if needed
  if (highlightId > 0.5) {
    let alpha = select(0.65, 0.0, altView > 0.5);

    if (alpha > 0.0 && owner != 0u && abs(f32(owner) - highlightId) < 0.5) {
      let pulse = 0.5 + 0.5 * sin(timeSec * 6.2831853);
      let strength = 0.15 + 0.15 * pulse;
      let highlightedRgb = mix(outColor.rgb, vec3f(1.0, 1.0, 1.0), strength);
      outColor = vec4f(highlightedRgb, outColor.a);
    }
  }

  return outColor;
}
`,
    });
    this.bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 2 /* FRAGMENT */,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "uint" },
        },
        {
          binding: 2,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "uint" },
        },
        {
          binding: 3,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "float" },
        },
        {
          binding: 4,
          visibility: 2 /* FRAGMENT */,
          texture: { sampleType: "float" },
        },
      ],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module: shader, entryPoint: "vsMain" },
      fragment: {
        module: shader,
        entryPoint: "fsMain",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });

    // =====================
    // Compute shaders
    // =====================

    // Compute pass 1: Scatter state updates into the state texture. Writes the
    // newState value into the state texture at the specified tile index.
    const computeShaderScatter = this.device.createShaderModule({
      code: `
struct Update {
  tileIndex: u32,
  newState: u32,
};

@group(0) @binding(0) var<storage, read> updates: array<Update>;
@group(0) @binding(1) var stateTex: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  if (idx >= arrayLength(&updates)) {
    return;
  }
  let update = updates[idx];
  let dims = textureDimensions(stateTex);
  let mapWidth = dims.x;
  let x = i32(update.tileIndex % mapWidth);
  let y = i32(update.tileIndex / mapWidth);
  textureStore(stateTex, vec2i(x, y), vec4u(update.newState, 0u, 0u, 0u));
}
`,
    });

    // Compute pass 2: Clear defended texture (set all texels to 0).
    const computeShaderClearDefended = this.device.createShaderModule({
      code: `
@group(0) @binding(0) var defendedTex: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let dims = textureDimensions(defendedTex);
  let x = i32(globalId.x);
  let y = i32(globalId.y);
  if (x < 0 || y < 0 || u32(x) >= dims.x || u32(y) >= dims.y) {
    return;
  }
  textureStore(defendedTex, vec2i(x, y), vec4u(0u, 0u, 0u, 0u));
}
`,
    });

    // Compute pass 3: Update defended texture from defense posts.
    const computeShaderUpdateDefended = this.device.createShaderModule({
      code: `
struct ComputeUniforms {
  defenseParams: vec4f, // x=range, y=postCount, z/w unused
};

struct DefensePost {
  x: u32,
  y: u32,
  ownerId: u32,
};

@group(0) @binding(0) var<uniform> u: ComputeUniforms;
@group(0) @binding(1) var<storage, read> posts: array<DefensePost>;
@group(0) @binding(2) var stateTex: texture_2d<u32>;
@group(0) @binding(3) var defendedTex: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let postIdx = globalId.z;
  let postCount = u32(u.defenseParams.y);
  if (postIdx >= postCount) {
    return;
  }

  let range = i32(u.defenseParams.x);
  if (range < 0) {
    return;
  }

  let dx = i32(globalId.x) - range;
  let dy = i32(globalId.y) - range;
  if (dx * dx + dy * dy > range * range) {
    return;
  }

  let post = posts[postIdx];
  let x = i32(post.x) + dx;
  let y = i32(post.y) + dy;

  let dims = textureDimensions(stateTex);
  if (x < 0 || y < 0 || u32(x) >= dims.x || u32(y) >= dims.y) {
    return;
  }

  let texCoord = vec2i(x, y);
  let state = textureLoad(stateTex, texCoord, 0).x;
  let owner = state & 0xFFFu;
  if (owner == post.ownerId) {
    textureStore(defendedTex, texCoord, vec4u(1u, 0u, 0u, 0u));
  }
}
`,
    });

    // =====================
    // Bind group layouts
    // =====================

    // Bind group layout for scatter pass: updates buffer and state texture (write-only)
    this.computeBindGroupLayoutScatter = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "r32uint" },
        },
      ],
    });

    // Bind group layout for clear defended pass
    this.clearDefendedBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "r32uint" },
        },
      ],
    });

    // Bind group layout for update defended pass
    this.updateDefendedBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: 4 /* COMPUTE */,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: 4 /* COMPUTE */,
          texture: { sampleType: "uint" },
        },
        {
          binding: 3,
          visibility: 4 /* COMPUTE */,
          storageTexture: { format: "r32uint" },
        },
      ],
    });

    // =====================
    // Compute pipelines
    // =====================

    this.computePipelineScatterState = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.computeBindGroupLayoutScatter],
      }),
      compute: {
        module: computeShaderScatter,
        entryPoint: "main",
      },
    });

    this.computePipelineClearDefended = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.clearDefendedBindGroupLayout],
      }),
      compute: {
        module: computeShaderClearDefended,
        entryPoint: "main",
      },
    });

    this.computePipelineUpdateDefended = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.updateDefendedBindGroupLayout],
      }),
      compute: {
        module: computeShaderUpdateDefended,
        entryPoint: "main",
      },
    });

    // Create the bind groups for fragment rendering and compute passes
    this.rebuildBindGroup();
    this.rebuildScatterBindGroup();
    this.rebuildClearDefendedBindGroup();
    // updateDefendedBindGroup is created after the defense posts buffer exists.
  }

  private rebuildBindGroup() {
    if (
      !this.device ||
      !this.bindGroupLayout ||
      !this.uniformBuffer ||
      !this.stateTexture ||
      !this.defendedTex ||
      !this.paletteTexture ||
      !this.terrainTexture
    ) {
      return;
    }
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.stateTexture.createView() },
        { binding: 2, resource: this.defendedTex.createView() },
        { binding: 3, resource: this.paletteTexture.createView() },
        { binding: 4, resource: this.terrainTexture.createView() },
      ],
    });
  }

  private rebuildScatterBindGroup() {
    // Create the bind group for the scatter compute pass. It binds the
    // updates buffer and the state texture as a storage texture.
    if (
      !this.device ||
      !this.computeBindGroupLayoutScatter ||
      !this.updatesBuffer ||
      !this.stateTexture
    ) {
      return;
    }
    this.scatterBindGroup = this.device.createBindGroup({
      layout: this.computeBindGroupLayoutScatter,
      entries: [
        { binding: 0, resource: { buffer: this.updatesBuffer } },
        { binding: 1, resource: this.stateTexture.createView() },
      ],
    });
  }

  private rebuildClearDefendedBindGroup() {
    if (
      !this.device ||
      !this.clearDefendedBindGroupLayout ||
      !this.defendedTex
    ) {
      return;
    }
    this.clearDefendedBindGroup = this.device.createBindGroup({
      layout: this.clearDefendedBindGroupLayout,
      entries: [{ binding: 0, resource: this.defendedTex.createView() }],
    });
  }

  private rebuildUpdateDefendedBindGroup() {
    if (
      !this.device ||
      !this.updateDefendedBindGroupLayout ||
      !this.computeUniformBuffer ||
      !this.defensePostsBuffer ||
      !this.stateTexture ||
      !this.defendedTex ||
      this.defensePostsCount <= 0
    ) {
      this.updateDefendedBindGroup = null;
      return;
    }

    this.updateDefendedBindGroup = this.device.createBindGroup({
      layout: this.updateDefendedBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.computeUniformBuffer } },
        { binding: 1, resource: { buffer: this.defensePostsBuffer } },
        { binding: 2, resource: this.stateTexture.createView() },
        { binding: 3, resource: this.defendedTex.createView() },
      ],
    });
  }

  public markDefensePostsDirty() {
    this.needsDefensePostsUpload = true;
    this.needsFullRebuild = true;
  }

  setAlternativeView(enabled: boolean) {
    this.alternativeView = enabled;
  }

  setHighlightedOwnerId(ownerSmallId: number | null) {
    this.highlightedOwnerId = ownerSmallId ?? -1;
  }

  setViewSize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (nextWidth === this.viewWidth && nextHeight === this.viewHeight) {
      return;
    }
    this.viewWidth = nextWidth;
    this.viewHeight = nextHeight;
    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    this.configureContext();
  }

  setViewTransform(scale: number, offsetX: number, offsetY: number) {
    this.viewScale = scale;
    this.viewOffsetX = offsetX;
    this.viewOffsetY = offsetY;
  }

  markTile(tile: TileRef) {
    // Always add the tile to the set of pending updates. Even if a full
    // rebuild is pending we still need to update the GPU state texture for
    // this tile so any derived textures (e.g. defended tiles) use the correct state.
    this.pendingTiles.add(tile);
    // No need to mark stateTexture for upload; the GPU owns the state
    // texture. Updates will be scattered via compute in tick().
  }

  markAllDirty() {
    this.needsFullRebuild = true;
    // Do not clear pending updates. A full rebuild will still require any
    // outstanding state updates to be applied first so that any derived
    // textures (e.g. defended tiles) are computed from the latest state.
  }

  refreshPalette() {
    this.needsPaletteUpload = true;
  }

  private ensureUpdatesBuffer(capacity: number) {
    if (this.updatesBuffer && capacity <= this.updatesCapacity) {
      return;
    }

    const GPUBufferUsage = (globalThis as any).GPUBufferUsage;
    const STORAGE = GPUBufferUsage?.STORAGE ?? 0x10;
    const COPY_DST_BUF = GPUBufferUsage?.COPY_DST ?? 0x8;

    // Round up to next power of 2 for capacity
    this.updatesCapacity = Math.max(
      256,
      Math.pow(2, Math.ceil(Math.log2(capacity))),
    );
    const bufferSize = this.updatesCapacity * 8; // Each update is 8 bytes (u32 tileIndex + u32 newState)

    if (this.updatesBuffer) {
      this.updatesBuffer.destroy?.();
    }

    this.updatesBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: STORAGE | COPY_DST_BUF,
    });

    this.updatesStaging = new Uint32Array(this.updatesCapacity * 2);
    // Rebuild the scatter bind group because the buffer has changed
    this.rebuildScatterBindGroup();
  }

  private ensureDefensePostsBuffer(capacity: number) {
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
      this.defensePostsBuffer.destroy?.();
    }

    this.defensePostsBuffer = this.device.createBuffer({
      size: bufferSize,
      usage: STORAGE | COPY_DST_BUF,
    });

    this.defensePostsStaging = new Uint32Array(this.defensePostsCapacity * 3);

    // Buffer changed -> rebuild bind group
    this.rebuildUpdateDefendedBindGroup();
  }

  private collectDefensePosts(): Array<{
    x: number;
    y: number;
    ownerId: number;
  }> {
    const posts: Array<{ x: number; y: number; ownerId: number }> = [];
    const units = this.game.units(UnitType.DefensePost) as UnitView[];
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

  private uploadDefensePostsIfNeeded() {
    if (!this.device || !this.needsDefensePostsUpload) {
      return;
    }

    const posts = this.collectDefensePosts();
    this.defensePostsCount = posts.length;

    // Reallocate buffer if needed
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

    // Rebuild bind group because defensePostsCount may have changed.
    this.rebuildUpdateDefendedBindGroup();

    this.needsDefensePostsUpload = false;
  }

  private uploadStateTextureIfNeeded() {
    if (!this.device || !this.stateTexture || !this.needsStateUpload) {
      return;
    }
    this.needsStateUpload = false;

    // When the state texture is 32-bit, convert the 16-bit CPU state
    // to a 32-bit array before uploading. Store the 16-bit value in the
    // lower 16 bits and zero the upper 16 bits. This provides enough
    // space for additional flags.
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
      // Fallback: upload row-by-row with padding.
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

  private uploadPaletteIfNeeded() {
    if (!this.device || !this.paletteTexture || !this.needsPaletteUpload) {
      return;
    }
    this.needsPaletteUpload = false;

    let maxSmallId = 0;
    for (const player of this.game.playerViews()) {
      maxSmallId = Math.max(maxSmallId, player.smallID());
    }
    const nextPaletteWidth = Math.max(1, maxSmallId + 1);

    if (nextPaletteWidth !== this.paletteWidth) {
      this.paletteWidth = nextPaletteWidth;
      this.paletteTexture.destroy?.();
      const GPUTextureUsage = (globalThis as any).GPUTextureUsage;
      const COPY_DST_TEX = GPUTextureUsage?.COPY_DST ?? 0x2;
      const TEXTURE_BINDING = GPUTextureUsage?.TEXTURE_BINDING ?? 0x4;
      this.paletteTexture = this.device.createTexture({
        size: { width: this.paletteWidth, height: 1 },
        format: "rgba8unorm",
        usage: COPY_DST_TEX | TEXTURE_BINDING,
      });
      this.rebuildBindGroup();
    }

    const bytes = new Uint8Array(this.paletteWidth * 4);
    // ownerId 0 stays transparent.
    for (const player of this.game.playerViews()) {
      const id = player.smallID();
      if (id <= 0 || id >= this.paletteWidth) continue;
      const rgba = player.territoryColor().rgba;
      const idx = id * 4;
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
  }

  private uploadTerrainTexture() {
    if (!this.device || !this.terrainTexture) {
      return;
    }

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

  /**
   * Write compute uniform buffer. Only contains defenseParams which is
   * the only uniform data the compute shader needs.
   */
  private writeComputeUniformBuffer() {
    if (!this.computeUniformBuffer || !this.device) {
      return;
    }

    const range = this.game.config().defensePostRange();
    this.computeUniformData[0] = range;
    this.computeUniformData[1] = this.defensePostsCount;
    this.computeUniformData[2] = 0;
    this.computeUniformData[3] = 0;

    this.device.queue.writeBuffer(
      this.computeUniformBuffer,
      0,
      this.computeUniformData,
    );
  }

  /**
   * Update the common uniform fields for render (map dimensions and defense params).
   */
  private updateRenderUniformFields() {
    const range = this.game.config().defensePostRange();
    this.uniformData[0] = this.mapWidth;
    this.uniformData[1] = this.mapHeight;
    this.uniformData[8] = range;
    this.uniformData[9] = this.defensePostsCount;
    this.uniformData[10] = 0;
    this.uniformData[11] = 0;
  }

  /**
   * Update the view transform fields used only by rendering.
   */
  private updateViewTransformFields(timeSec: number) {
    this.uniformData[2] = this.viewScale;
    this.uniformData[3] = timeSec;
    this.uniformData[4] = this.viewOffsetX;
    this.uniformData[5] = this.viewOffsetY;
    this.uniformData[6] = this.alternativeView ? 1 : 0;
    this.uniformData[7] = this.highlightedOwnerId;
  }

  /**
   * Write uniform buffer for rendering. Updates all values including
   * view transform which is used by the fragment shader.
   */
  private writeUniformBuffer(timeSec: number) {
    if (!this.uniformBuffer || !this.device) {
      return;
    }

    this.updateRenderUniformFields();
    this.updateViewTransformFields(timeSec);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  /**
   * Perform one simulation tick. This uploads any staged palette changes, any
   * pending tile updates, and dispatches compute passes to update the state
   * texture and defended texture. Compute work
   * only runs when necessary.
   */
  public tick() {
    if (!this.ready || !this.device) {
      return;
    }

    // Upload palette if needed. Rendering uses the palette texture directly.
    this.uploadPaletteIfNeeded();

    // Upload defense posts buffer if needed.
    this.uploadDefensePostsIfNeeded();

    // If the state texture has not yet been uploaded (initial upload), do so now.
    // This will convert the CPU's 16-bit state array into a 32-bit texture.
    this.uploadStateTextureIfNeeded();

    // Determine how many updates need to be processed
    const numUpdates = this.pendingTiles.size;

    // Early-out if no compute work is needed
    if (numUpdates === 0 && !this.needsFullRebuild) {
      return;
    }

    // Update compute uniform buffer (only defense params needed).
    this.writeComputeUniformBuffer();

    const encoder = this.device.createCommandEncoder();

    // 1) Clear defended texture
    if (
      this.computePipelineClearDefended &&
      this.clearDefendedBindGroup &&
      this.defendedTex
    ) {
      const clearPass = encoder.beginComputePass();
      clearPass.setPipeline(this.computePipelineClearDefended);
      clearPass.setBindGroup(0, this.clearDefendedBindGroup);
      const workgroupCountX = Math.ceil(this.mapWidth / 8);
      const workgroupCountY = Math.ceil(this.mapHeight / 8);
      clearPass.dispatchWorkgroups(workgroupCountX, workgroupCountY);
      clearPass.end();
    }

    // 2) Scatter state updates
    if (numUpdates > 0) {
      this.ensureUpdatesBuffer(numUpdates);
      if (this.updatesStaging && this.updatesBuffer) {
        let idx = 0;
        for (const tile of this.pendingTiles) {
          const stateValue = this.state[tile];
          this.updatesStaging[idx * 2] = tile;
          this.updatesStaging[idx * 2 + 1] = stateValue;
          idx++;
        }
        this.device.queue.writeBuffer(
          this.updatesBuffer,
          0,
          this.updatesStaging.subarray(0, numUpdates * 2),
        );
        // Rebuild scatter bind group in case the buffer changed
        this.rebuildScatterBindGroup();
        if (this.scatterBindGroup && this.computePipelineScatterState) {
          const scatterPass = encoder.beginComputePass();
          scatterPass.setPipeline(this.computePipelineScatterState);
          scatterPass.setBindGroup(0, this.scatterBindGroup);
          scatterPass.dispatchWorkgroups(numUpdates);
          scatterPass.end();
        }
        // Clear pending tiles on CPU side
        this.pendingTiles.clear();
      }
    }

    // 3) Update defended texture
    if (
      this.defensePostsCount > 0 &&
      this.computePipelineUpdateDefended &&
      this.updateDefendedBindGroup
    ) {
      const range = this.game.config().defensePostRange();
      const gridSize = 2 * range + 1;
      const workgroupCount = Math.ceil(gridSize / 8);

      const defendedPass = encoder.beginComputePass();
      defendedPass.setPipeline(this.computePipelineUpdateDefended);
      defendedPass.setBindGroup(0, this.updateDefendedBindGroup);
      defendedPass.dispatchWorkgroups(
        workgroupCount,
        workgroupCount,
        this.defensePostsCount,
      );
      defendedPass.end();
    }
    // No full-map colour rebuild here: rendering composes colours at view resolution.

    this.needsFullRebuild = false;

    this.device.queue.submit([encoder.finish()]);
  }

  render() {
    if (
      !this.ready ||
      !this.device ||
      !this.context ||
      !this.pipeline ||
      !this.bindGroup
    ) {
      return;
    }

    // Update uniforms
    this.writeUniformBuffer(performance.now() / 1000);

    // Encode render pass. No compute work is scheduled here; all compute happens in tick().
    const encoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: this.clearR, g: this.clearG, b: this.clearB, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
