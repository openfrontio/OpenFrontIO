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
  params0: vec4f, // x=mode, y=curveExp
  params1: vec4f, // x=updateCount
};

struct Update {
  tileIndex: u32,
  newState: u32,
};

@group(0) @binding(0) var<uniform> t: Temporal;
@group(0) @binding(1) var<uniform> p: Params;
@group(0) @binding(2) var<storage, read> updates: array<Update>;
@group(0) @binding(3) var visualStateTex: texture_storage_2d<r32uint, write>;

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

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let idx = globalId.x;
  let updateCount = u32(max(0.0, p.params1.x) + 0.5);
  if (idx >= updateCount) {
    return;
  }

  let mode = u32(max(0.0, p.params0.x) + 0.5);
  let curveExp = max(0.001, p.params0.y);
  let alpha = clamp(pow(clamp(t.tickAlpha, 0.0, 1.0), curveExp), 0.0, 1.0);

  let update = updates[idx];

  if (mode == 1u) {
    let tickSeed = u32(max(0.0, t.tickCount) + 0.5);
    let h = hashUint(update.tileIndex ^ (tickSeed * 2654435761u));
    let r = hashToUnitFloat(h);
    if (r > alpha) {
      return;
    }
  } else if (mode == 2u) {
    let targetCount = u32(floor(f32(updateCount) * alpha));
    if (idx >= targetCount) {
      return;
    }
  } else {
    return;
  }

  let dims = textureDimensions(visualStateTex);
  let mapWidth = dims.x;
  let x = i32(update.tileIndex % mapWidth);
  let y = i32(update.tileIndex / mapWidth);
  textureStore(visualStateTex, vec2i(x, y), vec4u(update.newState, 0u, 0u, 0u));
}
