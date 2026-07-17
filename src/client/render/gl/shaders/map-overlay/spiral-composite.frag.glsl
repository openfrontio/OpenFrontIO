#version 300 es
precision highp float;

// Composite the reduced-resolution spiral-trail buffer over the scene. The
// buffer holds premultiplied alpha (blend with ONE, ONE_MINUS_SRC_ALPHA);
// bilinear upsampling supplies the soft, glowy edges.

uniform sampler2D uTex;

in vec2 vUV;
out vec4 fragColor;

void main() {
  fragColor = texture(uTex, vUV);
}
