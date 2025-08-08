/**
 * @jest-environment jsdom
 */
import { MouseMoveEvent } from "../../../../src/client/InputHandler";
import { TransformHandler } from "../../../../src/client/graphics/TransformHandler";
import { PlayerInfoManager } from "../../../../src/client/graphics/layers/PlayerInfoManager";
import { PlayerInfoService } from "../../../../src/client/graphics/layers/PlayerInfoService";
import { EventBus } from "../../../../src/core/EventBus";
import { GameView } from "../../../../src/core/game/GameView";

jest.mock("../../../../src/client/graphics/layers/PlayerInfoService");

describe("PlayerInfoManager", () => {
  let game: GameView;
  let transform: TransformHandler;
  let eventBus: EventBus;
  let playerInfoManager: PlayerInfoManager;
  let mockPlayerInfoService: jest.Mocked<PlayerInfoService>;

  beforeEach(() => {
    game = {} as GameView;
    transform = {} as TransformHandler;
    eventBus = {
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    mockPlayerInfoService = {
      getHoverInfo: jest.fn().mockResolvedValue({
        player: null,
        playerProfile: null,
        unit: null,
        mouseX: 0,
        mouseY: 0,
      }),
    } as any;

    (
      PlayerInfoService as jest.MockedClass<typeof PlayerInfoService>
    ).mockImplementation(() => mockPlayerInfoService);

    PlayerInfoManager["instance"] = null;
    playerInfoManager = PlayerInfoManager.getInstance(
      game,
      transform,
      eventBus,
    );
  });

  afterEach(() => {
    playerInfoManager.destroy();
  });

  it("should create singleton instance", () => {
    const instance1 = PlayerInfoManager.getInstance(game, transform, eventBus);
    const instance2 = PlayerInfoManager.getInstance(game, transform, eventBus);

    expect(instance1).toBe(instance2);
  });

  it("should initialize and setup event listeners", () => {
    playerInfoManager.init();

    expect(eventBus.on).toHaveBeenCalledWith(
      MouseMoveEvent,
      expect.any(Function),
    );
  });

  it("should destroy and cleanup properly", () => {
    playerInfoManager.init();
    playerInfoManager.destroy();

    expect(eventBus.off).toHaveBeenCalledWith(
      MouseMoveEvent,
      expect.any(Function),
    );
  });

  it("should subscribe and unsubscribe to data updates", () => {
    const callback = jest.fn();

    playerInfoManager.subscribeToData(callback);
    expect(callback).not.toHaveBeenCalled();

    playerInfoManager.unsubscribeFromData(callback);
  });

  it("should subscribe and unsubscribe to mouse updates", () => {
    const callback = jest.fn();

    playerInfoManager.subscribeToMouse(callback);
    expect(callback).toHaveBeenCalledWith(0, 0);

    playerInfoManager.unsubscribeFromMouse(callback);
  });

  it("should handle mouse move events", async () => {
    const dataCallback = jest.fn();
    const mouseCallback = jest.fn();

    playerInfoManager.init();
    playerInfoManager.subscribeToData(dataCallback);
    playerInfoManager.subscribeToMouse(mouseCallback);

    const mouseMoveEvent = new MouseMoveEvent(100, 200);
    const onMouseMoveCallback = (eventBus.on as jest.Mock).mock.calls.find(
      (call) => call[0] === MouseMoveEvent,
    )[1];

    await onMouseMoveCallback(mouseMoveEvent);

    expect(mouseCallback).toHaveBeenCalledWith(100, 200);
    expect(mockPlayerInfoService.getHoverInfo).toHaveBeenCalledWith(100, 200);
  });

  it("should throttle data updates", async () => {
    playerInfoManager.init();

    const mouseMoveEvent1 = new MouseMoveEvent(100, 200);
    const mouseMoveEvent2 = new MouseMoveEvent(101, 201);

    const onMouseMoveCallback = (eventBus.on as jest.Mock).mock.calls.find(
      (call) => call[0] === MouseMoveEvent,
    )[1];

    await onMouseMoveCallback(mouseMoveEvent1);
    await onMouseMoveCallback(mouseMoveEvent2);

    expect(mockPlayerInfoService.getHoverInfo).toHaveBeenCalledTimes(1);
  });

  it("should notify data subscribers when hover info changes", async () => {
    const callback = jest.fn();
    const mockHoverInfo = {
      player: { name: () => "TestPlayer" } as any,
      playerProfile: null,
      unit: null,
      mouseX: 100,
      mouseY: 200,
    };

    mockPlayerInfoService.getHoverInfo.mockResolvedValue(mockHoverInfo);

    playerInfoManager.init();
    playerInfoManager.subscribeToData(callback);

    const mouseMoveEvent = new MouseMoveEvent(100, 200);
    const onMouseMoveCallback = (eventBus.on as jest.Mock).mock.calls.find(
      (call) => call[0] === MouseMoveEvent,
    )[1];

    await onMouseMoveCallback(mouseMoveEvent);

    expect(callback).toHaveBeenCalledWith(mockHoverInfo);
  });

  it("should provide access to player info service", () => {
    const service = playerInfoManager.getPlayerInfoService();
    expect(service).toBe(mockPlayerInfoService);
  });

  it("should handle multiple subscribers correctly", () => {
    const dataCallback1 = jest.fn();
    const dataCallback2 = jest.fn();
    const mouseCallback1 = jest.fn();
    const mouseCallback2 = jest.fn();

    playerInfoManager.subscribeToData(dataCallback1);
    playerInfoManager.subscribeToData(dataCallback2);
    playerInfoManager.subscribeToMouse(mouseCallback1);
    playerInfoManager.subscribeToMouse(mouseCallback2);

    expect(mouseCallback1).toHaveBeenCalledWith(0, 0);
    expect(mouseCallback2).toHaveBeenCalledWith(0, 0);

    playerInfoManager.unsubscribeFromData(dataCallback1);
    playerInfoManager.unsubscribeFromMouse(mouseCallback1);
  });
});
