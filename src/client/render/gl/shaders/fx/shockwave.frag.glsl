#version 300 es
precision highp float;

uniform float uRingWidth;
uniform float uTime;      // seconds — animates procedural styles

in vec2  vLocalPos;
flat in float vAlpha;   // 1 - lifetime progress (fades out over the effect)
flat in float vStyle;   // 0 = classic ring, 1 = EMP pulse, 2 = sparkles
flat in vec3  vColor0;  // cosmetic: palette color 0
flat in vec3  vColor1;  // cosmetic: palette color 1
flat in vec3  vColor2;  // cosmetic: palette color 2 (pads repeat the last color)
flat in vec3  vColor3;  // cosmetic: palette color 3 (pads repeat the last color)
flat in float vColorCount; // active palette size (1..4)
flat in float vSpeed;   // cosmetic: animation-speed multiplier
flat in float vTransSpeed; // cosmetic: palette step rate (colors/s)
flat in float vThickness; // ring band thickness / avg sparkle size (world tiles)
flat in float vCell;    // sparkles: grid pitch (front-normalized units)
flat in float vRadius;  // current front radius (world tiles)

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

// Sparkles — a firework burst: glints start at the center and ride outward
// with the expanding front (fixed positions in front-normalized space, so
// world position = normalized position · radius), reaching the cosmetic's
// full size at fade-out. One candidate glint per normalized grid cell
// (jittered but confined to its cell so each fragment samples only its own
// cell; the pitch vCell comes from the cosmetic's density). Glints keep a
// constant world size (hash-varied ±50% around vThickness, so thickness is
// the average sparkle size) once the burst outgrows the grid; while it's
// young they're capped to their cell, so the early burst reads as a dense
// compact cluster. Each glint twinkles on a hashed phase and takes a hashed
// palette color; the palette cycle advances at transitionSpeed steps/s on
// top of that offset.
void sparkles() {
  float cell = max(vCell, 0.001); // grid pitch (front-normalized units)
  // Rotate the grid off the world axes so the young, dense burst doesn't
  // read as a lattice (the disc cull below is rotation-invariant).
  const mat2 ROT = mat2(0.8253, -0.5646, 0.5646, 0.8253);
  vec2 gp = ROT * vLocalPos;
  vec2 cid = floor(gp / cell);
  float h1 = hash11(dot(cid, vec2(157.0, 113.0)) + 41.7);
  float h2 = hash11(h1 * 251.0 + 7.3);
  float h3 = hash11(h2 * 199.0 + 3.1);
  float h4 = hash11(h3 * 173.0 + 11.3);
  float h5 = hash11(h4 * 149.0 + 5.7);

  // Drop ~1/3 of cells — an organic scatter, not one glint per cell.
  if (h3 < 0.33) discard;

  // Glint radius: constant world size, hash-varied ±50% per glint so
  // vThickness is the AVERAGE sparkle size, and capped to its cell. The
  // jitter amplitude is fixed (cap + jitter = half a cell exactly) so glint
  // positions don't drift as the cap relaxes with the growing radius.
  float rs = min(
    0.5 * vThickness * (0.5 + h5) / max(vRadius, 0.001),
    0.35 * cell);
  vec2 center = (cid + 0.5) * cell + (vec2(h1, h2) - 0.5) * 0.3 * cell;

  // Glints outside the unit disc are culled so the burst stays circular.
  if (length(center) > 1.0) discard;

  // Hashed birth stagger so glints pop in over the first fifth of the life
  // instead of the whole disc appearing at once.
  float lifeT = 1.0 - vAlpha;
  float birth = smoothstep(h4 * 0.2, h4 * 0.2 + 0.08, lifeT);
  if (birth <= 0.0) discard;

  // Solid glint core with a thin anti-aliased rim — glints render fully
  // opaque (the twinkle modulates color brightness, not alpha), holding full
  // opacity through life and fading only over the last quarter.
  float g = clamp((1.0 - length(gp - center) / max(rs, 1e-4)) * 3.0, 0.0, 1.0);
  float tt = uTime * vSpeed;
  float tw = 0.35 +
             0.65 * pow(0.5 + 0.5 * sin(6.2832 * (h3 + tt * (1.5 + h1))), 2.0);
  float endFade = smoothstep(0.0, 0.25, vAlpha);

  float glow = g * birth * endFade;
  if (glow < 0.01) discard;

  // Whole palette steps per glint (floor) keep static colors exact; the cycle
  // blends between steps at transitionSpeed steps/s (0 = static hashed color,
  // negative = reverse), like the EMP base color.
  float idx = uTime * vTransSpeed + floor(h2 * vColorCount);
  vec3 base = mix(
    colorAt(mod(floor(idx), vColorCount)),
    colorAt(mod(floor(idx) + 1.0, vColorCount)),
    fract(idx));
  // Twinkle lives in the color: peaks flare toward white, troughs dim the
  // base — alpha stays saturated so the glints read solid.
  vec3 col = mix(base * (0.7 + 0.3 * tw), vec3(1.0), 0.5 * tw);

  fragColor = vec4(col, clamp(glow, 0.0, 1.0));
}

void main() {
  float dist = length(vLocalPos);
  if (vStyle > 1.5) {
    sparkles();
  } else if (vStyle > 0.5) {
    empPulse(dist);
  } else {
    classicRing(dist);
  }
}
