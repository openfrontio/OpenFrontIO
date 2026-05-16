#version 300 es
precision highp float;
precision highp usampler2D;
uniform sampler2D uHeatTex;
uniform usampler2D uTileTex;
uniform sampler2D uBorderTex;
uniform vec2 uMapSize;
uniform vec3 uFalloutLightColor;
uniform float uFalloutLightIntensity;
uniform float uFalloutLightThreshold;
uniform vec3 uEmberLightColor;
uniform float uEmberLightIntensity;
out vec4 fragColor;
void main() {
  ivec2 tc = ivec2(gl_FragCoord.xy);
  if (tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  bool fallout = (raw & (1u << FALLOUT_BIT)) != 0u;
  if (!fallout) discard;

  float heat = texelFetch(uHeatTex, tc, 0).r;

  // Green fallout glow
  vec3 light = vec3(0.0);
  if (heat >= uFalloutLightThreshold) {
    float fi = heat * uFalloutLightIntensity;
    light += uFalloutLightColor * fi;
  }

  // Ember light — read pre-computed flicker from BorderComputePass
  float emberIntensity = texelFetch(uBorderTex, tc, 0).g;
  if (emberIntensity > 0.0) {
    light += uEmberLightColor * emberIntensity * uEmberLightIntensity;
  }

  float a = max(light.r, max(light.g, light.b));
  if (a < 0.001) discard;
  fragColor = vec4(light, a);
}
