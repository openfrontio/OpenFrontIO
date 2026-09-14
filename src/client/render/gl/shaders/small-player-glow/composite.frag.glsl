#version 300 es
precision highp float;

// Tints the blurred aura with the glow color and the breathing intensity
// (alpha * pulse), premultiplied for an additive composite over the map.
uniform sampler2D uTex;
uniform vec3 uGlowColor;
uniform float uIntensity; // glow alpha * pulse (0 = invisible)
in vec2 vUV;
out vec4 fragColor;

void main() {
  float g = texture(uTex, vUV).r;
  float a = clamp(g * uIntensity, 0.0, 1.0);
  fragColor = vec4(uGlowColor * a, a); // premultiplied
}
