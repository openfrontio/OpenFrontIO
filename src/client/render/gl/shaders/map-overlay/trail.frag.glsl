#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTrailTex;     // R8UI — trail ownerID per cell (0 = none)
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uAffiliation;  // RGBA8 — affiliation colors (row 0 = border, row 1 = unit)
uniform vec2 uMapSize;
uniform float uTrailAlpha;
uniform int uAltView;

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint trailOwner = texelFetch(uTrailTex, tc, 0).r;
  if (trailOwner == 0u) discard;

  vec3 color;
  if (uAltView != 0) {
    color = texelFetch(uAffiliation, ivec2(int(trailOwner), 1), 0).rgb;
  } else {
    float u = (float(trailOwner) + 0.5) / float(PALETTE_SIZE);
    color = texture(uPalette, vec2(u, 0.25)).rgb;
  }
  fragColor = vec4(color, uTrailAlpha);
}
