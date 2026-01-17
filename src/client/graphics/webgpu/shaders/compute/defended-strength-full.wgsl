struct Params {
  _dirtyCount: u32,
  range: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var stateTex: texture_2d<u32>;
@group(0) @binding(2) var defendedStrengthTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read> ownerOffsets: array<vec2u>;
@group(0) @binding(4) var<storage, read> postsByOwner: array<vec2u>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let dims = textureDimensions(stateTex);
  if (globalId.x >= dims.x || globalId.y >= dims.y) {
    return;
  }

  let x = i32(globalId.x);
  let y = i32(globalId.y);
  let state = textureLoad(stateTex, vec2i(x, y), 0).x;
  let owner = state & 0xFFFu;

  let range = i32(p.range);
  if (owner == 0u || range <= 0) {
    textureStore(defendedStrengthTex, vec2i(x, y), vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let off = ownerOffsets[owner];
  let start = off.x;
  let count = off.y;
  if (count == 0u) {
    textureStore(defendedStrengthTex, vec2i(x, y), vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let rx = f32(range);
  let r2 = range * range;
  var bestDist2: i32 = 0x7FFFFFFF;
  var i: u32 = 0u;
  loop {
    if (i >= count) { break; }
    let pos = postsByOwner[start + i];
    let dx = i32(pos.x) - x;
    let dy = i32(pos.y) - y;
    let d2 = dx * dx + dy * dy;
    if (d2 < bestDist2) {
      bestDist2 = d2;
    }
    i = i + 1u;
  }

  if (bestDist2 > r2) {
    textureStore(defendedStrengthTex, vec2i(x, y), vec4f(0.0, 0.0, 0.0, 1.0));
    return;
  }

  let dist = sqrt(f32(bestDist2));
  let strength = clamp(1.0 - (dist / rx), 0.0, 1.0);
  textureStore(defendedStrengthTex, vec2i(x, y), vec4f(strength, 0.0, 0.0, 1.0));
}

