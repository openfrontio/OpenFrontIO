#version 300 es
precision highp float;

uniform sampler2D uSceneTex;
uniform sampler2D uLightTex;
uniform float uAmbient;

in vec2 vUV;
out vec4 fragColor;

void main() {
  vec3 scene = texture(uSceneTex, vUV).rgb;
  vec3 light = texture(uLightTex, vUV).rgb;

  // Scale lights inversely with ambient — invisible at full day, full strength at deep night
  vec3 illumination = min(vec3(uAmbient) + light * (1.0 - uAmbient), vec3(1.2));
  fragColor = vec4(scene * illumination, 1.0);
}
