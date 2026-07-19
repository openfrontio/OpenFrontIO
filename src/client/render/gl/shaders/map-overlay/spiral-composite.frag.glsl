#version 300 es
precision highp float;

// Composite the reduced-resolution spiral halo buffer over the scene. The
// buffer holds premultiplied color; the composite blends ADDITIVELY
// (ONE, ONE) so the halo reads as emitted light, and bilinear upsampling
// keeps it soft. The sharp core ribbons draw above this at full resolution.

uniform sampler2D uTex;

in vec2 vUV;
out vec4 fragColor;

void main() {
  fragColor = texture(uTex, vUV);
}
