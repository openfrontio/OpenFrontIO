struct DefenseParams {
  range: u32,
  postCount: u32,
  epoch: u32,
  _pad: u32,
};

struct DefensePost {
  x: u32,
  y: u32,
  ownerId: u32,
};

@group(0) @binding(0) var<uniform> d: DefenseParams;
@group(0) @binding(1) var<storage, read> posts: array<DefensePost>;
@group(0) @binding(2) var stateTex: texture_2d<u32>;
@group(0) @binding(3) var defendedTex: texture_storage_2d<r32uint, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) globalId: vec3<u32>) {
  let postIdx = globalId.z;
  let postCount = d.postCount;
  if (postIdx >= postCount) {
    return;
  }

  let range = i32(d.range);
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
    textureStore(defendedTex, texCoord, vec4u(d.epoch, 0u, 0u, 0u));
  }
}
