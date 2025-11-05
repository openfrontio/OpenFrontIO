import { NightModeLayer } from "../src/client/graphics/layers/NightModeLayer";
import { TransformHandler } from "../src/client/graphics/TransformHandler";

describe("NightModeLayer", () => {
  let layer: NightModeLayer;
  let mockTransformHandler: jest.Mocked<TransformHandler>;
  let mockContext: jest.Mocked<CanvasRenderingContext2D>;

  // Mock MouseEvent for node environment
  class MockMouseEvent {
    type: string;
    clientX: number;
    clientY: number;
    constructor(type: string, init?: { clientX?: number; clientY?: number }) {
      this.type = type;
      this.clientX = init?.clientX ?? 0;
      this.clientY = init?.clientY ?? 0;
    }
  }
  global.MouseEvent = MockMouseEvent as any;

  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = (() => {
      let store: { [key: string]: string } = {};
      return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        clear: () => {
          store = {};
        },
      };
    })();
    Object.defineProperty(global, "localStorage", {
      value: localStorageMock,
      writable: true,
    });

    // Mock document
    const classListMock = {
      add: jest.fn(),
      remove: jest.fn(),
    };
    const documentMock = {
      documentElement: {
        classList: classListMock,
      },
      addEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    Object.defineProperty(global, "document", {
      value: documentMock,
      writable: true,
      configurable: true,
    });

    // Mock TransformHandler
    mockTransformHandler = {
      width: jest.fn().mockReturnValue(1920),
      boundingRect: jest.fn().mockReturnValue({
        left: 0,
        top: 0,
        height: 1080,
      }),
      scale: 20,
    } as any;

    // Mock Canvas Context
    mockContext = {
      fillStyle: "",
      fillRect: jest.fn(),
    } as any;

    localStorage.clear();
  });

  test("adds 'night' class to document when night mode enabled", () => {
    localStorage.setItem("settings.nightMode", "true");

    layer = new NightModeLayer(mockTransformHandler);

    expect(document.documentElement.classList.add).toHaveBeenCalledWith(
      "night",
    );
  });

  test("removes 'night' class from document when night mode disabled", () => {
    localStorage.setItem("settings.nightMode", "false");

    layer = new NightModeLayer(mockTransformHandler);

    expect(document.documentElement.classList.remove).toHaveBeenCalledWith(
      "night",
    );
  });

  test("registers mousemove event listener on construction", () => {
    layer = new NightModeLayer(mockTransformHandler);

    expect(document.addEventListener).toHaveBeenCalledWith(
      "mousemove",
      expect.any(Function),
    );
  });

  test("does not render when night mode disabled", () => {
    localStorage.setItem("settings.nightMode", "false");
    layer = new NightModeLayer(mockTransformHandler);

    layer.renderLayer(mockContext);

    expect(mockContext.fillRect).not.toHaveBeenCalled();
  });

  test("renders dark overlay when night mode enabled", () => {
    localStorage.setItem("settings.nightMode", "true");
    layer = new NightModeLayer(mockTransformHandler);

    // Track fillStyle assignments
    const fillStyleValues: string[] = [];
    let currentFillStyle = "";
    Object.defineProperty(mockContext, "fillStyle", {
      set: (value: string) => {
        fillStyleValues.push(value);
        currentFillStyle = value;
      },
      get: () => currentFillStyle,
      configurable: true,
    });

    // Reset mock to track calls
    mockContext.fillRect.mockClear();

    layer.renderLayer(mockContext);

    // Should fill entire screen with dark overlay as the first call
    expect(mockContext.fillRect).toHaveBeenCalledWith(0, 0, 1920, 1080);

    // Verify the dark overlay fillStyle was set first
    expect(fillStyleValues[0]).toBe("rgba(0, 0, 0, 0.8)");
  });

  test("renders flashlight effect around mouse position", () => {
    localStorage.setItem("settings.nightMode", "true");
    layer = new NightModeLayer(mockTransformHandler);

    // Simulate mouse move to center
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: 960,
      clientY: 540,
    });
    mouseMoveHandler?.(mouseEvent);

    layer.renderLayer(mockContext);

    // Should render multiple tiles (dark overlay + illuminated tiles)
    expect(mockContext.fillRect).toHaveBeenCalled();
    expect(mockContext.fillRect.mock.calls.length).toBeGreaterThan(1);
  });
  test("rendering completes within reasonable time for large canvas", () => {
    localStorage.setItem("settings.nightMode", "true");

    mockTransformHandler = {
      width: jest.fn().mockReturnValue(3840), // 4k
      boundingRect: jest.fn().mockReturnValue({
        left: 0,
        top: 0,
        height: 2160, // 4k
      }),
      scale: 20,
    } as any;

    layer = new NightModeLayer(mockTransformHandler);

    const startTime = performance.now();
    layer.renderLayer(mockContext);
    const endTime = performance.now();

    // Rendering should complete in under 16ms (60fps)
    expect(endTime - startTime).toBeLessThan(16);
  });

  test("flashlight radius limits tile iteration count", () => {
    localStorage.setItem("settings.nightMode", "true");
    layer = new NightModeLayer(mockTransformHandler);

    // Set mouse at edge of screen
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: 0,
      clientY: 0,
    });
    document.dispatchEvent(mouseEvent);

    mockContext.fillRect.mockClear();
    layer.renderLayer(mockContext);

    const callCount = mockContext.fillRect.mock.calls.length;

    // Should only render tiles within flashlight radius, not entire screen
    const maxTilesInRadius = Math.PI * 50 * 50; // π * r²
    expect(callCount).toBeLessThan(maxTilesInRadius * 1.5); // Add buffer for grid cells
  });
  test("handles mouse position at canvas boundaries", () => {
    localStorage.setItem("settings.nightMode", "true");
    layer = new NightModeLayer(mockTransformHandler);

    // Mouse at far right edge
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: 1920,
      clientY: 1080,
    });
    document.dispatchEvent(mouseEvent);

    expect(() => layer.renderLayer(mockContext)).not.toThrow();
  });

  test("handles negative mouse coordinates", () => {
    localStorage.setItem("settings.nightMode", "true");
    layer = new NightModeLayer(mockTransformHandler);

    mockTransformHandler = {
      width: jest.fn().mockReturnValue(1920),
      boundingRect: jest.fn().mockReturnValue({
        left: 0,
        top: 0,
        height: 1080,
      }),
      scale: 20,
    } as any;

    // Mouse outside canvas (negative relative position)
    const mouseEvent = new MouseEvent("mousemove", {
      clientX: 50,
      clientY: 50,
    });
    document.dispatchEvent(mouseEvent);

    expect(() => layer.renderLayer(mockContext)).not.toThrow();
  });

  test("handles zero scale in TransformHandler", () => {
    localStorage.setItem("settings.nightMode", "true");
    mockTransformHandler.scale = 0;

    layer = new NightModeLayer(mockTransformHandler);

    // Should not cause division by zero
    expect(() => layer.renderLayer(mockContext)).not.toThrow();
  });
});
