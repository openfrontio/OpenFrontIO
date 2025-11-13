/**
 * @jest-environment jsdom
 */

import { SAMRadiusLayer } from "../../../src/client/graphics/layers/SAMRadiusLayer";
import type { TransformHandler } from "../../../src/client/graphics/TransformHandler";
import type { UIState } from "../../../src/client/graphics/UIState";
import { MouseMoveEvent } from "../../../src/client/InputHandler";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";
import type { TileRef } from "../../../src/core/game/GameMap";
import type { GameView, UnitView } from "../../../src/core/game/GameView";

const createMockContext = () =>
  ({
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    arc: jest.fn(),
    closePath: jest.fn(),
    fill: jest.fn(),
    stroke: jest.fn(),
    save: jest.fn(),
    restore: jest.fn(),
    setLineDash: jest.fn(),
    lineDashOffset: 0,
    lineWidth: 0,
    strokeStyle: "",
  }) as unknown as CanvasRenderingContext2D;

describe("SAMRadiusLayer hover behaviour", () => {
  let canvasCtxSpy: jest.SpyInstance;

  beforeEach(() => {
    canvasCtxSpy = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => createMockContext() as unknown as any);
  });

  afterEach(() => {
    canvasCtxSpy.mockRestore();
  });

  const createSamUnit = (tile: TileRef, samId = 123, ownerId = 7): UnitView =>
    ({
      id: () => samId,
      tile: () => tile,
      isActive: () => true,
      level: () => 1,
      owner: () => ({ smallID: () => ownerId }) as any,
    }) as unknown as UnitView;

  const createConfig = () => ({
    samRange: () => 70,
  });

  test("sets hoveredSamTarget when pointer moves over an active SAM", () => {
    const tileRef = 99 as TileRef;
    const samId = 42;
    const samUnit = createSamUnit(tileRef, samId);

    const unitsMock = jest
      .fn()
      .mockImplementation((type: UnitType) =>
        type === UnitType.SAMLauncher ? [samUnit] : [],
      );

    const game = {
      width: () => 512,
      height: () => 512,
      isValidCoord: jest.fn(() => true),
      units: unitsMock,
      x: jest.fn(() => 5),
      y: jest.fn(() => 6),
      config: () => createConfig(),
      updatesSinceLastTick: jest.fn(() => null),
      myPlayer: () => ({ smallID: () => 7 }),
    } as unknown as GameView;

    const screenToWorldCoordinates = jest.fn().mockReturnValue({ x: 5, y: 6 });

    const transformHandler = {
      screenToWorldCoordinates,
      hasChanged: jest.fn(() => false),
      scale: 1,
    } as unknown as TransformHandler;

    const uiState: UIState = {
      attackRatio: 70,
      ghostStructure: null,
      hoveredSamTarget: null,
    };

    const eventBus = new EventBus();
    const layer = new SAMRadiusLayer(game, eventBus, transformHandler, uiState);
    layer.init();

    eventBus.emit(new MouseMoveEvent(100, 150, 1));

    expect(uiState.hoveredSamTarget).toBe(samId);
    expect(screenToWorldCoordinates).toHaveBeenCalledWith(100, 150);
    expect(unitsMock).toHaveBeenCalledWith(UnitType.SAMLauncher);
    expect((layer as any).mapHoverShow).toBe(true);
    expect((layer as any).needsRedraw).toBe(true);
  });

  test("clears hoveredSamTarget when pointer leaves valid SAM tile", () => {
    const tileRef = 1337 as TileRef;
    const samId = 77;
    const samUnit = createSamUnit(tileRef, samId);

    const unitsMock = jest
      .fn()
      .mockImplementation((type: UnitType) =>
        type === UnitType.SAMLauncher ? [samUnit] : [],
      );

    const game = {
      width: () => 256,
      height: () => 256,
      isValidCoord: jest
        .fn()
        .mockImplementation((x: number, y: number) => x === 5 && y === 6),
      units: unitsMock,
      x: jest.fn(() => 5),
      y: jest.fn(() => 6),
      config: () => createConfig(),
      updatesSinceLastTick: jest.fn(() => null),
      myPlayer: () => ({ smallID: () => 7 }),
    } as unknown as GameView;

    const screenToWorldCoordinates = jest
      .fn()
      .mockReturnValueOnce({ x: 5, y: 6 })
      .mockReturnValue({ x: 100, y: 100 });

    const transformHandler = {
      screenToWorldCoordinates,
      hasChanged: jest.fn(() => false),
      scale: 1,
    } as unknown as TransformHandler;

    const uiState: UIState = {
      attackRatio: 70,
      ghostStructure: null,
      hoveredSamTarget: null,
    };

    const eventBus = new EventBus();
    const layer = new SAMRadiusLayer(game, eventBus, transformHandler, uiState);
    layer.init();

    eventBus.emit(new MouseMoveEvent(10, 20, 1));
    expect(uiState.hoveredSamTarget).toBe(samId);
    expect((layer as any).mapHoverShow).toBe(true);

    eventBus.emit(new MouseMoveEvent(200, 250, 20));

    expect(uiState.hoveredSamTarget).toBeNull();
    expect((layer as any).mapHoverShow).toBe(false);
    expect(screenToWorldCoordinates).toHaveBeenCalledTimes(2);
  });
});
