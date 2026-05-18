#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;      // R16UI — tile state per cell
uniform sampler2D  uPalette;      // RGBA32F — player colors

uniform vec2 uMapSize;
uniform int uAltView;
uniform float uCharcoalBase;
uniform float uCharcoalVariation;
uniform float uCharcoalAlpha;
uniform uint uHighlightOwner;      // 0 = no highlight; otherwise smallID of hovered owner
uniform float uHighlightBrighten;  // mix amount toward white for highlighted tiles

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  uint owner = raw & uint(OWNER_MASK);
  bool fallout = (raw & (1u << FALLOUT_BIT)) != 0u;

  if (owner == 0u && !fallout) discard;

  // Alt-view: hide territory fill, keep fallout charcoal
  if (uAltView != 0 && owner != 0u) discard;

  // --- Fallout charcoal ground (unowned) ---
  if (owner == 0u && fallout) {
    float h = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
    float charcoal = uCharcoalBase + h * uCharcoalVariation;
    fragColor = vec4(vec3(charcoal), uCharcoalAlpha);
    return;
  }

  // --- Territory fill (owned) ---
  float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
  vec4 color = texture(uPalette, vec2(u, 0.25));

  // Hover highlight: brighten every tile owned by the hovered player.
  if (uHighlightOwner != 0u && owner == uHighlightOwner) {
    color.rgb = mix(color.rgb, vec3(1.0), uHighlightBrighten);
  }

  fragColor = color;
}
