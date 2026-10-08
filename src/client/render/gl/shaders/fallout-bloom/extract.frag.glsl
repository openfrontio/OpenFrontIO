#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D uTileTex;
uniform vec2 uMapSize;
uniform float uTick;
uniform float uTileScale;

uniform float uBroilSpeedCold;
uniform float uBroilSpeedHot;
uniform float uNoiseFreq1;
uniform float uNoiseFreq2;
uniform float uContrastLoCold;
uniform float uContrastLoHot;
uniform float uContrastHiCold;
uniform float uContrastHiHot;
uniform float uMetaFreq;
uniform float uIntensityCold;
uniform float uIntensityHot;
uniform float uMetaInfluenceCold;
uniform float uMetaInfluenceHot;
uniform float uOpacityFadeEnd;
uniform vec3 uBloomColor;
uniform vec3 uParticleColorDark;
uniform vec3 uParticleColorBright;
uniform float uParticleThresholdUnowned;
uniform float uParticleThresholdOwned;
uniform float uParticleFlickerSpeed;
uniform float uParticleStrength;
uniform float uParticleFreshScale;

uniform sampler2D uHeatTex;

out vec4 fragColor;

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i);
  float n100 = hash3(i + vec3(1, 0, 0));
  float n010 = hash3(i + vec3(0, 1, 0));
  float n110 = hash3(i + vec3(1, 1, 0));
  float n001 = hash3(i + vec3(0, 0, 1));
  float n101 = hash3(i + vec3(1, 0, 1));
  float n011 = hash3(i + vec3(0, 1, 1));
  float n111 = hash3(i + vec3(1, 1, 1));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}

void main() {
  // Bloom FBO is mapW/uTileScale × mapH/uTileScale; each output pixel maps
  // to the center tile of its uTileScale×uTileScale block. Still deterministic
  // and camera-independent — just sparser than 1:1.
  ivec2 tc = ivec2(gl_FragCoord.xy * uTileScale);
  if (tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y)) discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  if ((raw & (1u << FALLOUT_BIT)) == 0u) discard;
  uint owner = raw & uint(OWNER_MASK);

  float heat = texelFetch(uHeatTex, tc, 0).r;
  vec2 tileCenter = vec2(tc) + 0.5;

  float speed = mix(uBroilSpeedCold, uBroilSpeedHot, heat);
  float t = uTick * speed;

  float n1 = vnoise3(vec3(tileCenter * uNoiseFreq1, t));
  float n2 = vnoise3(vec3(tileCenter * uNoiseFreq2, t * 1.3));
  float broil = n1 * 0.6 + n2 * 0.4;

  float lo = mix(uContrastLoCold, uContrastLoHot, heat);
  float hi = mix(uContrastHiCold, uContrastHiHot, heat);
  broil = smoothstep(lo, hi, broil);

  float meta = vnoise3(vec3(tileCenter * uMetaFreq, t * 0.5));

  float baseIntensity = mix(uIntensityCold, uIntensityHot, heat);
  float metaInfluence = mix(uMetaInfluenceCold, uMetaInfluenceHot, heat);
  float intensity = baseIntensity * mix(1.0, meta, metaInfluence);

  float opacity = smoothstep(0.0, uOpacityFadeEnd, heat);

  fragColor = vec4(uBloomColor, 1.0) * broil * intensity * opacity;

  // Particle dots — sharper per-tile flicker gated by a stochastic hash.
  // (Relocated here from BorderStampPass; this is fallout-domain logic.)
  float h1 = fract(sin(float(tc.x) * 12.9898 + float(tc.y) * 78.233) * 43758.5453);
  float h2 = fract(sin(float(tc.x) * 63.7 + float(tc.y) * 157.3) * 23421.631);
  float pThresh = (owner == 0u) ? uParticleThresholdUnowned : uParticleThresholdOwned;
  if (h2 > pThresh) {
    // Per-tile rate variation breaks the global rhythm so tiles don't all
    // pulse at the same frequency. h1 spans [0,1] → rate spans 0.4×–1.6× base.
    float tileRate = uParticleFlickerSpeed * (0.4 + h1 * 1.2);
    float flick = max(0.0, sin(uTick * tileRate + h1 * 12.0) * 0.8 + 0.2);
    flick *= flick;
    // Dampen when fresh (high heat); ramp to full as heat decays.
    flick *= mix(uParticleFreshScale, 1.0, 1.0 - heat);
    // Fade dots out with the glow. Heat decays to 0, but the fallout bit is
    // permanent on tiles that stay unowned, so without this the dots flicker
    // forever once the bloom is gone.
    flick *= opacity;
    vec3 pc = mix(uParticleColorDark, uParticleColorBright, h1) * flick * uParticleStrength;
    float pa = max(pc.r, max(pc.g, pc.b));
    fragColor += vec4(pc, pa);
  }
}
