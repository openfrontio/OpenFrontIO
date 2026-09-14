#version 300 es
precision highp float;

in vec2 vUV;
flat in float vType;

out vec4 fragColor;

// Colors matching upstream
const vec3 COLOR_WHITE = vec3(1.0);
const vec3 OUTLINE_GRAY = vec3(0.549);    // rgba(140, 140, 140)
const vec3 COLOR_RED = vec3(1.0, 0.0, 0.0);
const vec3 OUTLINE_BLACK = vec3(0.0);

void main() {
  float alpha = 0.0;
  vec3 color = vec3(1.0);

  if (vType < 0.5) {
    // Circle marker at untargetable zone boundary
    // White ring with gray outline (upstream: 4px radius, 1.25px stroke)
    float dist = length(vUV);
    float ring = abs(dist - 0.55);
    float lineAlpha = 1.0 - smoothstep(0.06, 0.12, ring);
    float outlineAlpha = 1.0 - smoothstep(0.14, 0.22, ring);
    float blend = outlineAlpha > 0.01 ? lineAlpha / outlineAlpha : 1.0;
    color = mix(OUTLINE_GRAY, COLOR_WHITE, blend);
    alpha = outlineAlpha;
  } else {
    // X marker at SAM intercept point
    // Red X with black outline (upstream: 6px arms, 2px stroke)
    float d1 = abs(vUV.x - vUV.y) * 0.7071;
    float d2 = abs(vUV.x + vUV.y) * 0.7071;
    float minD = min(d1, d2);
    float circleMask = 1.0 - smoothstep(0.7, 0.85, length(vUV));
    float lineAlpha = (1.0 - smoothstep(0.08, 0.16, minD)) * circleMask;
    float outlineAlpha = (1.0 - smoothstep(0.18, 0.28, minD)) * circleMask;
    float blend = outlineAlpha > 0.01 ? lineAlpha / outlineAlpha : 1.0;
    color = mix(OUTLINE_BLACK, COLOR_RED, blend);
    alpha = outlineAlpha;
  }

  if (alpha < 0.01) discard;
  fragColor = vec4(color, alpha);
}
