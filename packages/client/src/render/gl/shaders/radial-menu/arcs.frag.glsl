#version 300 es
precision highp float;

in vec2 vLocal; // [-1, +1], distance 1.0 = outerR

uniform float uInnerR;     // inner radius as fraction of outerR [0,1]
uniform int uSegCount;     // number of segments (1..8)
uniform int uHoveredSeg;   // hovered segment index (-1 = none)
uniform vec4 uSegColors[8]; // per-segment: rgb + enabled (a: 1 = enabled, 0 = disabled)

// Center button
uniform int uHasCenterBtn;   // 1 = show center button
uniform vec3 uCenterColor;   // center button RGB
uniform int uCenterHovered;  // 1 = center button hovered

out vec4 fragColor;

const float GAP = 0.03;       // radians gap between segments (game: padAngle 0.03)
const float AA = 0.010;       // anti-alias width (normalized coords)
const float BORDER_W = 0.024; // border width, non-hovered
const float BORDER_W_HOV = 0.034; // border width, hovered (thicker)
const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;

void main() {
  float dist = length(vLocal);

  // --- Center button zone ---
  if (dist < uInnerR - AA) {
    if (uHasCenterBtn == 0) discard;

    // Solid center fill — fade alpha only at outer edge
    float centerAlpha = 1.0 - smoothstep(uInnerR - AA * 3.0, uInnerR - AA, dist);

    bool cHov = uCenterHovered > 0;
    float cbw = cHov ? BORDER_W_HOV : BORDER_W;
    vec3 cbCol = cHov ? vec3(1.0) : vec3(0.88);

    // Crisp border at outer edge of center circle
    float borderDist = uInnerR - AA - dist;
    float border = 1.0 - smoothstep(cbw - AA, cbw + AA, borderDist);

    vec3 color = uCenterColor;
    if (cHov) color = mix(color, vec3(1.0), 0.2);
    color = mix(color, cbCol, border);

    float cAlpha = cHov ? 0.92 : 0.6;
    fragColor = vec4(color, cAlpha * centerAlpha);
    return;
  }

  // --- Ring zone ---
  if (uSegCount == 0) discard; // center-only mode

  // Annulus mask
  float outer = 1.0 - smoothstep(1.0 - AA, 1.0, dist);
  float inner = smoothstep(uInnerR - AA, uInnerR + AA, dist);
  float ring = outer * inner;
  if (ring < 0.01) discard;

  // Angle: 0 at top, increasing clockwise [0, 2π]
  float angle = atan(vLocal.x, -vLocal.y);
  if (angle < 0.0) angle += TWO_PI;

  // Rotate so first segment is centered at top (game: startAngle = -π/n)
  float segArc = TWO_PI / float(uSegCount);
  float offset = PI / float(uSegCount);
  float shifted = mod(angle + offset, TWO_PI);

  // Segment index (in rotated space)
  int segIdx = int(floor(shifted / segArc));
  segIdx = min(segIdx, uSegCount - 1);

  // Gap mask between segments
  float segStart = float(segIdx) * segArc;
  float segEnd = segStart + segArc;
  float halfGap = GAP * 0.5;

  float gap = 1.0;
  if (uSegCount > 1) {
    gap = smoothstep(segStart + halfGap - AA, segStart + halfGap + AA, shifted)
        * (1.0 - smoothstep(segEnd - halfGap - AA, segEnd - halfGap + AA, shifted));
  }

  float alpha = ring * gap;
  if (alpha < 0.01) discard;

  // Segment color + hover state
  vec4 seg = uSegColors[segIdx];
  vec3 color = seg.rgb;
  bool enabled = seg.a > 0.5;
  bool hovered = (segIdx == uHoveredSeg && enabled);

  // Pick border width & color based on hover
  float bw = hovered ? BORDER_W_HOV : BORDER_W;
  vec3 borderCol = hovered ? vec3(1.0) : vec3(0.88);

  // --- Borders ---
  // Outer edge
  float outerBorder = 1.0 - smoothstep(bw - AA, bw + AA, 1.0 - dist);
  // Inner edge
  float innerBorder = 1.0 - smoothstep(bw - AA, bw + AA, dist - uInnerR);
  // Radial lines at gap edges
  float angBorder = 0.0;
  if (uSegCount > 1) {
    float angleInSeg = shifted - segStart;
    float distToStart = angleInSeg - halfGap;
    float distToEnd = (segArc - halfGap) - angleInSeg;
    // Convert angular distance to approximate normalized arc-length
    float nearestAng = min(distToStart, distToEnd) * dist;
    angBorder = 1.0 - smoothstep(bw - AA, bw + AA, nearestAng);
  }
  float border = max(max(outerBorder, innerBorder), angBorder);

  // Disabled segments: desaturate + darken
  if (!enabled) {
    float lum = dot(color, vec3(0.3, 0.6, 0.1));
    color = vec3(lum) * 0.4;
  }

  // Hover highlight: brighten fill
  if (hovered) {
    color = mix(color, vec3(1.0), 0.2);
  }

  // Blend border on top
  color = mix(color, borderCol, border);

  // Opacity: hovered → nearly opaque, default → slightly transparent, disabled → dim
  float segAlpha = enabled ? (hovered ? 0.92 : 0.6) : 0.4;
  fragColor = vec4(color, alpha * segAlpha);
}
