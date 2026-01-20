struct TerrainParams {
  shoreColor: vec4f,        // Shore (land adjacent to water)
  waterColor: vec4f,        // Deep water base color
  shorelineWaterColor: vec4f, // Water near shore
  plainsBaseColor: vec4f,   // Plains base RGB (magnitude 0)
  highlandBaseColor: vec4f, // Highland base RGB (magnitude 10)
  mountainBaseColor: vec4f, // Mountain base RGB (magnitude 20)
  tuning0: vec4f,           // x=noiseStrength, y=blendWidth, z=waterBlurStrength, w=unused
};

@group(0) @binding(0) var<uniform> params: TerrainParams;
@group(0) @binding(1) var terrainDataTex: texture_2d<u32>;
@group(0) @binding(2) var terrainTex: texture_storage_2d<rgba8unorm, write>;

// Terrain bit constants (matching GameMapImpl)
const IS_LAND_BIT: u32 = 7u;
const SHORELINE_BIT: u32 = 6u;
const MAGNITUDE_MASK: u32 = 0x1fu;

fn hash21(p: vec2u) -> f32 {
  var n = p.x * 0x9e3779b9u + p.y * 0x7f4a7c15u;
  n ^= n >> 16u;
  n *= 0x85ebca6bu;
  n ^= n >> 13u;
  n *= 0xc2b2ae35u;
  n ^= n >> 16u;
  return f32(n & 0x00ffffffu) / 16777215.0;
}

fn clampCoord(coord: vec2i, dims: vec2u) -> vec2i {
  let maxX = i32(dims.x) - 1;
  let maxY = i32(dims.y) - 1;
  return vec2i(clamp(coord.x, 0, maxX), clamp(coord.y, 0, maxY));
}

fn computeLandColor(mag: f32, noise: f32, noiseStrength: f32, blendWidth: f32) -> vec3f {
  let plainsG = max(params.plainsBaseColor.g - (2.0 * mag) / 255.0, 0.0);
  let plains = vec3f(params.plainsBaseColor.r, plainsG, params.plainsBaseColor.b);

  let highlandMag = clamp(mag - 10.0, 0.0, 9.0);
  let highland = vec3f(
    min(params.highlandBaseColor.r + (2.0 * highlandMag) / 255.0, 1.0),
    min(params.highlandBaseColor.g + (2.0 * highlandMag) / 255.0, 1.0),
    min(params.highlandBaseColor.b + (2.0 * highlandMag) / 255.0, 1.0),
  );

  let mountainMag = max(mag - 20.0, 0.0);
  let gray = min(params.mountainBaseColor.r + (mountainMag / 2.0) / 255.0, 1.0);
  let mountain = vec3f(gray, gray, gray);

  let tHigh = smoothstep(10.0 - blendWidth, 10.0 + blendWidth, mag);
  let tMount = smoothstep(20.0 - blendWidth, 20.0 + blendWidth, mag);
  var land = mix(plains, highland, tHigh);
  land = mix(land, mountain, tMount);

  let noiseBias = (noise - 0.5) * noiseStrength;
  return clamp(land + vec3f(noiseBias), vec3f(0.0), vec3f(1.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let x = i32(globalId.x);
  let y = i32(globalId.y);
  let dims = textureDimensions(terrainDataTex);

  if (x < 0 || y < 0 || u32(x) >= dims.x || u32(y) >= dims.y) {
    return;
  }

  let texCoord = vec2i(x, y);
  let terrainData = textureLoad(terrainDataTex, texCoord, 0).x;

  let isLand = (terrainData & (1u << IS_LAND_BIT)) != 0u;
  let isShoreline = (terrainData & (1u << SHORELINE_BIT)) != 0u;
  let magnitude = terrainData & MAGNITUDE_MASK;
  let mag = f32(magnitude);

  let noise = hash21(vec2u(texCoord));
  let noiseStrength = max(params.tuning0.x, 0.0);
  let blendWidth = max(params.tuning0.y, 0.1);
  let waterDepthBlur = clamp(params.tuning0.z, 0.0, 1.0);
  let shoreMixLand = 0.6;
  var color: vec4f;

  if (isLand) {
    var land = computeLandColor(mag, noise, noiseStrength, blendWidth);
    if (isShoreline) {
      land = mix(land, params.shoreColor.rgb, shoreMixLand);
    }
    color = vec4f(land, 1.0);
  } else {
    if (isShoreline) {
      color = vec4f(params.shorelineWaterColor.rgb, 1.0);
      textureStore(terrainTex, texCoord, color);
      return;
    }

    var sum = mag;
    var count = 1.0;
    let dataL = textureLoad(terrainDataTex, clampCoord(texCoord + vec2i(-1, 0), dims), 0).x;
    if ((dataL & (1u << IS_LAND_BIT)) == 0u) {
      sum = sum + f32(dataL & MAGNITUDE_MASK);
      count = count + 1.0;
    }
    let dataR = textureLoad(terrainDataTex, clampCoord(texCoord + vec2i(1, 0), dims), 0).x;
    if ((dataR & (1u << IS_LAND_BIT)) == 0u) {
      sum = sum + f32(dataR & MAGNITUDE_MASK);
      count = count + 1.0;
    }
    let dataD = textureLoad(terrainDataTex, clampCoord(texCoord + vec2i(0, -1), dims), 0).x;
    if ((dataD & (1u << IS_LAND_BIT)) == 0u) {
      sum = sum + f32(dataD & MAGNITUDE_MASK);
      count = count + 1.0;
    }
    let dataU = textureLoad(terrainDataTex, clampCoord(texCoord + vec2i(0, 1), dims), 0).x;
    if ((dataU & (1u << IS_LAND_BIT)) == 0u) {
      sum = sum + f32(dataU & MAGNITUDE_MASK);
      count = count + 1.0;
    }

    let avgMag = sum / count;
    let smoothMag = mix(mag, avgMag, waterDepthBlur);
    let magClamped = min(smoothMag, 10.0);
    let adjustment = (1.0 - magClamped) / 255.0;
    let water = vec3f(
      max(params.waterColor.r + adjustment, 0.0),
      max(params.waterColor.g + adjustment, 0.0),
      max(params.waterColor.b + adjustment, 0.0),
    );
    color = vec4f(water, 1.0);
  }

  textureStore(terrainTex, texCoord, color);
}
