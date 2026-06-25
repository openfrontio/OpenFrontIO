#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTrailTex;     // R8UI — trail ownerID per cell (0 = none)
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uAffiliation;  // RGBA8 — affiliation colors (row 0 = border, row 1 = unit)
uniform sampler2D  uTrailStyle;   // RGBA8, height 2 — per-owner trail cosmetic.
                                  //   row 0: rgb = base color, a = effect id
                                  //   (0 none, 1 solid, 2 rainbow, 3 pulse, 4 gradient)
                                  //   row 1: rgb = second color (gradient only)
uniform vec2 uMapSize;
uniform float uTrailAlpha;
uniform float uTime;              // seconds, for animated trail effects
uniform int uAltView;

in vec2 vWorldPos;
out vec4 fragColor;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

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
    vec4 style = texelFetch(uTrailStyle, ivec2(int(trailOwner), 0), 0);
    int effect = int(style.a * 255.0 + 0.5);
    if (effect == 1) {
      // Solid cosmetic color.
      color = style.rgb;
    } else if (effect == 2) {
      // Rainbow — hue flows along the wake and animates over time.
      float hue = fract(uTime * 0.15 + (vWorldPos.x + vWorldPos.y) * 0.03);
      color = hsv2rgb(vec3(hue, 0.9, 1.0));
    } else if (effect == 3) {
      // Pulse — base color modulated in brightness over time.
      float pulse = 0.55 + 0.45 * sin(uTime * 3.0);
      color = style.rgb * pulse;
    } else if (effect == 4) {
      // Gradient — blend between two colors, flowing along the wake over time.
      vec3 c2 = texelFetch(uTrailStyle, ivec2(int(trailOwner), 1), 0).rgb;
      float t = 0.5 + 0.5 * sin(uTime * 1.5 + (vWorldPos.x + vWorldPos.y) * 0.05);
      color = mix(style.rgb, c2, t);
    } else {
      // No trail cosmetic — fall back to the player's palette color.
      float u = (float(trailOwner) + 0.5) / float(PALETTE_SIZE);
      color = texture(uPalette, vec2(u, 0.25)).rgb;
    }
  }
  fragColor = vec4(color, uTrailAlpha);
}
