#version 300 es
precision highp float;
precision highp int;

// Per-patch tile coord (integer in [0, mapW) × [0, mapH))
layout(location = 0) in vec2 aPos;

uniform vec2 uMapSize;

void main() {
  // Position the point at the center of the target pixel so a 1×1 point
  // rasterizes into exactly that texel. Same trick as TileScatterPass.
  vec2 ndc = ((aPos + 0.5) / uMapSize) * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = 1.0;
}
