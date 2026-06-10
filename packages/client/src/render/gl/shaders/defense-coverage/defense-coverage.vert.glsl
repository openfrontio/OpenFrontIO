#version 300 es
precision highp float;

// One instanced quad per defense post. The quad is a box centered on the post,
// sized to cover the post's range; the fragment shader trims it to a circle and
// filters by tile owner. See DefenseCoveragePass.

layout(location = 0) in vec2 aCorner;  // unit quad corner, [0,1]²
layout(location = 1) in vec3 aPost;     // (tileX, tileY, ownerID)

uniform vec2 uMapSize;
uniform float uRange;

flat out vec2 vPostCenter;
flat out float vOwner;

void main() {
  vPostCenter = aPost.xy;
  vOwner = aPost.z;

  // Box spanning [center - range, center + range] in tile coords, plus a
  // 1-tile margin so the boundary tiles at exactly `range` are rasterized
  // (their pixel centers sit just past the un-padded edge).
  vec2 tilePos = aPost.xy + (aCorner * 2.0 - 1.0) * (uRange + 1.0);

  // Tile-resolution FBO (viewport = map size), so map straight to clip space.
  vec2 ndc = (tilePos / uMapSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
