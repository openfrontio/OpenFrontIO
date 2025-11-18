/**
 * @jest-environment jsdom
 */

import { SAMRadiusLayer } from "../../../src/client/graphics/layers/SAMRadiusLayer";
import type { TransformHandler } from "../../../src/client/graphics/TransformHandler";
import type { UIState } from "../../../src/client/graphics/UIState";
import { ToggleStructureEvent } from "../../../src/client/InputHandler";
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

describe("SAMRadiusLayer visibility controls", () => {
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

  test("toggle events control SAM stroke visibility", () => {
    const tileRef = 99 as TileRef;
    const samUnit = createSamUnit(tileRef, 42);

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

    const transformHandler = {
      screenToWorldCoordinates: jest.fn().mockReturnValue({ x: 5, y: 6 }),
      hasChanged: jest.fn(() => false),
      scale: 1,
    } as unknown as TransformHandler;

    const uiState: UIState = {
      attackRatio: 70,
      ghostStructure: null,
    };

    const eventBus = new EventBus();
    const layer = new SAMRadiusLayer(game, eventBus, transformHandler, uiState);
    layer.init();

    expect((layer as any).showStroke).toBe(false);

    eventBus.emit(new ToggleStructureEvent([UnitType.SAMLauncher]));

    expect((layer as any).showStroke).toBe(true);
    expect((layer as any).needsRedraw).toBe(true);

    eventBus.emit(new ToggleStructureEvent(null));

    expect((layer as any).showStroke).toBe(false);
  });

  test("ghost structures force SAM stroke visibility during tick", () => {
    const game = {
      width: () => 256,
      height: () => 256,
      isValidCoord: jest.fn(() => true),
      units: jest.fn(() => []),
      x: jest.fn(() => 5),
      y: jest.fn(() => 6),
      config: () => createConfig(),
      updatesSinceLastTick: jest.fn(() => null),
      myPlayer: () => ({ smallID: () => 7 }),
    } as unknown as GameView;

    const transformHandler = {
      screenToWorldCoordinates: jest.fn().mockReturnValue({ x: 5, y: 6 }),
      hasChanged: jest.fn(() => false),
      scale: 1,
    } as unknown as TransformHandler;

    const uiState: UIState = {
      attackRatio: 70,
      ghostStructure: UnitType.SAMLauncher,
    };

    const eventBus = new EventBus();
    const layer = new SAMRadiusLayer(game, eventBus, transformHandler, uiState);
    layer.init();

    expect((layer as any).showStroke).toBe(false);

    layer.tick();

    expect((layer as any).showStroke).toBe(true);

    uiState.ghostStructure = null;
    layer.tick();

    expect((layer as any).showStroke).toBe(false);
  });
});
