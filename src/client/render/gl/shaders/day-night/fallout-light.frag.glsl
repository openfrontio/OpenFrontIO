#version 300 es
precision highp float;
precision highp usampler2D;
uniform sampler2D uHeatTex;
uniform usampler2D uTileTex;
uniform vec2 uMapSize;
uniform float uTick;
uniform float uTileScale;
uniform vec3 uFalloutLightColor;
uniform float uFalloutLightIntensity;
uniform float uFalloutLightThreshold;
uniform vec3 uEmberLightColor;
uniform float uEmberLightIntensity;
uniform float uParticleThresholdUnowned;
uniform float uParticleThresholdOwned;
uniform float uParticleFlickerSpeed;
uniform float uParticleFreshScale;
out vec4 fragColor;
void main() {
  // FBO is mapW/uTileScale × mapH/uTileScale; each output pixel samples one
  // tile near the center of its uTileScale×uTileScale source block.
  ivec2 tc = ivec2(gl_FragCoord.xy * uTileScale);
  if (tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  bool fallout = (raw & (1u << FALLOUT_BIT)) != 0u;
  if (!fallout) discard;

  uint owner = raw & uint(OWNER_MASK);
  float heat = texelFetch(uHeatTex, tc, 0).r;

  // Green fallout glow
  vec3 light = vec3(0.0);
  if (heat >= uFalloutLightThreshold) {
    float fi = heat * uFalloutLightIntensity;
    light += uFalloutLightColor * fi;
  }

  // Ember light — compute the same flicker as FalloutBloomPass.extract inline.
  float h1 = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
  float h2 = fract(sin(float(tc.x) * 63.7 + float(tc.y) * 157.3) * 23421.631);
  float pThresh = (owner == 0u) ? uParticleThresholdUnowned : uParticleThresholdOwned;
  if (h2 > pThresh) {
    float tileRate = uParticleFlickerSpeed * (0.4 + h1 * 1.2);
    float flick = max(0.0, sin(uTick * tileRate + h1 * 12.0) * 0.8 + 0.2);
    flick *= flick;
    flick *= mix(uParticleFreshScale, 1.0, 1.0 - heat);
    // Fade embers out with the heat. The fallout bit is permanent on tiles
    // that stay unowned, so without this the ember light flickers forever
    // once the blast has cooled.
    flick *= heat;
    light += uEmberLightColor * flick * uEmberLightIntensity;
  }

  float a = max(light.r, max(light.g, light.b));
  if (a < 0.001) discard;
  fragColor = vec4(light, a);
}
