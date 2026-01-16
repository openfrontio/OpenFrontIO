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
