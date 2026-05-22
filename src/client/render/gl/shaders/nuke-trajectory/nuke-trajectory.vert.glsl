#version 300 es
precision highp float;

// Per-vertex: (t along curve, side: -1 or +1, cumulative arc distance)
layout(location = 0) in vec3 aVertex;

uniform mat3 uCamera;
uniform vec2 uP0, uP1, uP2, uP3;   // Bezier control points
uniform float uPixelSize;           // world units per pixel
uniform float uQuadHalfPx;          // half-width of quad in pixels

out float vT;          // curve parameter (0..1)
out float vArcDist;    // cumulative arc distance (world units)
out float vEdgeDist;   // -1..+1 across the line width

vec2 bezier(float t) {
  float T = 1.0 - t;
  float TT = T * T;
  float tt = t * t;
  return TT * T * uP0 + 3.0 * TT * t * uP1 + 3.0 * T * tt * uP2 + tt * t * uP3;
}

vec2 bezierDeriv(float t) {
  float T = 1.0 - t;
  return 3.0 * (T * T * (uP1 - uP0) + 2.0 * T * t * (uP2 - uP1) + t * t * (uP3 - uP2));
}

void main() {
  float t = aVertex.x;
  float side = aVertex.y;

  vec2 pos = bezier(t);
  vec2 tang = bezierDeriv(t);
  float tangLen = length(tang);
  vec2 normTang = tangLen > 0.001 ? tang / tangLen : vec2(1.0, 0.0);
  vec2 perp = vec2(-normTang.y, normTang.x);

  float halfWidth = uQuadHalfPx * uPixelSize;
  pos += perp * side * halfWidth;
  pos += 0.5; // tile center offset

  vT = t;
  vEdgeDist = side;
  vArcDist = aVertex.z;

  vec3 clip = uCamera * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
