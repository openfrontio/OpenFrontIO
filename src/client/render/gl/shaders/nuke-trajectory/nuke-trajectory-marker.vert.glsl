#version 300 es
precision highp float;

// Unit quad [-1, +1]
layout(location = 0) in vec2 aCorner;

uniform mat3 uCamera;
uniform vec2 uP0, uP1, uP2, uP3;
uniform float uPixelSize;
uniform vec4 uMarker;           // (t, type: 0=circle 1=X, 0, 0)
uniform vec2 uMarkerRadii;     // (circleRadiusPx, xRadiusPx)

out vec2 vUV;
flat out float vType;

vec2 bezier(float t) {
  float T = 1.0 - t;
  float TT = T * T;
  float tt = t * t;
  return TT * T * uP0 + 3.0 * TT * t * uP1 + 3.0 * T * tt * uP2 + tt * t * uP3;
}

void main() {
  vType = uMarker.y;
  vUV = aCorner;

  vec2 center = bezier(uMarker.x) + 0.5;
  float radius = (vType < 0.5 ? uMarkerRadii.x : uMarkerRadii.y) * uPixelSize;
  vec2 pos = center + aCorner * radius;

  vec3 clip = uCamera * vec3(pos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
