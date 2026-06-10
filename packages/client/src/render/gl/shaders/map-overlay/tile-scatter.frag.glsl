#version 300 es
precision highp float;
precision highp int;

flat in uint vState;

// R16UI color attachment — integer output type required.
layout(location = 0) out uvec4 fragColor;

void main() {
  fragColor = uvec4(vState, 0u, 0u, 0u);
}
