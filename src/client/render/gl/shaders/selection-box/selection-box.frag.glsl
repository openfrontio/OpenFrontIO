#version 300 es
precision highp float;

in vec2 vWorld;

uniform vec2 uCenter;
uniform float uHalfSize;
uniform float uTime;     // frame tick counter (increments each frame)
uniform vec3 uColor;     // RGB [0-1], already lightened

out vec4 fragColor;

void main() {
  // Tile-space relative to center
  vec2 tile = floor(vWorld);
  vec2 rel = tile - floor(uCenter);
  float hs = uHalfSize;

  // Is this tile on the border of the selection box?
  bool inXRange = rel.x >= -hs && rel.x <= hs;
  bool inYRange = rel.y >= -hs && rel.y <= hs;
  bool isXEdge = abs(rel.x - hs) < 0.5 || abs(rel.x + hs) < 0.5;
  bool isYEdge = abs(rel.y - hs) < 0.5 || abs(rel.y + hs) < 0.5;

  bool onBorder = (isXEdge && inYRange) || (isYEdge && inXRange);
  if (!onBorder) discard;

  // Stipple: checkerboard pattern (every other tile)
  float stipple = mod(tile.x + tile.y, 2.0);
  if (stipple > 0.5) discard;

  // Pulsating alpha (matches game: base 200/255 ± 55/255)
  float baseAlpha = 0.784;  // 200/255
  float pulseAmp  = 0.216;  // 55/255
  float alpha = baseAlpha + sin(uTime * 0.1) * pulseAmp;

  fragColor = vec4(uColor, alpha);
}
