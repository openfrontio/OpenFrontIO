/**
 * @jest-environment jsdom
 */
import { WarshipRadiusLayer } from "../../../src/client/graphics/layers/WarshipRadiusLayer";
import {
  MouseMoveEvent,
  UnitSelectionEvent,
} from "../../../src/client/InputHandler";
import { UnitType } from "../../../src/core/game/Game";

// Mock gradient object
const mockGradient = {
  addColorStop: jest.fn(),
};

// Mock canvas context since jsdom doesn't support it
const mockContext = {
  clearRect: jest.fn(),
  save: jest.fn(),
  restore: jest.fn(),
  beginPath: jest.fn(),
  closePath: jest.fn(),
  rect: jest.fn(),
  arc: jest.fn(),
  arcTo: jest.fn(),
  moveTo: jest.fn(),
  lineTo: jest.fn(),
  stroke: jest.fn(),
  fill: jest.fn(),
  setLineDash: jest.fn(),
  createRadialGradient: jest.fn().mockReturnValue(mockGradient),
  lineDashOffset: 0,
  lineWidth: 1,
  strokeStyle: "",
  fillStyle: "",
};

// Store original createElement
const originalCreateElement = document.createElement.bind(document);

describe("WarshipRadiusLayer", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;
  let uiState: any;
  let layer: WarshipRadiusLayer;

  beforeAll(() => {
    // Mock createElement to return a canvas with working getContext
    jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      const element = originalCreateElement(tagName);
      if (tagName === "canvas") {
        (element as HTMLCanvasElement).getContext = jest
          .fn()
          .mockReturnValue(mockContext);
      }
      return element;
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    // Reset mock context
    Object.values(mockContext).forEach((fn) => {
      if (typeof fn === "function") {
        (fn as jest.Mock).mockClear();
      }
    });

    game = {
      width: () => 100,
      height: () => 100,
      config: () => ({
        warshipPatrolRange: () => 50,
        warshipTargettingRange: () => 130,
      }),
      x: (tile: any) => 10,
      y: (tile: any) => 10,
    };
    eventBus = { on: jest.fn() };
    transformHandler = {
      hasChanged: () => false,
      boundingRect: () => ({ left: 0, top: 0 }),
      screenToWorldCoordinates: (x: number, y: number) => ({ x, y }),
    };
    uiState = { ghostStructure: null };

    layer = new WarshipRadiusLayer(game, eventBus, transformHandler, uiState);
  });

  it("should initialize canvas with correct dimensions", () => {
    expect(layer["canvas"].width).toBe(100);
    expect(layer["canvas"].height).toBe(100);
    expect(layer["context"]).not.toBeNull();
  });

  it("should register event listeners on init", () => {
    layer.init();
    expect(eventBus.on).toHaveBeenCalledTimes(2);
    expect(eventBus.on).toHaveBeenCalledWith(
      UnitSelectionEvent,
      expect.any(Function),
    );
    expect(eventBus.on).toHaveBeenCalledWith(
      MouseMoveEvent,
      expect.any(Function),
    );
  });

  it("should handle warship selection", () => {
    const unit = {
      type: () => UnitType.Warship,
      isActive: () => true,
      patrolTile: () => ({ x: 10, y: 10 }),
    };

    layer["handleUnitSelection"]({
      unit,
      isSelected: true,
    } as unknown as UnitSelectionEvent);

    expect(layer["selectedWarship"]).toBe(unit);
    expect(layer["selectedShow"]).toBe(true);
  });

  it("should handle warship deselection", () => {
    const unit = {
      type: () => UnitType.Warship,
      isActive: () => true,
      patrolTile: () => ({ x: 10, y: 10 }),
    };

    // First select
    layer["handleUnitSelection"]({
      unit,
      isSelected: true,
    } as unknown as UnitSelectionEvent);

    // Then deselect
    layer["handleUnitSelection"]({
      unit,
      isSelected: false,
    } as unknown as UnitSelectionEvent);

    expect(layer["selectedWarship"]).toBeNull();
    expect(layer["selectedShow"]).toBe(false);
  });

  it("should ignore selection of non-warship units", () => {
    const unit = {
      type: () => UnitType.Port,
      isActive: () => true,
    };

    layer["handleUnitSelection"]({
      unit,
      isSelected: true,
    } as unknown as UnitSelectionEvent);

    expect(layer["selectedWarship"]).toBeNull();
    expect(layer["selectedShow"]).toBe(false);
  });

  it("should track mouse position when warship is selected", () => {
    // Select a warship first
    layer["selectedShow"] = true;

    layer["handleMouseMove"]({ x: 50, y: 60 } as MouseMoveEvent);

    expect(layer["mouseWorldPos"]).toEqual({ x: 50, y: 60 });
  });

  it("should not track mouse position when no warship selected and not in ghost mode", () => {
    layer["selectedShow"] = false;
    layer["ghostShow"] = false;

    layer["handleMouseMove"]({ x: 50, y: 60 } as MouseMoveEvent);

    expect(layer["mouseWorldPos"]).toBeNull();
  });

  it("should track mouse position in ghost mode", () => {
    layer["ghostShow"] = true;

    layer["handleMouseMove"]({ x: 50, y: 60 } as MouseMoveEvent);

    expect(layer["mouseWorldPos"]).toEqual({ x: 50, y: 60 });
  });

  it("should detect ghost mode from uiState", () => {
    uiState.ghostStructure = UnitType.Warship;

    layer.tick();

    expect(layer["ghostShow"]).toBe(true);
  });

  it("should clear mouse position when ghost mode ends", () => {
    // Start in ghost mode with mouse position
    layer["ghostShow"] = true;
    layer["mouseWorldPos"] = { x: 50, y: 60 };

    // End ghost mode
    uiState.ghostStructure = null;
    layer.tick();

    expect(layer["ghostShow"]).toBe(false);
    expect(layer["mouseWorldPos"]).toBeNull();
  });

  it("should clear selection when warship becomes inactive", () => {
    const unit = {
      type: () => UnitType.Warship,
      isActive: () => true,
      patrolTile: () => ({ x: 10, y: 10 }),
    };

    layer["selectedWarship"] = unit as any;
    layer["selectedShow"] = true;

    // Warship becomes inactive
    unit.isActive = () => false;
    layer.tick();

    expect(layer["selectedWarship"]).toBeNull();
    expect(layer["selectedShow"]).toBe(false);
  });

  it("should return true for shouldTransform", () => {
    expect(layer.shouldTransform()).toBe(true);
  });
});
