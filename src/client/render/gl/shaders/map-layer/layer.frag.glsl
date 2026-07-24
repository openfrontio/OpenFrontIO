#version 300 es
precision highp float;
precision highp usampler2D;

// Layer RGBA texture (PNG with transparency).
uniform sampler2D uLayerTex;

// Raw terrain bytes (R8UI): bit 7 = isLand.
uniform usampler2D uTerrainBytes;

// Per-tile destroyed mask (R8UI): 0 = intact, 1 = destroyed.
// Only sampled when uNukeable > 0.
uniform usampler2D uDestroyedMask;

// 0 = land layer (visible only on land tiles), 1 = water layer.
uniform int uPlacement;

// 0 = permanent, 1 = destroyed in nuke blast radius.
uniform int uNukeable;

// 0.0 = hidden (user toggle), 1.0 = visible.
uniform float uVisible;

in vec2 vUV;
out vec4 fragColor;

void main() {
  // User toggle.
  if (uVisible < 0.5) discard;

  ivec2 tc = ivec2(
    int(vUV.x * float(MAP_W)),
    int(vUV.y * float(MAP_H))
  );
  tc = clamp(tc, ivec2(0), ivec2(MAP_W - 1, MAP_H - 1));

  // Land/water placement check: bit 7 of terrain byte = isLand.
  uint terrainByte = texelFetch(uTerrainBytes, tc, 0).r;
  bool isLand = (terrainByte & 0x80u) != 0u;

  if (uPlacement == 0 && !isLand) discard;  // land layer on water tile
  if (uPlacement == 1 && isLand) discard;   // water layer on land tile

  // Nukeable: skip destroyed tiles.
  if (uNukeable == 1) {
    uint destroyed = texelFetch(uDestroyedMask, tc, 0).r;
    if (destroyed > 0u) discard;
  }

  // Sample layer texture.
  vec4 layer = texture(uLayerTex, vUV);
  if (layer.a < 0.01) discard;

  fragColor = layer;
}
