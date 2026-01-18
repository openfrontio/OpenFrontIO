export type RendererType = "Canvas2D" | "WebGL1" | "WebGL2";

export interface BrowserInfo {
  engine: string;
  platform: string;
  os: string;
  dpr: number;
}

export interface GraphicsDiagnostics {
  browser: BrowserInfo;
  rendering: RenderingInfo;
  power: PowerInfo;
}

export interface GPUInfo {
  vendor?: string;
  renderer?: string;
  software?: boolean;
  unavailable?: boolean;
}

export interface RenderingInfo {
  type: RendererType;
  antialias?: boolean;
  maxTextureSize?: number;
  shaderHighp?: boolean;
  gpu?: GPUInfo;
}

export interface PerformanceInfo {
  fps: number;
  worstFrameMs: number;
  jankPercent: number;
  throttlingLikely: boolean;
}

export interface PowerInfo {
  charging?: boolean;
  level?: string;
  unavailable?: boolean;
}

export async function collectGraphicsDiagnostics(
  canvas: HTMLCanvasElement,
): Promise<GraphicsDiagnostics> {
  /* ---------- Browser / OS ---------- */

  const uaData = (navigator as any).userAgentData;

  const os = uaData?.platform ?? detectOS(navigator.userAgent);

  const browser: BrowserInfo = {
    engine: uaData?.brands
      ? uaData.brands.map((b: any) => b.brand).join(", ")
      : navigator.userAgent,
    platform: navigator.platform,
    os,
    dpr: window.devicePixelRatio,
  };

  /* ---------- Rendering ---------- */

  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  let type: RendererType = "Canvas2D";

  gl =
    canvas.getContext("webgl2", { antialias: true }) ??
    canvas.getContext("webgl", { antialias: true });

  if (gl) {
    type = gl instanceof WebGL2RenderingContext ? "WebGL2" : "WebGL1";
  }

  const rendering: RenderingInfo = { type };

  if (gl) {
    rendering.antialias = gl.getContextAttributes()?.antialias ?? false;
    rendering.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

    const precision = gl.getShaderPrecisionFormat(
      gl.FRAGMENT_SHADER,
      gl.HIGH_FLOAT,
    );
    rendering.shaderHighp = precision !== null && precision.precision > 0;

    const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");

    if (debugInfo) {
      const renderer = gl.getParameter(
        (debugInfo as any).UNMASKED_RENDERER_WEBGL,
      ) as string;

      const vendor = gl.getParameter(
        (debugInfo as any).UNMASKED_VENDOR_WEBGL,
      ) as string;
      rendering.gpu = {
        vendor,
        renderer,
        software: /swiftshader|llvmpipe|software/i.test(renderer),
      };
    } else {
      rendering.gpu = { unavailable: true };
    }
  }

  /* ---------- Power ---------- */

  let power: PowerInfo = {};

  if ("getBattery" in navigator) {
    try {
      const battery = await (navigator as any).getBattery();
      power = {
        charging: battery.charging,
        level: Math.round(battery.level * 100) + "%",
      };
    } catch {
      power = { unavailable: true };
    }
  } else {
    power = { unavailable: true };
  }
  return {
    browser,
    rendering,
    power,
  };
}

function detectOS(ua: string): string {
  if (/windows nt/i.test(ua)) return "Windows";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Unknown";
}
