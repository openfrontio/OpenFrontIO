struct Temporal {
  nowSec: f32,
  lastTickSec: f32,
  tickDtSec: f32,
  tickDtEmaSec: f32,
  tickAlpha: f32,
  tickCount: f32,
  historyValid: f32,
  _pad0: f32,
};

struct Params {
  params0: vec4f, // x=mode, y=blendStrength, z=dissolveWidth
};

@group(0) @binding(0) var<uniform> t: Temporal;
@group(0) @binding(1) var<uniform> p: Params;
@group(0) @binding(2) var currentTex: texture_2d<f32>;
@group(0) @binding(3) var historyTex: texture_2d<f32>;

struct FragOutput {
  @location(0) color: vec4f,
  @location(1) history: vec4f,
};

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

fn hashUint(x: u32) -> u32 {
  var h = x * 1664525u + 1013904223u;
  h ^= h >> 16u;
  h *= 2246822519u;
  h ^= h >> 13u;
  h *= 3266489917u;
  h ^= h >> 16u;
  return h;
}

fn hashToUnitFloat(x: u32) -> f32 {
  return f32(x & 0x00FFFFFFu) / 16777216.0;
}

@fragment
fn fsMain(@builtin(position) pos: vec4f) -> FragOutput {
  let texCoord = vec2i(pos.xy);
  let curr = textureLoad(currentTex, texCoord, 0);
  let hist = textureLoad(historyTex, texCoord, 0);

  let mode = u32(max(0.0, p.params0.x) + 0.5);
  let strength = clamp(p.params0.y, 0.0, 1.0);
  let width = max(0.001, p.params0.z);

  var alpha = clamp(t.tickAlpha * strength, 0.0, 1.0);
  if (t.historyValid < 0.5) {
    alpha = 1.0;
  }

  if (mode == 1u) {
    let outColor = mix(hist, curr, alpha);
    return FragOutput(outColor, outColor);
  }

  if (mode == 2u) {
    let seed = (u32(texCoord.x) * 73856093u) ^ (u32(texCoord.y) * 19349663u);
    let tickSeed = u32(max(0.0, t.tickCount) + 0.5);
    let r = hashToUnitFloat(hashUint(seed ^ (tickSeed * 2654435761u)));
    let mask = smoothstep(alpha - width, alpha + width, r);
    let outColor = mix(hist, curr, mask);
    return FragOutput(outColor, outColor);
  }

  return FragOutput(curr, curr);
}
