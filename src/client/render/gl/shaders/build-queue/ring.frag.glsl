#version 300 es
precision highp float;

uniform float uRingInner;   // inner edge of the ring, fraction of radius
uniform vec3  uFillColor;
uniform vec3  uTrackColor;
uniform vec3  uBackColor;
uniform float uBackAlpha;

in vec2 vLocal;
flat in float vProgress;

out vec4 fragColor;

const float PI = 3.14159265;

void main() {
  float d = length(vLocal);
  float aa = fwidth(d);
  float outer = 1.0 - smoothstep(1.0 - aa, 1.0, d);
  if (outer <= 0.0) discard;

  float ring = smoothstep(uRingInner - aa, uRingInner, d);

  // Progress sweeps clockwise from 12 o'clock.
  float angle = atan(vLocal.x, -vLocal.y);       // -PI..PI, 0 at top
  float frac = (angle + PI) / (2.0 * PI);
  frac = fract(frac + 0.5);                       // 0 at top, increasing clockwise
  float filled = step(frac, vProgress);

  vec3 ringColor = mix(uTrackColor, uFillColor, filled);
  vec3 color = mix(uBackColor, ringColor, ring);
  float alpha = mix(uBackAlpha, 1.0, ring) * outer;
  fragColor = vec4(color, alpha);
}
