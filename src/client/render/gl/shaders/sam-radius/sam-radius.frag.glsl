#version 300 es
precision highp float;

in vec2 vLocal;
flat in float vRadius;
flat in vec3 vColor;
flat in vec2 vArcBounds;

uniform float uTime;
uniform float uOutline;        // 1.0 = owner mode (outline edges), 0.0 = perspective
uniform float uStrokeWidth;    // ring half-width (world units)
uniform float uDashLen;        // dash length (world units)
uniform float uGapLen;         // gap length (world units)
uniform float uRotationSpeed;  // rotation (world units/sec)
uniform float uAlpha;          // base opacity
uniform float uOutlineWidth;   // outline border width (world units)
uniform float uOutlineSoftness; // smoothstep range (0 = hard edge)

out vec4 fragColor;

const float TWO_PI = 6.2831853;

void main() {
  float paddedR = vRadius + 2.0;
  float dist = length(vLocal) * paddedR;

  // Ring mask: stroke centered on the circle edge
  float ringAlpha = smoothstep(vRadius - uStrokeWidth - 0.5, vRadius - uStrokeWidth, dist)
                  * (1.0 - smoothstep(vRadius + uStrokeWidth, vRadius + uStrokeWidth + 0.5, dist));

  if (ringAlpha < 0.01) discard;

  // Arc clipping
  float angle = atan(vLocal.y, vLocal.x);
  float normAngle = angle < 0.0 ? angle + TWO_PI : angle;
  bool fullCircle = vArcBounds.y - vArcBounds.x >= TWO_PI - 0.001;
  if (!fullCircle) {
    if (normAngle < vArcBounds.x || normAngle > vArcBounds.y) discard;
  }

  // Dash pattern along circumference
  float arcPos = angle * vRadius;
  float period = uDashLen + uGapLen;
  float dashPhase = mod(arcPos + uTime * uRotationSpeed, period);
  float dashAlpha = 1.0 - smoothstep(uDashLen - 0.5, uDashLen + 0.5, dashPhase);

  float alpha = ringAlpha * dashAlpha * uAlpha;
  if (alpha < 0.01) discard;

  // Outline: darken fragments near any edge of each dash segment
  float edgeFade = 1.0;
  if (uOutline > 0.5) {
    float ow = uOutlineWidth;
    float soft = uOutlineSoftness;
    // Radial edges (inner/outer ring boundary)
    float fromInner = dist - (vRadius - uStrokeWidth);
    float fromOuter = (vRadius + uStrokeWidth) - dist;
    edgeFade = min(smoothstep(ow - soft, ow + soft, fromInner),
                   smoothstep(ow - soft, ow + soft, fromOuter));
    // Dash start/end edges (circumferential)
    edgeFade = min(edgeFade, smoothstep(ow - soft, ow + soft, dashPhase));
    edgeFade = min(edgeFade, smoothstep(ow - soft, ow + soft, uDashLen - dashPhase));
    // Arc endpoint edges (where circle union clips the arc)
    if (!fullCircle) {
      float arcDistStart = (normAngle - vArcBounds.x) * vRadius;
      float arcDistEnd   = (vArcBounds.y - normAngle) * vRadius;
      edgeFade = min(edgeFade, smoothstep(ow - soft, ow + soft, arcDistStart));
      edgeFade = min(edgeFade, smoothstep(ow - soft, ow + soft, arcDistEnd));
    }
  }

  vec3 finalColor = vColor * edgeFade;
  fragColor = vec4(finalColor, alpha);
}
