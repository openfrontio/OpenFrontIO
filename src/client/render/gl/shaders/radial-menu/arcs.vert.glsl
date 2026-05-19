#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos; // [0,1] quad

uniform vec2 uAnchor;    // anchor in device pixels
uniform float uOuterR;   // outer radius in device pixels
uniform vec2 uViewport;  // drawingBuffer width, height

out vec2 vLocal; // [-1, +1] square pixel-space

void main() {
  vLocal = aPos * 2.0 - 1.0;

  // Expand quad to [-outerR, +outerR] in device pixels around anchor
  vec2 pos = uAnchor + vLocal * uOuterR;

  // Device pixels → NDC
  gl_Position = vec4(
    pos.x / uViewport.x * 2.0 - 1.0,
    1.0 - pos.y / uViewport.y * 2.0,
    0.0, 1.0
  );
}
