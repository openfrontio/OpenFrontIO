#version 300 es
precision highp float;

uniform vec2 uBarSize;
uniform float uBorderWidth;
uniform vec3 uThresholds;
uniform vec3 uColorRed;
uniform vec3 uColorOrange;
uniform vec3 uColorYellow;
uniform vec3 uColorGreen;
uniform float uSolid;       // 1.0 = veterancy pip: fill solid with uSolidColor
uniform vec3 uSolidColor;

in vec2 vLocalPos;
flat in float vProgress;

out vec4 fragColor;

void main() {
  // Veterancy pips are simple solid-filled rectangles (no border/threshold).
  if (uSolid > 0.5) {
    fragColor = vec4(uSolidColor, 1.0);
    return;
  }

  float x = vLocalPos.x;
  float y = vLocalPos.y;
  float w = uBarSize.x;
  float h = uBarSize.y;

  // Border on each side
  float bw = uBorderWidth;
  bool inBorder = x < bw || x > w - bw || y < bw || y > h - bw;

  // Colored fill region
  float fillWidth = vProgress * (w - 2.0 * bw);
  bool inFill = !inBorder && (x - bw) < fillWidth;

  if (inFill) {
    vec3 color;
    if (vProgress < uThresholds.x) color = uColorRed;
    else if (vProgress < uThresholds.y) color = uColorOrange;
    else if (vProgress < uThresholds.z) color = uColorYellow;
    else color = uColorGreen;
    fragColor = vec4(color, 1.0);
  } else {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}
