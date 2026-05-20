#version 300 es
precision highp float;

in float vT;
in float vArcDist;
in float vEdgeDist;

uniform float uPixelSize;
uniform float uTUntargetableStart;  // -1 = no zone
uniform float uTUntargetableEnd;    // -1 = no zone
uniform float uTSamIntercept;       // 1.0 = no intercept

// Settings uniforms
uniform float uQuadHalfPx;          // total half-width of quad in pixels
uniform float uLineHalfPx;          // main line half-width in pixels
uniform float uOutlineHalfPx;       // outline half-width in pixels
uniform vec4 uDashPattern;          // (dashTargetable, gapTargetable, dashUntargetable, gapUntargetable)
uniform vec3 uLineColor;            // normal line color
uniform vec3 uInterceptColor;       // line color after SAM intercept
uniform vec3 uOutlineColor;         // outline color (normal)
uniform vec3 uInterceptOutlineColor; // outline color (after intercept)

out vec4 fragColor;

void main() {
  // Zone classification
  bool inUntargetable = uTUntargetableStart >= 0.0
    && vT >= uTUntargetableStart
    && vT <= uTUntargetableEnd;
  bool intercepted = vT >= uTSamIntercept;

  // Dash pattern (pixel space)
  float dashLen = inUntargetable ? uDashPattern.z : uDashPattern.x;
  float gapLen = inUntargetable ? uDashPattern.w : uDashPattern.y;
  float period = dashLen + gapLen;
  float pixelDist = vArcDist / uPixelSize;
  float phase = mod(pixelDist, period);
  float dashAlpha = 1.0 - smoothstep(dashLen - 0.5, dashLen + 0.5, phase);
  if (dashAlpha < 0.01) discard;

  // Line vs outline (pixel distance from center line)
  float d = abs(vEdgeDist) * uQuadHalfPx;
  float lineAlpha = 1.0 - smoothstep(uLineHalfPx - 0.4, uLineHalfPx + 0.4, d);
  float outlineAlpha = 1.0 - smoothstep(uOutlineHalfPx - 0.4, uOutlineHalfPx + 0.4, d);
  if (outlineAlpha < 0.01) discard;

  // Color selection
  vec3 lineColor = intercepted ? uInterceptColor : uLineColor;
  vec3 outlineColor = intercepted ? uInterceptOutlineColor : uOutlineColor;
  float blend = outlineAlpha > 0.01 ? lineAlpha / outlineAlpha : 1.0;
  vec3 color = mix(outlineColor, lineColor, blend);

  fragColor = vec4(color, outlineAlpha * dashAlpha);
}
