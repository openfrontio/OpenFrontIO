#version 300 es
precision highp float;

uniform sampler2D uPalette;
uniform sampler2D uAtlas;
uniform sampler2D uAffiliation;   // 256×2 RGBA8 — row 1 = unit affiliation
uniform float uTick;
uniform float uFlickerSpeed;
uniform vec3  uAngryColor;
uniform int   uAltView;

in vec2  vLocalPos;
in vec2  vAtlasUV;
flat in float vOwnerID;
flat in float vFlags;
flat in float vHash;

out vec4 fragColor;

// Flag constants — must match CPU-side FLAG_* values
const float FLAG_FLICKER        = 1.0;
const float FLAG_ANGRY          = 2.0;
const float FLAG_TRADE_FRIENDLY = 3.0;

// Ally color for trade-friendly override (yellow — matches affiliation.ts ALLY)
const vec3 ALLY_COLOR = vec3(1.0, 1.0, 0.0);

// Flicker hot colors: red → orange → yellow → white
const vec3 FLICKER_COLORS[4] = vec3[4](
  vec3(1.0, 0.0, 0.0),   // red
  vec3(1.0, 0.5, 0.0),   // orange
  vec3(1.0, 1.0, 0.0),   // yellow
  vec3(1.0, 1.0, 1.0)    // white
);

void main() {
  vec4 texel = texture(uAtlas, vAtlasUV);

  // Discard fully transparent pixels
  if (texel.a < 0.01) discard;

  float gray = texel.r;

  // Alt-view: solid affiliation color, no gray-replacement bands
  if (uAltView != 0) {
    // Enemy trade ships heading to a self/allied port render as yellow (ally)
    vec3 ac = vFlags > 2.5
      ? ALLY_COLOR
      : texelFetch(uAffiliation, ivec2(int(vOwnerID), 1), 0).rgb;
    fragColor = vec4(ac, texel.a);
    return;
  }

  // Player color lookup from palette
  float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
  vec3 territoryColor = texture(uPalette, vec2(u, 0.25)).rgb;
  vec3 borderColor    = texture(uPalette, vec2(u, 0.75)).rgb;

  // Flag states (uint8 passed as float via vertex attribute):
  //   0 = normal
  //   1 = flicker (nukes/warheads — cycling hot colors)
  //   2 = angry (warships attacking — solid red territory band)
  if (abs(vFlags - FLAG_ANGRY) < 0.1) {
    // Angry: solid red territory band
    territoryColor = uAngryColor;
  } else if (abs(vFlags - FLAG_FLICKER) < 0.1) {
    // Flicker: cycle through hot colors, offset by position hash
    float phase = fract(uTick * uFlickerSpeed + vHash);
    int idx = int(phase * 4.0) % 4;
    territoryColor = FLICKER_COLORS[idx];
    borderColor = FLICKER_COLORS[(idx + 2) % 4];
  }

  // Three-band gray replacement:
  //   180/255 ~ 0.706 -> territory color (light band)
  //   130/255 ~ 0.510 -> spawn/mid color (interpolated)
  //   70/255  ~ 0.275 -> border color (dark band)
  vec3 spawnColor = mix(territoryColor, borderColor, 0.5);

  vec3 color;
  if (gray > 0.6) {
    // Light band (180) -> territory color
    color = territoryColor;
  } else if (gray > 0.4) {
    // Mid band (130) -> spawn color
    color = spawnColor;
  } else {
    // Dark band (70) -> border color
    color = borderColor;
  }

  fragColor = vec4(color, texel.a);
}
