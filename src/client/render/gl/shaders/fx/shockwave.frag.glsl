#version 300 es
precision highp float;

uniform float uRingWidth;
uniform float uTime;      // seconds — animates procedural styles
uniform int   uNukeStyle; // nuke shockwave preset: 0 = classic ring, 1 = EMP

in vec2  vLocalPos;
flat in float vAlpha;   // 1 - lifetime progress (fades out over the effect)
flat in float vIsNuke;  // 1.0 = nuke event, 0.0 = SAM / other (always classic)

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

// EMP energy pulse — a jagged, crackling cyan ring with rotating lightning
// arcs and a faint trailing energy fill. Drawn with additive blending.
void empPulse(float dist) {
  float ang = atan(vLocalPos.y, vLocalPos.x); // -pi..pi

  // Jagged front: perturb the ideal r=1.0 ring by angular + time noise.
  float n = vnoise(ang * 6.0 + uTime * 6.0)
          + 0.5 * vnoise(ang * 17.0 - uTime * 11.0);
  float ringR = 0.95 + n * 0.05;
  float ringDist = abs(dist - ringR);

  // Thickness flickers per-angle to feel electric.
  float w = uRingWidth * (1.6 + 0.8 * vnoise(ang * 9.0 + uTime * 20.0));
  float ring = 1.0 - smoothstep(0.0, w, ringDist);

  // A couple of bright rotating arcs of "lightning" chasing around the ring.
  float arc = pow(0.5 + 0.5 * sin(ang * 5.0 - uTime * 8.0), 8.0)
            + pow(0.5 + 0.5 * sin(ang * 8.0 + uTime * 13.0), 12.0);

  // Faint inner energy fill trailing behind the front.
  float inner = smoothstep(ringR, 0.0, dist) * 0.12
              * (0.6 + 0.4 * vnoise(ang * 20.0 + uTime * 25.0));

  float glow = ring * (0.8 + arc) + inner;
  if (glow < 0.01) discard;

  // Electric violet ring; only the concentrated lightning arcs flare to
  // lavender-white. Driving the whiten by `arc` (not `ring`) keeps the whole
  // visible ring front purple instead of washing it out.
  vec3 purple = vec3(0.6, 0.1, 1.0);
  float hot = clamp(arc * 0.8, 0.0, 1.0);
  vec3 col = mix(purple, vec3(0.85, 0.7, 1.0), hot);

  // Whole-ring flicker on top of the lifetime fade.
  float life = vAlpha * (0.75 + 0.25 * vnoise(uTime * 30.0));
  fragColor = vec4(col, clamp(glow, 0.0, 1.0) * life);
}

void main() {
  float dist = length(vLocalPos);
  if (vIsNuke > 0.5 && uNukeStyle == 1) {
    empPulse(dist);
  } else {
    classicRing(dist);
  }
}
