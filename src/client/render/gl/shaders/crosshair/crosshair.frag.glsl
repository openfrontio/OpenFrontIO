#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1]

uniform vec3 uColor;

out vec4 fragColor;

const float LINE_HALF_W = 0.08; // line half-width (normalized to quad)
const float GAP = 0.15;         // center gap radius (normalized)
const float AA = 0.02;          // anti-alias width

void main() {
  float ax = abs(vLocal.x);
  float ay = abs(vLocal.y);

  // Horizontal arm: |y| < lineWidth, |x| > gap
  float hMask = smoothstep(LINE_HALF_W + AA, LINE_HALF_W - AA, ay)
              * smoothstep(GAP - AA, GAP + AA, ax)
              * (1.0 - smoothstep(1.0 - AA, 1.0, ax));

  // Vertical arm: |x| < lineWidth, |y| > gap
  float vMask = smoothstep(LINE_HALF_W + AA, LINE_HALF_W - AA, ax)
              * smoothstep(GAP - AA, GAP + AA, ay)
              * (1.0 - smoothstep(1.0 - AA, 1.0, ay));

  float mask = max(hMask, vMask);
  if (mask < 0.01) discard;

  fragColor = vec4(uColor, mask * 0.9);
}
