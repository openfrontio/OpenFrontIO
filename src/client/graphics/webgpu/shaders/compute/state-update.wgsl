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
