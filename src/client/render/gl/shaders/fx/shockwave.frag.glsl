#version 300 es
precision highp float;

uniform float uRingWidth;
uniform float uTime;      // seconds — animates procedural styles

in vec2  vLocalPos;
flat in float vAlpha;   // 1 - lifetime progress (fades out over the effect)
flat in float vStyle;   // 1.0 = EMP energy pulse, 0.0 = classic ring
flat in vec3  vColor0;  // EMP: palette color 0
flat in vec3  vColor1;  // EMP: palette color 1
flat in vec3  vColor2;  // EMP: palette color 2 (pads repeat the last color)
flat in vec3  vColor3;  // EMP: palette color 3 (pads repeat the last color)
flat in float vColorCount; // active palette size (1..4)
flat in float vSpeed;   // EMP: animation-speed multiplier
flat in float vTransSpeed; // EMP: palette step rate (colors/s)
flat in float vThickness; // EMP: ring band thickness (world tiles)
flat in float vRadius;  // current ring radius (world tiles)

// Palette lookup by (already-wrapped) index.
vec3 colorAt(float i) {
  if (i < 0.5) return vColor0;
  if (i < 1.5) return vColor1;
  if (i < 2.5) return vColor2;
  return vColor3;
}

out vec4 fragColor;

// --- cheap 1D value noise -------------------------------------------------
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  float u = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), u);
}

// Classic expanding white ring (SAM, and nuke style 0).
void classicRing(float dist) {
  float ringDist = abs(dist - 1.0);
  float ring = 1.0 - smoothstep(0.0, uRingWidth, ringDist);
  if (ring < 0.01) discard;
  fragColor = vec4(1.0, 1.0, 1.0, ring * vAlpha);
}

// EMP energy pulse — a jagged, crackling ring with rotating lightning arcs and
// a faint trailing energy fill. Colored by the firing player's cosmetic.
void empPulse(float dist) {
  float ang = atan(vLocalPos.y, vLocalPos.x); // -pi..pi
  float tt = uTime * vSpeed;                   // speed-scaled animation time

  // Jagged front: perturb the ideal r=1.0 ring by angular + time noise.
  float n = vnoise(ang * 6.0 + tt * 6.0)
          + 0.5 * vnoise(ang * 17.0 - tt * 11.0);
  float ringR = 0.95 + n * 0.05;
  float ringDist = abs(dist - ringR);

  // Band half-width in local units (dist 1.0 = vRadius world tiles), so the
  // cosmetic's thickness stays constant in tiles while the ring expands.
  // Per-angle flicker (averages ~1.0×) keeps it feeling electric.
  float halfW = 0.5 * vThickness / max(vRadius, 0.001);
  float w = halfW * (0.7 + 0.6 * vnoise(ang * 9.0 + tt * 20.0));
  float ring = 1.0 - smoothstep(0.0, w, ringDist);

  // A couple of bright rotating arcs of "lightning" chasing around the ring.
  float arc = pow(0.5 + 0.5 * sin(ang * 5.0 - tt * 8.0), 8.0)
            + pow(0.5 + 0.5 * sin(ang * 8.0 + tt * 13.0), 12.0);

  // Faint inner energy fill trailing behind the front.
  float inner = smoothstep(ringR, 0.0, dist) * 0.12
              * (0.6 + 0.4 * vnoise(ang * 20.0 + tt * 25.0));

  float glow = ring * (0.8 + arc) + inner;
  if (glow < 0.01) discard;

  // Base color cycles through the whole palette (color0 → color1 → … → wrap)
  // at transitionSpeed steps/s, like the trail shader's transition (0 →
  // static color0, negative → reverse cycle). Arcs flare toward white.
  float idx = uTime * vTransSpeed;
  vec3 base = mix(
    colorAt(mod(floor(idx), vColorCount)),
    colorAt(mod(floor(idx) + 1.0, vColorCount)),
    fract(idx));
  // Padded slots repeat a real color, so this max spans the active palette.
  vec3 bright = max(max(vColor0, vColor1), max(vColor2, vColor3));
  vec3 hot = mix(bright, vec3(1.0), 0.4);
  vec3 col = mix(base, hot, clamp(arc * 0.8, 0.0, 1.0));

  // Whole-ring flicker on top of the lifetime fade (speed-scaled like the rest).
  float life = vAlpha * (0.75 + 0.25 * vnoise(tt * 30.0));
  fragColor = vec4(col, clamp(glow, 0.0, 1.0) * life);
}

void main() {
  float dist = length(vLocalPos);
  if (vStyle > 0.5) {
    empPulse(dist);
  } else {
    classicRing(dist);
  }
}
