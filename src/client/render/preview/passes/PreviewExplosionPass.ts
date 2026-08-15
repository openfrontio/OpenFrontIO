/**
 * PreviewExplosionPass — renders multi-style shockwave rings, roiling fireballs, and lingering smoke FX.
 */

import { createMapQuad, createProgram } from "../../gl/utils/GlUtils";

const vertSrc = `#version 300 es
layout(location = 0) in vec2 aPos;

uniform mat3 uCamera;
uniform vec2 uMapSize;

out vec2 vWorldPos;

void main() {
  vWorldPos = aPos * uMapSize;
  vec3 clip = uCamera * vec3(vWorldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

const fragSrc = `#version 300 es
precision highp float;

in vec2 vWorldPos;

uniform vec2 uCenter;
uniform float uRadius;
uniform float uProgress;
uniform vec3 uColor;
uniform float uTime;

out vec4 fragColor;

// 1D Hash
float hash1(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

// 2D Value Noise
float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash1(dot(i, vec2(1.0, 57.0)));
  float b = hash1(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = hash1(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = hash1(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Multi-octave broiling flame turbulence
float fbmBroil(vec2 p, float t) {
  float v = 0.0;
  v += 0.500 * noise2d(p * 1.0 + vec2(0.0, t * 2.0));
  v += 0.250 * noise2d(p * 2.1 - vec2(t * 1.5, 0.0));
  v += 0.125 * noise2d(p * 4.3 + vec2(t * 3.0, t * 1.0));
  return v;
}

void main() {
  vec2 delta = vWorldPos - uCenter;
  float dist = length(delta);
  if (dist > uRadius + 18.0 || uRadius <= 0.5) {
    discard;
  }

  float ang = atan(delta.y, delta.x);
  float normDist = dist / max(uRadius, 1.0);

  // 1. Expanding Shockwave Ring (with high-frequency crackle)
  float rimW = max(3.0, uRadius * 0.09);
  float crackle = noise2d(vec2(ang * 8.0, uProgress * 15.0)) * 0.15;
  float shockwave = smoothstep(uRadius - rimW - crackle * 4.0, uRadius, dist) * 
                    smoothstep(uRadius + 2.5 + crackle * 2.0, uRadius, dist);

  // 2. Inner Boiling Fireball & Plasma Cloud
  float broil = fbmBroil(delta * 0.1, uTime * 3.0);
  float flameR = uRadius * (0.65 + broil * 0.35);
  float flameCore = smoothstep(flameR, 0.0, dist);
  float fireIntensity = pow(flameCore, 1.8) * (1.2 + broil * 0.6);

  // 3. Lingering Dark Fallout Smoke & Ash Soot
  float smokeNoise = fbmBroil(delta * 0.06, uTime * 0.8);
  float smokeR = uRadius * (0.85 + smokeNoise * 0.3);
  float smokeCloud = smoothstep(smokeR, 0.0, dist) * (0.4 + smokeNoise * 0.5);

  float fade = clamp(1.0 - uProgress, 0.0, 1.0);
  
  // Early explosive flash vs late lingering smoke
  float flashPhase = smoothstep(0.4, 0.0, uProgress);
  float smokePhase = smoothstep(0.1, 0.7, uProgress) * (1.0 - pow(uProgress, 2.0));

  // Color composition:
  // Core = Incandescent white flash -> Blazing flame orange -> Custom cosmetic color -> Dark fallout smoke
  vec3 whiteHot = vec3(1.0, 0.98, 0.92);
  vec3 fireOrange = vec3(1.0, 0.42, 0.08);
  vec3 smokeColor = vec3(0.18, 0.16, 0.15);

  vec3 col = mix(fireOrange, uColor, smoothstep(0.2, 0.8, normDist));
  col = mix(col, whiteHot, clamp(fireIntensity * flashPhase * 1.5, 0.0, 1.0));
  col = mix(col, smokeColor, clamp(smokePhase * (1.0 - flashPhase) * 0.85, 0.0, 0.9));

  float totalAlpha = (shockwave * 2.2 * fade) + 
                     (fireIntensity * 1.8 * fade) + 
                     (smokeCloud * 0.75 * smokePhase);

  fragColor = vec4(col, clamp(totalAlpha, 0.0, 0.96));
}
`;

export interface ExplosionData {
  x: number;
  y: number;
  radius: number;
  progress: number;
  color: readonly [number, number, number];
}

export class PreviewExplosionPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;
  private uProgress: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
  ) {
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.vao = createMapQuad(gl, 1, 1);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uRadius = gl.getUniformLocation(this.program, "uRadius")!;
    this.uProgress = gl.getUniformLocation(this.program, "uProgress")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
  }

  draw(
    cameraMatrix: Float32Array,
    explosions: ExplosionData[],
    now: number,
  ): void {
    if (explosions.length === 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uTime, now / 1000);
    gl.bindVertexArray(this.vao);

    for (const exp of explosions) {
      if (exp.radius <= 0 || exp.progress >= 1) continue;
      gl.uniform2f(this.uCenter, exp.x, exp.y);
      gl.uniform1f(this.uRadius, exp.radius);
      gl.uniform1f(this.uProgress, exp.progress);
      gl.uniform3fv(this.uColor, exp.color);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
