struct TerrainParams {
  shoreColor: vec4f,        // Shore (land adjacent to water)
  waterColor: vec4f,        // Deep water base color
  shorelineWaterColor: vec4f, // Water near shore
  plainsBaseColor: vec4f,   // Plains base RGB (magnitude 0)
  highlandBaseColor: vec4f, // Highland base RGB (magnitude 10)
  mountainBaseColor: vec4f, // Mountain base RGB (magnitude 20)
};

@group(0) @binding(0) var<uniform> params: TerrainParams;
@group(0) @binding(1) var terrainDataTex: texture_2d<u32>;
@group(0) @binding(2) var terrainTex: texture_storage_2d<rgba8unorm, write>;

// Terrain bit constants (matching GameMapImpl)
const IS_LAND_BIT: u32 = 7u;
const SHORELINE_BIT: u32 = 6u;
const OCEAN_BIT: u32 = 5u;
const MAGNITUDE_MASK: u32 = 0x1fu;

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
  
  // Extract terrain bits
  let isLand = (terrainData & (1u << IS_LAND_BIT)) != 0u;
  let isShoreline = (terrainData & (1u << SHORELINE_BIT)) != 0u;
  let isOcean = (terrainData & (1u << OCEAN_BIT)) != 0u;
  let magnitude = terrainData & MAGNITUDE_MASK;
  let mag = f32(magnitude);

  var color: vec4f;

  // Check if shore (land adjacent to water)
  if (isLand && isShoreline) {
    color = params.shoreColor;
  } else if (!isLand) {
    // Water tile
    if (isShoreline) {
      color = params.shorelineWaterColor;
    } else {
      // Deep water - color varies by magnitude
      // CPU formula: waterColor - 10 + (11 - min(mag, 10))
      // In normalized space: waterColor + (-10 + (11 - min(mag, 10))) / 255.0
      // Simplified: waterColor + (1 - min(mag, 10)) / 255.0
      let magClamped = min(mag, 10.0);
      let adjustment = (1.0 - magClamped) / 255.0;
      color = vec4f(
        max(params.waterColor.r + adjustment, 0.0),
        max(params.waterColor.g + adjustment, 0.0),
        max(params.waterColor.b + adjustment, 0.0),
        1.0
      );
    }
  } else {
    // Land tile - determine terrain type from magnitude
    // CPU formulas:
    // Plains: rgb(190, 220 - 2*mag, 138) for mag 0-9
    // Highland: rgb(200 + 2*mag, 183 + 2*mag, 138 + 2*mag) for mag 10-19
    // Mountain: rgb(230 + mag/2, 230 + mag/2, 230 + mag/2) for mag >= 20
    // 
    // We sampled plains at mag 0, so plainsBaseColor = rgb(190, 220, 138) / 255
    // We sampled highland at some mag 10-19, need to compute from mag 10
    if (magnitude < 10u) {
      // Plains: rgb(190, 220 - 2*mag, 138)
      color = vec4f(
        params.plainsBaseColor.r, // 190/255
        max(params.plainsBaseColor.g - (2.0 * mag) / 255.0, 0.0), // (220 - 2*mag)/255
        params.plainsBaseColor.b, // 138/255
        1.0
      );
    } else if (magnitude < 20u) {
      // Highland: CPU formula is rgb(200 + 2*mag, 183 + 2*mag, 138 + 2*mag)
      // We sampled highlandBaseColor at mag 10, so it's rgb(220, 203, 158) / 255
      // For any mag 10-19: highlandBaseColor + 2*(mag - 10) / 255
      let highlandMag = mag - 10.0;
      color = vec4f(
        min(params.highlandBaseColor.r + (2.0 * highlandMag) / 255.0, 1.0),
        min(params.highlandBaseColor.g + (2.0 * highlandMag) / 255.0, 1.0),
        min(params.highlandBaseColor.b + (2.0 * highlandMag) / 255.0, 1.0),
        1.0
      );
    } else {
      // Mountain: CPU formula is rgb(230 + mag/2, 230 + mag/2, 230 + mag/2)
      // We sampled mountainBaseColor at mag 20, so it's rgb(240, 240, 240) / 255 for pastel
      // For any mag >= 20: mountainBaseColor + (mag - 20) / 2 / 255
      let mountainMag = mag - 20.0;
      let gray = min(params.mountainBaseColor.r + (mountainMag / 2.0) / 255.0, 1.0);
      color = vec4f(gray, gray, gray, 1.0);
    }
  }

  textureStore(terrainTex, texCoord, color);
}
