#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;      // R16UI — tile state per cell
uniform sampler2D  uPalette;      // RGBA32F — player colors
uniform sampler2D  uPatternMeta;  // RGBA32F — 1D buffer, 1 px per owner. R=hasPattern, G=width, B=height, A=scale
uniform usampler2D uPatternData;  // R8UI    — 2D buffer, row per owner, bytes for bitmask
uniform int uShowPatterns;

uniform vec2 uMapSize;
uniform int uAltView;
uniform float uStaleNukeBase;
uniform float uStaleNukeVariation;
uniform float uStaleNukeAlpha;
uniform vec3 uStaleNukeColor;
uniform uint uHighlightOwner;      // 0 = no highlight; otherwise smallID of hovered owner
uniform float uHighlightBrighten;  // base mix amount toward white for highlighted tiles
uniform float uTime;               // seconds (bounded), drives hover pan + glow pulse
uniform vec4 uHoverBBox;           // hovered owner's AABB: [minX, minY, maxX, maxY]
uniform float uHoverFlash;         // 0..1, decays after hover-enter (one-shot brightening)

// Hover-only effects applied to the territory of uHighlightOwner.
const float PAN_SPEED_X = 6.0;        // pattern pan, world tiles / sec (horizontal only)
const float GLOW_PULSE_HZ = 0.5;      // ~2s pulse cycle
const float GLOW_PULSE_AMP = 0.25;    // extra brighten at pulse peak, on top of uHighlightBrighten
const float SPARKLE_THRESHOLD = 0.97; // hash > this → tile is a sparkle candidate (~3% of tiles)
const float SPARKLE_HZ = 0.7;         // twinkle cycle speed per tile
const float SPARKLE_SHARPNESS = 8.0;  // higher = narrower flash window
const float SPARKLE_INTENSITY = 1.2;  // additive whiteness at flash peak
const float SWEEP_DURATION = 3.5;     // seconds for sweep to cross the territory
const float SWEEP_WIDTH = 6.0;        // half-width of the sweep band, in world tiles
const float SWEEP_INTENSITY = 0.35;   // additive whiteness at sweep peak
const float FLASH_INTENSITY = 0.6;    // additive whiteness at hover-enter peak
const float RAINBOW_HZ = 0.25;        // hue cycles / sec (4s full loop)
const float RAINBOW_SAT = 0.8;        // saturation of rainbow override
const float RAINBOW_VAL = 0.85;       // value/brightness of rainbow override

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

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

  // --- Stale-nuke ground (any fallout tile, owned or not) ---
  // Renders for owned tiles too so the player's territory color can't bleed
  // through dim/transparent spots in the fallout bloom above.
  if (fallout) {
    float h = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
    float noise = uStaleNukeBase + h * uStaleNukeVariation;
    fragColor = vec4(uStaleNukeColor + vec3(noise), uStaleNukeAlpha);
    return;
  }

  // Alt-view: hide owned non-fallout tiles
  if (uAltView != 0) discard;

  // --- Territory fill (owned, not fallout) ---
  float u = (float(owner) + 0.5) / float(PALETTE_SIZE);
  vec4 color = texture(uPalette, vec2(u, 0.25));
  bool onSecondary = false;

  if (uShowPatterns == 1) {
    vec4 meta = texelFetch(uPatternMeta, ivec2(int(owner), 0), 0);
    if (meta.r > 0.0) {
      int pWidth = int(meta.g);
      int pHeight = int(meta.b);
      int pScale = int(meta.a);

      // Pan the pattern for the hovered owner so it slides right-to-left across territory.
      int isHover = (uHighlightOwner != 0u && owner == uHighlightOwner) ? 1 : 0;
      int offX = isHover * int(uTime * PAN_SPEED_X);

      int px = (tc.x + offX) >> pScale;
      int py = tc.y >> pScale;
      int mx = ((px % pWidth) + pWidth) % pWidth;
      int my = ((py % pHeight) + pHeight) % pHeight;
      int bitIndex = my * pWidth + mx;
      int byteIndex = bitIndex >> 3;

      uint patternByte = texelFetch(uPatternData, ivec2(byteIndex, int(owner)), 0).r;
      bool isPrimary = (patternByte & (1u << uint(bitIndex & 7))) == 0u;

      if (!isPrimary) {
        color = texture(uPalette, vec2(u, 0.75));
        onSecondary = true;
      }
    }
  }

  // Rainbow override on hovered territory — cycle hue over time. Primary and
  // secondary cycle 180° out of phase so the pattern stays readable.
  bool isHovered = uHighlightOwner != 0u && owner == uHighlightOwner;
  if (isHovered) {
    float hue = fract(uTime * RAINBOW_HZ + (onSecondary ? 0.5 : 0.0));
    color.rgb = hsv2rgb(vec3(hue, RAINBOW_SAT, RAINBOW_VAL));
  }

  // Glow pulse — only on the primary color, so the rainbow pattern stays
  // structured with primary regions reading slightly hotter than secondary.
  if (isHovered && !onSecondary) {
    float pulse = 0.5 + 0.5 * sin(uTime * GLOW_PULSE_HZ * 6.2831853);
    float glow = uHighlightBrighten + pulse * GLOW_PULSE_AMP;
    color.rgb = mix(color.rgb, vec3(1.0), glow);
  }

  // Sparkles on hovered territory: a small subset of tiles twinkle on
  // phase-shifted cycles. Additive white, clamped by output format.
  if (isHovered) {
    float hash = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
    if (hash > SPARKLE_THRESHOLD) {
      float phase = fract(uTime * SPARKLE_HZ + hash * 31.0);
      float spark = pow(max(0.0, 1.0 - abs(phase - 0.5) * SPARKLE_SHARPNESS), 4.0);
      color.rgb += spark * SPARKLE_INTENSITY;
    }

    // Scan-line sweep: a bright vertical band that traverses the territory's
    // bounding box left→right, wraps, and repeats.
    float bboxW = max(1.0, uHoverBBox.z - uHoverBBox.x);
    float sweepX = uHoverBBox.x + mod(uTime / SWEEP_DURATION, 1.0) * bboxW;
    float sweepDist = abs(float(tc.x) - sweepX);
    float sweep = exp(-sweepDist * sweepDist / (SWEEP_WIDTH * SWEEP_WIDTH));
    color.rgb += sweep * SWEEP_INTENSITY;

    // Hover-enter flash: brief one-shot brightening when hover begins.
    color.rgb += uHoverFlash * FLASH_INTENSITY;
  }

  fragColor = color;
}
