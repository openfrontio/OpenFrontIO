#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1]
flat in vec3 vColor;

uniform float uAlpha;

out vec4 fragColor;

const float AA = 0.03;

// One pair of crossing arms (horizontal + vertical) that taper to a point at
// `len`, with half-width `wid` at the center.
float arms(vec2 p, float len, float wid) {
  float ax = abs(p.x);
  float ay = abs(p.y);
  float tx = clamp(ax / len, 0.0, 1.0);
  float ty = clamp(ay / len, 0.0, 1.0);
  float hw = wid * (1.0 - tx) * (1.0 - tx);
  float vw = wid * (1.0 - ty) * (1.0 - ty);
  float h = smoothstep(hw + AA, hw - AA, ay) * step(ax, len);
  float v = smoothstep(vw + AA, vw - AA, ax) * step(ay, len);
  return max(h, v);
}

void main() {
  vec2 p = vLocal;
  // 45° rotated copy for the short diagonal sparkle arms.
  vec2 d = vec2(p.x + p.y, p.x - p.y) * 0.7071;

  float star = max(arms(p, 1.0, 0.16), arms(d, 0.5, 0.11));
  float outline = max(arms(p, 1.0, 0.26), arms(d, 0.5, 0.19));

  // Soft glow around the core so the marker reads over any terrain.
  float r2 = dot(p, p);
  float glow = exp(-r2 * 6.0) * 0.55;

  // White-hot core fading to the team color along the arms.
  vec3 col = mix(vColor, vec3(1.0), exp(-r2 * 5.0));
  // Dark outline sits under the colored star for contrast.
  float blend = outline > 0.01 ? star / outline : 1.0;
  vec3 starCol = mix(vec3(0.0), col, blend);

  float alpha = max(outline, glow);
  if (alpha < 0.01) discard;
  vec3 finalCol = mix(vColor, starCol, outline / max(alpha, 0.001));
  fragColor = vec4(finalCol, alpha * uAlpha);
}
