#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos; // [0,1] quad

uniform vec2 uAnchor;     // anchor in device pixels
uniform float uOuterR;    // outer radius in device pixels
uniform float uInnerR;    // inner radius as fraction of outerR [0,1]
uniform vec2 uViewport;   // drawingBuffer width, height
uniform int uSegCount;    // number of segments
uniform float uIconHalf;  // icon half-size in device pixels
uniform float uEmojiIndices[8]; // atlas index per segment (-1 = none)
uniform float uCenterEmojiIdx;  // atlas index for center icon (-1 = none)
uniform float uSegOpacity[8];   // per-segment opacity (0..1)

out vec2 vUV;
flat out float vAtlasIdx;
flat out float vOpacity;

const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;

void main() {
  int segIdx = gl_InstanceID;

  // Center icon: last instance (index == uSegCount)
  if (segIdx == uSegCount) {
    vAtlasIdx = uCenterEmojiIdx;
    vOpacity = 1.0; // center icon always full opacity
    if (vAtlasIdx < 0.0) {
      gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
      vUV = vec2(0.0);
      return;
    }
    // Position at anchor center — always upright
    vec2 local = aPos * 2.0 - 1.0;
    vec2 pos = uAnchor + local * uIconHalf;
    gl_Position = vec4(
      pos.x / uViewport.x * 2.0 - 1.0,
      1.0 - pos.y / uViewport.y * 2.0,
      0.0, 1.0
    );
    vUV = aPos;
    return;
  }

  vAtlasIdx = uEmojiIndices[segIdx];
  vOpacity = uSegOpacity[segIdx];

  if (vAtlasIdx < 0.0 || segIdx >= uSegCount) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    vUV = vec2(0.0);
    return;
  }

  // Arc center position — rotated so first segment is centered at top
  float segArc = TWO_PI / float(uSegCount);
  float offset = PI / float(uSegCount);
  float angle = (float(segIdx) + 0.5) * segArc - offset;
  float midR = (uInnerR + 1.0) * 0.5 * uOuterR;
  vec2 center = uAnchor + vec2(sin(angle), -cos(angle)) * midR;

  // Quad corners — always axis-aligned (upright icons)
  vec2 local = aPos * 2.0 - 1.0;
  vec2 pos = center + local * uIconHalf;

  gl_Position = vec4(
    pos.x / uViewport.x * 2.0 - 1.0,
    1.0 - pos.y / uViewport.y * 2.0,
    0.0, 1.0
  );

  vUV = aPos;
}
