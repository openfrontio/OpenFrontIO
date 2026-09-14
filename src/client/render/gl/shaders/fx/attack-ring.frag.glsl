#version 300 es
precision highp float;

uniform float uTime;        // seconds, for rotation
uniform float uRingWidth;   // line thickness in normalized coords

in vec2  vLocalPos;
flat in float vAlpha;

out vec4 fragColor;

const float INNER_R = 0.5;
const float OUTER_R = 0.8;
const float INNER_DASHES = 8.0;
const float OUTER_DASHES = 2.0;
const float PI = 3.14159265;

void main() {
  float dist = length(vLocalPos);
  float angle = atan(vLocalPos.y, vLocalPos.x);

  // Inner ring — thin, many dashes, rotating clockwise
  float innerDist = abs(dist - INNER_R);
  float innerRing = 1.0 - smoothstep(0.0, uRingWidth * 2.0, innerDist);
  float innerAngle = angle + uTime * 1.2;
  float innerDash = smoothstep(0.4, 0.5, abs(fract(innerAngle * INNER_DASHES / (2.0 * PI)) - 0.5) * 2.0);
  innerRing *= innerDash;

  // Outer ring — thick, few dashes, counter-rotating
  float outerDist = abs(dist - OUTER_R);
  float outerRing = 1.0 - smoothstep(0.0, uRingWidth * 3.0, outerDist);
  float outerAngle = angle - uTime * 0.6;
  float outerDash = smoothstep(0.3, 0.4, abs(fract(outerAngle * OUTER_DASHES / (2.0 * PI)) - 0.5) * 2.0);
  outerRing *= outerDash;

  float ring = max(innerRing, outerRing);
  if (ring < 0.01) discard;

  fragColor = vec4(1.0, 0.0, 0.0, ring * vAlpha);
}
