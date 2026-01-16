struct Uniforms {
  mapResolution_viewScale_time: vec4f, // x=mapW, y=mapH, z=viewScale, w=timeSec
  viewOffset_alt_highlight: vec4f,     // x=offX, y=offY, z=alternativeView, w=highlightOwnerId
  viewSize_pad: vec4f,                // x=viewW, y=viewH, z/w unused
};

struct DefenseParams {
  range: u32,
  postCount: u32,
  epoch: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<uniform> d: DefenseParams;
@group(0) @binding(2) var stateTex: texture_2d<u32>;
@group(0) @binding(3) var defendedTex: texture_2d<u32>;
@group(0) @binding(4) var paletteTex: texture_2d<f32>;
@group(0) @binding(5) var terrainTex: texture_2d<f32>;

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

@fragment
fn fsMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let mapRes = u.mapResolution_viewScale_time.xy;
  let viewScale = u.mapResolution_viewScale_time.z;
  let timeSec = u.mapResolution_viewScale_time.w;
  let viewOffset = u.viewOffset_alt_highlight.xy;
  let altView = u.viewOffset_alt_highlight.z;
  let highlightId = u.viewOffset_alt_highlight.w;
  let viewSize = u.viewSize_pad.xy;

  // WebGPU fragment position is top-left origin and at pixel centers (0.5, 1.5, ...).
  let viewCoord = vec2f(pos.x - 0.5, pos.y - 0.5);
  let mapHalf = mapRes * 0.5;
  // Match TransformHandler.screenToWorldCoordinates formula:
  // gameX = (canvasX - game.width() / 2) / scale + offsetX + game.width() / 2
  let mapCoord = (viewCoord - mapHalf) / viewScale + viewOffset + mapHalf;

  if (mapCoord.x < 0.0 || mapCoord.y < 0.0 || mapCoord.x >= mapRes.x || mapCoord.y >= mapRes.y) {
    discard;
  }

  let texCoord = vec2i(mapCoord);
  let state = textureLoad(stateTex, texCoord, 0).x;
  let owner = state & 0xFFFu;
  let hasFallout = (state & 0x2000u) != 0u;

  let terrain = textureLoad(terrainTex, texCoord, 0);
  var outColor = terrain;
  if (owner != 0u) {
    // Player colors start at index 10
    let c = textureLoad(paletteTex, vec2i(i32(owner) + 10, 0), 0);
    let defended = textureLoad(defendedTex, texCoord, 0).x == d.epoch;
    var territoryRgb = c.rgb;
    if (defended) {
      territoryRgb = mix(territoryRgb, vec3f(1.0, 0.0, 1.0), 0.35);
    }
    if (hasFallout) {
      // Fallout color is at index 0
      let falloutColor = textureLoad(paletteTex, vec2i(0, 0), 0).rgb;
      territoryRgb = mix(territoryRgb, falloutColor, 0.5);
    }
    outColor = vec4f(mix(terrain.rgb, territoryRgb, 0.65), 1.0);
  } else if (hasFallout) {
    // Fallout color is at index 0
    let falloutColor = textureLoad(paletteTex, vec2i(0, 0), 0).rgb;
    outColor = vec4f(mix(terrain.rgb, falloutColor, 0.5), 1.0);
  }

  // Apply alternative view (hide territory by showing terrain only)
  if (altView > 0.5 && owner != 0u) {
    outColor = terrain;
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
