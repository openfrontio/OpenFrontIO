type Canvas2D = CanvasRenderingContext2D & {
  __isDeterministicMock?: boolean;
};

const DEFAULT_DATA_URL = "data:image/png;base64,";

const noop = () => {};

const createImageDataLike = (
  width: number,
  height: number,
  source?: Uint8ClampedArray,
): ImageData => {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const data =
    source ?? new Uint8ClampedArray(safeWidth * safeHeight * 4).fill(0);

  if (typeof ImageData === "function") {
    return new ImageData(data, safeWidth, safeHeight);
  }

  return {
    colorSpace: "srgb",
    data,
    height: safeHeight,
    width: safeWidth,
  } as ImageData;
};

const createMockContext = (canvas: HTMLCanvasElement): Canvas2D => {
  let fillStyle: string | CanvasGradient | CanvasPattern = "#000000";
  let strokeStyle: string | CanvasGradient | CanvasPattern = "#000000";
  let lineDashOffset = 0;
  let globalAlpha = 1;
  let lineWidth = 1;
  let font = "10px sans-serif";
  let textAlign: CanvasTextAlign = "start";
  let textBaseline: CanvasTextBaseline = "alphabetic";
  let direction: CanvasDirection = "inherit";
  let globalCompositeOperation: GlobalCompositeOperation = "source-over";
  let filter = "none";
  let imageSmoothingEnabled = true;
  let shadowBlur = 0;
  let shadowColor = "#000000";
  let shadowOffsetX = 0;
  let shadowOffsetY = 0;
  let lineCap: CanvasLineCap = "butt";
  let lineJoin: CanvasLineJoin = "miter";
  let miterLimit = 10;

  const lineDash: number[] = [];

  const gradientFactory = () =>
    ({
      addColorStop: noop,
    }) as CanvasGradient;

  const context = {
    __isDeterministicMock: true,
    arc: noop,
    arcTo: noop,
    beginPath: noop,
    bezierCurveTo: noop,
    canvas,
    clearRect: noop,
    clip: noop,
    closePath: noop,
    createConicGradient: gradientFactory,
    createImageData: (
      widthOrData: number | ImageData,
      height?: number,
    ): ImageData => {
      if (typeof widthOrData === "number") {
        return createImageDataLike(widthOrData, height ?? 1);
      }
      return createImageDataLike(
        widthOrData.width,
        widthOrData.height,
        new Uint8ClampedArray(widthOrData.data),
      );
    },
    createLinearGradient: gradientFactory,
    createPattern: () => null,
    createRadialGradient: gradientFactory,
    drawImage: noop,
    ellipse: noop,
    fill: noop,
    fillRect: noop,
    fillText: noop,
    font,
    getContextAttributes: () => ({ alpha: true, colorSpace: "srgb" }),
    getImageData: (_sx: number, _sy: number, sw: number, sh: number) =>
      createImageDataLike(sw, sh),
    getLineDash: () => [...lineDash],
    getTransform: () =>
      (typeof DOMMatrix === "function"
        ? new DOMMatrix()
        : ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as unknown)) as DOMMatrix,
    isContextLost: () => false,
    isPointInPath: () => false,
    isPointInStroke: () => false,
    lineTo: noop,
    measureText: (text: string) =>
      ({ width: Math.max(0, text.length) * 8 }) as TextMetrics,
    moveTo: noop,
    putImageData: noop,
    quadraticCurveTo: noop,
    rect: noop,
    reset: noop,
    resetTransform: noop,
    restore: noop,
    rotate: noop,
    roundRect: noop,
    save: noop,
    scale: noop,
    setLineDash: (segments: number[]) => {
      lineDash.length = 0;
      lineDash.push(...segments);
    },
    setTransform: noop,
    stroke: noop,
    strokeRect: noop,
    strokeText: noop,
    transform: noop,
    translate: noop,
  } as Record<string, unknown>;

  Object.defineProperties(context, {
    direction: {
      configurable: true,
      enumerable: true,
      get: () => direction,
      set: (value: CanvasDirection) => {
        direction = value;
      },
    },
    fillStyle: {
      configurable: true,
      enumerable: true,
      get: () => fillStyle,
      set: (value: string | CanvasGradient | CanvasPattern) => {
        fillStyle = value;
      },
    },
    filter: {
      configurable: true,
      enumerable: true,
      get: () => filter,
      set: (value: string) => {
        filter = value;
      },
    },
    font: {
      configurable: true,
      enumerable: true,
      get: () => font,
      set: (value: string) => {
        font = value;
      },
    },
    globalAlpha: {
      configurable: true,
      enumerable: true,
      get: () => globalAlpha,
      set: (value: number) => {
        globalAlpha = value;
      },
    },
    globalCompositeOperation: {
      configurable: true,
      enumerable: true,
      get: () => globalCompositeOperation,
      set: (value: GlobalCompositeOperation) => {
        globalCompositeOperation = value;
      },
    },
    imageSmoothingEnabled: {
      configurable: true,
      enumerable: true,
      get: () => imageSmoothingEnabled,
      set: (value: boolean) => {
        imageSmoothingEnabled = value;
      },
    },
    lineCap: {
      configurable: true,
      enumerable: true,
      get: () => lineCap,
      set: (value: CanvasLineCap) => {
        lineCap = value;
      },
    },
    lineDashOffset: {
      configurable: true,
      enumerable: true,
      get: () => lineDashOffset,
      set: (value: number) => {
        lineDashOffset = value;
      },
    },
    lineJoin: {
      configurable: true,
      enumerable: true,
      get: () => lineJoin,
      set: (value: CanvasLineJoin) => {
        lineJoin = value;
      },
    },
    lineWidth: {
      configurable: true,
      enumerable: true,
      get: () => lineWidth,
      set: (value: number) => {
        lineWidth = value;
      },
    },
    miterLimit: {
      configurable: true,
      enumerable: true,
      get: () => miterLimit,
      set: (value: number) => {
        miterLimit = value;
      },
    },
    shadowBlur: {
      configurable: true,
      enumerable: true,
      get: () => shadowBlur,
      set: (value: number) => {
        shadowBlur = value;
      },
    },
    shadowColor: {
      configurable: true,
      enumerable: true,
      get: () => shadowColor,
      set: (value: string) => {
        shadowColor = value;
      },
    },
    shadowOffsetX: {
      configurable: true,
      enumerable: true,
      get: () => shadowOffsetX,
      set: (value: number) => {
        shadowOffsetX = value;
      },
    },
    shadowOffsetY: {
      configurable: true,
      enumerable: true,
      get: () => shadowOffsetY,
      set: (value: number) => {
        shadowOffsetY = value;
      },
    },
    strokeStyle: {
      configurable: true,
      enumerable: true,
      get: () => strokeStyle,
      set: (value: string | CanvasGradient | CanvasPattern) => {
        strokeStyle = value;
      },
    },
    textAlign: {
      configurable: true,
      enumerable: true,
      get: () => textAlign,
      set: (value: CanvasTextAlign) => {
        textAlign = value;
      },
    },
    textBaseline: {
      configurable: true,
      enumerable: true,
      get: () => textBaseline,
      set: (value: CanvasTextBaseline) => {
        textBaseline = value;
      },
    },
  });

  return context as unknown as Canvas2D;
};

const contextByCanvas = new WeakMap<HTMLCanvasElement, Canvas2D>();

const probeCanvasSupport = (): boolean => {
  const testCanvas = document.createElement("canvas");
  try {
    return !!testCanvas.getContext("2d");
  } catch {
    return false;
  }
};

const forceCanvasMock =
  typeof process !== "undefined" &&
  process?.env?.UI_TEST_FORCE_CANVAS_MOCK === "true";
const nativeCanvasAvailable = !forceCanvasMock && probeCanvasSupport();

if (!nativeCanvasAvailable) {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: function getContext(
      this: HTMLCanvasElement,
      contextId: string,
    ): RenderingContext | null {
      if (contextId !== "2d") {
        return null;
      }

      const existing = contextByCanvas.get(this);
      if (existing) {
        return existing;
      }

      const created = createMockContext(this);
      contextByCanvas.set(this, created);
      return created;
    },
    writable: true,
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    value: () => DEFAULT_DATA_URL,
    writable: true,
  });

  Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
    configurable: true,
    value: function toBlob(
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
    ) {
      callback(new Blob([], { type: type ?? "image/png" }));
    },
    writable: true,
  });
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    const normalized = String(key);
    return this.values.has(normalized) ? this.values.get(normalized)! : null;
  }

  key(index: number): string | null {
    if (index < 0 || index >= this.values.size) {
      return null;
    }
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(String(key));
  }

  setItem(key: string, value: string): void {
    this.values.set(String(key), String(value));
  }
}

const hasStorageInterface = (value: unknown): value is Storage => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.getItem === "function" &&
    typeof candidate.setItem === "function" &&
    typeof candidate.removeItem === "function" &&
    typeof candidate.clear === "function" &&
    typeof candidate.key === "function"
  );
};

const installStorageFallback = (name: "localStorage" | "sessionStorage") => {
  let candidate: unknown;
  try {
    candidate = (globalThis as Record<string, unknown>)[name];
  } catch {
    candidate = undefined;
  }

  if (hasStorageInterface(candidate)) {
    return;
  }

  const fallback = new MemoryStorage();

  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: fallback,
    writable: true,
  });

  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      configurable: true,
      value: fallback,
      writable: true,
    });
  }
};

installStorageFallback("localStorage");
installStorageFallback("sessionStorage");
