#version 300 es
precision highp float;
precision highp int;

layout(location = 0) in vec2 aPos; // unit quad [0,0]→[1,1]

uniform sampler2D uPlayerData;
uniform mat3  uCamera;
uniform float uTime;
uniform float uLerpSpeed;
uniform float uCullThreshold;
uniform float uFontSize;
uniform float uFontBase;
uniform float uNameScaleFactor;
uniform float uNameScaleCap;

// Flag layout (for computing flag box)
uniform float uFlagCellW;
uniform float uFlagCellH;

out vec2 vUV;
flat out int vBoxType; // 0=name, 1=flag, 2=center
flat out vec4 vColor;

void main() {
  // 3 debug boxes per player: 0=name, 1=flag, 2=center crosshair
  int playerIdx = gl_InstanceID / 3;
  int boxType   = gl_InstanceID - playerIdx * 3;

  vec4 pd0 = texelFetch(uPlayerData, ivec2(0, playerIdx), 0);
  vec4 pd1 = texelFetch(uPlayerData, ivec2(1, playerIdx), 0);
  vec4 pd3 = texelFetch(uPlayerData, ivec2(3, playerIdx), 0);
  vec4 pd4 = texelFetch(uPlayerData, ivec2(4, playerIdx), 0);

  // Skip dead players
  if (pd1.w <= 0.0) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vBoxType = -1;
    vColor = vec4(0.0);
    return;
  }

  // Lerped world position (same as name.vert.glsl)
  float elapsed = uTime - pd0.w;
  float t = clamp(1.0 - exp(-uLerpSpeed * elapsed), 0.0, 1.0);
  float wx = mix(pd0.x, pd1.x, t);
  float wy = mix(pd0.y, pd1.y, t);
  float ws = mix(pd0.z, pd1.z, t);

  // Sizing pipeline (must match name.vert.glsl exactly)
  float baseSize      = max(1.0, floor(ws));
  float nameSize      = max(4.0, floor(baseSize * uNameScaleFactor));
  float nameScale     = min(baseSize * 0.25, uNameScaleCap);
  float nameWorldScale = (nameSize * nameScale) / uFontSize;

  // Zoom-based culling
  float cameraScale = length(vec2(uCamera[0][0], uCamera[1][0]));
  float screenSize  = nameWorldScale * uFontBase * cameraScale;
  if (screenSize < uCullThreshold) {
    gl_Position = vec4(0.0);
    vUV = vec2(0.0);
    vBoxType = -1;
    vColor = vec4(0.0);
    return;
  }

  float nameHalfWidth = pd3.w;

  vec2 boxMin, boxMax;

  if (boxType == 0) {
    // Name text bounding box (green)
    float halfW = nameHalfWidth * nameWorldScale;
    float halfH = uFontBase * nameWorldScale * 0.5;
    boxMin = vec2(wx - halfW, wy - halfH);
    boxMax = vec2(wx + halfW, wy + halfH);
    vColor = vec4(0.0, 1.0, 0.0, 0.9);
  } else if (boxType == 1) {
    // Flag bounding box (yellow)
    float flagIdx = pd4.x;
    if (flagIdx < 0.0) {
      gl_Position = vec4(0.0);
      vUV = vec2(0.0);
      vBoxType = -1;
      vColor = vec4(0.0);
      return;
    }
    float halfW = nameHalfWidth * nameWorldScale;
    float flagWorldH = uFontBase * nameWorldScale * 1.2;
    float flagWorldW = flagWorldH * (uFlagCellW / uFlagCellH);
    boxMin = vec2(wx - halfW - flagWorldW, wy - flagWorldH * 0.5);
    boxMax = vec2(wx - halfW, wy + flagWorldH * 0.5);
    vColor = vec4(1.0, 1.0, 0.0, 0.9);
  } else {
    // Center crosshair (cyan) — fixed world size proportional to name
    float arm = uFontBase * nameWorldScale * 0.3;
    boxMin = vec2(wx - arm, wy - arm);
    boxMax = vec2(wx + arm, wy + arm);
    vColor = vec4(0.0, 1.0, 1.0, 1.0);
  }

  vUV = aPos;
  vBoxType = boxType;
  vec2 worldPos = mix(boxMin, boxMax, aPos);
  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
