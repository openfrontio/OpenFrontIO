// Minimal 2D canvas mock for jsdom so graphics unit tests can run
const ctx: Partial<CanvasRenderingContext2D> = {
  clearRect: jest.fn(),
  fillRect: jest.fn(),
  beginPath: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  stroke: jest.fn(),
  rect: jest.fn(),
  clip: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  translate: jest.fn(),
  scale: jest.fn(),
  drawImage: jest.fn(),
  getImageData: jest.fn().mockReturnValue({ data: [] }),
  putImageData: jest.fn(),
  createLinearGradient: jest.fn().mockReturnValue({
    addColorStop: jest.fn(),
  }),
  createPattern: jest.fn().mockReturnValue(null),
  lineWidth: 1,
};

let _fillStyle: string | CanvasGradient | CanvasPattern = "";
Object.defineProperty(ctx, "fillStyle", {
  get: () => _fillStyle,
  set: (v) => {
    _fillStyle = v;
  },
  configurable: true,
});

if (typeof (global as any).HTMLCanvasElement === "undefined") {
  (global as any).HTMLCanvasElement = class {};
}

Object.defineProperty(
  (global as any).HTMLCanvasElement.prototype,
  "getContext",
  {
    value: function getContext(type: string) {
      if (type === "2d") return ctx as CanvasRenderingContext2D;
      return null;
    },
  },
);
