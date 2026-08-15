/**
 * PreviewSkinPass — renders territory skins and centered pattern fills over the preview island.
 */

import { base64url } from "jose";
import { PatternDecoder } from "../../../../core/PatternDecoder";
import { createMapQuad, createProgram } from "../../gl/utils/GlUtils";
import {
  PREVIEW_ISLAND_RADIUS,
  PREVIEW_ISLAND_WOBBLE,
} from "../PreviewMapGenerator";

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

uniform sampler2D uSkinTex;
uniform int uHasSkin;
uniform int uIsPattern;
uniform int uIsTeamMode;
uniform vec3 uPrimaryColor;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec2 uPatternTileSize;
uniform float uSkinStampSize;

out vec4 fragColor;

vec3 applySaturation(vec3 rgb, float sat) {
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  return mix(vec3(lum), rgb, sat);
}

void main() {
  vec2 d = vWorldPos - uCenter;
  float dist = length(d);
  
  // Coastline mask matching the procedural archipelago
  float angle = atan(d.y, d.x);
  float wobble = sin(angle * ${PREVIEW_ISLAND_WOBBLE.freq1.toFixed(1)}) * ${PREVIEW_ISLAND_WOBBLE.amp1.toFixed(1)} + cos(angle * ${PREVIEW_ISLAND_WOBBLE.freq2.toFixed(1)}) * ${PREVIEW_ISLAND_WOBBLE.amp2.toFixed(1)};
  float effectiveR = uRadius + wobble;
  
  if (dist > effectiveR) {
    discard;
  }

  // Smooth border edge falloff
  float borderAlpha = smoothstep(effectiveR, effectiveR - 3.5, dist);

  if (uHasSkin == 1) {
    if (uIsPattern == 1) {
      // Centered in-game pattern tile repeat (1 world tile = 1 pixel)
      vec2 tileSize = uPatternTileSize.x > 0.0 ? uPatternTileSize : vec2(32.0);
      vec2 centeredPos = floor(vWorldPos - uCenter + tileSize * 0.5);
      vec2 uv = fract(centeredPos / tileSize);
      vec4 tex = texture(uSkinTex, uv);
      vec3 col = applySaturation(tex.rgb, 0.85);
      // 85% saturation and 60% default opacity
      fragColor = vec4(col, tex.a * 0.60 * borderAlpha);
    } else {
      // Centered skin stamp with proportional world tile size
      float stampSize = uSkinStampSize > 0.0 ? uSkinStampSize : 260.0;
      vec2 skinUV = (vWorldPos - uCenter) / stampSize + vec2(0.5);
      if (skinUV.x >= 0.0 && skinUV.x <= 1.0 && skinUV.y >= 0.0 && skinUV.y <= 1.0) {
        vec4 tex = texture(uSkinTex, skinUV);
        vec3 skinCol = (uIsTeamMode == 1) ? uPrimaryColor * tex.rgb : tex.rgb;
        vec3 col = mix(uPrimaryColor, skinCol, tex.a);
        col = applySaturation(col, 0.85);
        fragColor = vec4(col, 0.60 * borderAlpha);
      } else {
        vec3 col = applySaturation(uPrimaryColor, 0.85);
        fragColor = vec4(col, 0.60 * borderAlpha);
      }
    }
  } else {
    vec3 col = applySaturation(uPrimaryColor, 0.85);
    fragColor = vec4(col, 0.60 * borderAlpha);
  }
}
`;

export class PreviewSkinPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uSkinTex: WebGLUniformLocation;
  private uHasSkin: WebGLUniformLocation;
  private uIsPattern: WebGLUniformLocation;
  private uIsTeamMode: WebGLUniformLocation;
  private uPrimaryColor: WebGLUniformLocation;
  private uCenter: WebGLUniformLocation;
  private uRadius: WebGLUniformLocation;
  private uPatternTileSize: WebGLUniformLocation;
  private uSkinStampSize: WebGLUniformLocation;

  private skinTexture: WebGLTexture | null = null;
  private hasSkin = false;
  private isPattern = false;
  private isTeamMode = false;
  private isDisposed = false;
  private loadToken = 0;
  private patternTileSize: [number, number] = [32, 32];
  private skinStampSize = 260.0;
  private primaryColor: [number, number, number] = [0.2, 0.6, 0.95];

  constructor(
    private gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
  ) {
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.vao = createMapQuad(gl, 1, 1);

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uSkinTex = gl.getUniformLocation(this.program, "uSkinTex")!;
    this.uHasSkin = gl.getUniformLocation(this.program, "uHasSkin")!;
    this.uIsPattern = gl.getUniformLocation(this.program, "uIsPattern")!;
    this.uIsTeamMode = gl.getUniformLocation(this.program, "uIsTeamMode")!;
    this.uPrimaryColor = gl.getUniformLocation(this.program, "uPrimaryColor")!;
    this.uCenter = gl.getUniformLocation(this.program, "uCenter")!;
    this.uRadius = gl.getUniformLocation(this.program, "uRadius")!;
    this.uPatternTileSize = gl.getUniformLocation(
      this.program,
      "uPatternTileSize",
    )!;
    this.uSkinStampSize = gl.getUniformLocation(
      this.program,
      "uSkinStampSize",
    )!;
  }

  setSkinUrl(url?: string): void {
    if (this.isDisposed) return;
    const token = ++this.loadToken;
    if (!url) {
      this.hasSkin = false;
      this.isPattern = false;
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (this.isDisposed || this.loadToken !== token) return;
      const gl = this.gl;
      this.skinTexture ??= gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.skinTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.skinStampSize = 260.0;
      this.hasSkin = true;
      this.isPattern = false;
    };
    img.onerror = () => {
      if (this.isDisposed || this.loadToken !== token) return;
      this.hasSkin = false;
      this.isPattern = false;
    };
    img.src = url;
  }

  setPattern(
    patternData: string,
    colors?: readonly (readonly [number, number, number])[],
  ): void {
    if (this.isDisposed) return;
    this.loadToken++;
    try {
      const decoder = new PatternDecoder(
        {
          name: "preview",
          patternData,
          colorPalette: undefined,
        },
        base64url.decode,
      );

      const pCol = colors && colors.length > 0 ? colors[0] : [0.2, 0.6, 0.95];
      const sCol =
        colors && colors.length > 1
          ? colors[1]
          : [pCol[0] * 0.6, pCol[1] * 0.6, pCol[2] * 0.6];

      const pR = Math.round(pCol[0] * 255);
      const pG = Math.round(pCol[1] * 255);
      const pB = Math.round(pCol[2] * 255);

      const sR = Math.round(sCol[0] * 255);
      const sG = Math.round(sCol[1] * 255);
      const sB = Math.round(sCol[2] * 255);

      const width = decoder.scaledWidth();
      const height = decoder.scaledHeight();
      const pixels = new Uint8Array(width * height * 4);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const isPrimary = decoder.isPrimary(x, y);
          const idx = (y * width + x) * 4;
          pixels[idx + 0] = isPrimary ? pR : sR;
          pixels[idx + 1] = isPrimary ? pG : sG;
          pixels[idx + 2] = isPrimary ? pB : sB;
          pixels[idx + 3] = 255;
        }
      }

      const gl = this.gl;
      this.skinTexture ??= gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.skinTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

      this.patternTileSize = [width, height];
      this.hasSkin = true;
      this.isPattern = true;
    } catch (e) {
      console.warn("Failed to decode pattern in preview:", e);
      this.setPatternColors(colors);
    }
  }

  setPrimaryColor(
    color?: readonly [number, number, number],
    isTeamMode = false,
  ): void {
    if (color) {
      this.primaryColor = [color[0], color[1], color[2]];
    }
    this.isTeamMode = isTeamMode;
  }

  setPatternColors(
    colors?: readonly (readonly [number, number, number])[],
  ): void {
    this.hasSkin = false;
    this.isPattern = false;
    this.isTeamMode = false;
    if (colors && colors.length > 0) {
      this.primaryColor = [colors[0][0], colors[0][1], colors[0][2]];
    }
  }

  draw(cameraMatrix: Float32Array): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform2f(this.uCenter, this.mapW / 2, this.mapH / 2);
    gl.uniform1f(this.uRadius, PREVIEW_ISLAND_RADIUS);
    gl.uniform2fv(this.uPatternTileSize, this.patternTileSize);
    gl.uniform1f(this.uSkinStampSize, this.skinStampSize);

    gl.uniform1i(this.uHasSkin, this.hasSkin ? 1 : 0);
    gl.uniform1i(this.uIsPattern, this.isPattern ? 1 : 0);
    gl.uniform1i(this.uIsTeamMode, this.isTeamMode ? 1 : 0);
    gl.uniform3fv(this.uPrimaryColor, this.primaryColor);

    if (this.hasSkin && this.skinTexture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.skinTexture);
      gl.uniform1i(this.uSkinTex, 0);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    this.isDisposed = true;
    this.loadToken++;
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    if (this.skinTexture) {
      gl.deleteTexture(this.skinTexture);
      this.skinTexture = null;
    }
    this.hasSkin = false;
    this.isPattern = false;
  }
}
