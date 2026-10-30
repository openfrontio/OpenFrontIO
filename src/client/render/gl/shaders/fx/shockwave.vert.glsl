#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aInstData; // x, y, radius, alpha
layout(location = 2) in float aStyle;   // 0 = classic ring, 1 = EMP pulse, 2 = sparkles
layout(location = 3) in vec3 aColor0;   // EMP: palette color 0
layout(location = 4) in vec3 aColor1;   // EMP: palette color 1
layout(location = 5) in vec3 aColor2;   // EMP: palette color 2
layout(location = 6) in vec3 aColor3;   // EMP: palette color 3
layout(location = 7) in float aColorCount; // active palette size (1..4)
layout(location = 8) in float aSpeed;   // animation-speed multiplier
layout(location = 9) in float aTransSpeed; // palette step rate (colors/s)
layout(location = 10) in float aThickness; // EMP: ring band thickness (world tiles)
layout(location = 11) in float aCell;   // sparkles: grid pitch (front-normalized)

uniform mat3 uCamera;
uniform float uTime;

out vec2  vLocalPos;
flat out float vAlpha;
flat out float vLife;
flat out float vStyle;
flat out vec3  vColor0;
flat out vec3  vColor1;
flat out vec3  vColor2;
flat out vec3  vColor3;
flat out float vColorCount;
flat out float vSpeed;
flat out float vTransSpeed;
flat out float vThickness;
flat out float vCell;
flat out float vRadius;  // current ring radius (world tiles) — converts
                         // absolute thickness into local ring units

// --- cheap 1D value noise -------------------------------------------------
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}

// Extra margin so the ring's outer feathering isn't clipped at the quad edge.
const float MARGIN = 1.1; // 10% beyond ring radius

void main() {
  vec2 center = vec2(aInstData.x + 0.5, aInstData.y + 0.5);
  float r = aInstData.z;
  vAlpha = aInstData.w;
  float tt = uTime * aSpeed;
  float flicker = (aStyle > 0.5 && aStyle < 1.5) ? (0.75 + 0.25 * vnoise(tt * 30.0)) : 1.0;
  vLife = aInstData.w * flicker;
  vStyle = aStyle;
  vColor0 = aColor0;
  vColor1 = aColor1;
  vColor2 = aColor2;
  vColor3 = aColor3;
  vColorCount = aColorCount;
  vSpeed = aSpeed;
  vTransSpeed = aTransSpeed;
  vThickness = aThickness;
  vCell = aCell;
  vRadius = r;

  // Quad extent: ring radius plus the full band thickness. The band is
  // absolute (world tiles), so while the ring is young it can be wider than
  // the radius itself — a pure percentage margin would clip it into a box.
  // aThickness is 0 for the classic style, giving the original r * MARGIN.
  float extent = (r + aThickness) * MARGIN;
  vec2 worldPos = center + (aPos - 0.5) * 2.0 * extent;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  // vLocalPos stays normalized to the ring radius (dist 1.0 = radius r), so
  // scale by extent/r instead of the fixed margin.
  vLocalPos = (aPos - 0.5) * 2.0 * (extent / max(r, 0.001));
}
