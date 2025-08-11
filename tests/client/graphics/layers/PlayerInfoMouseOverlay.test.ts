/**
 * @jest-environment jsdom
 */
import { PlayerInfoManager } from "../../../../src/client/graphics/layers/PlayerInfoManager";
import { TransformHandler } from "../../../../src/client/graphics/TransformHandler";
import { ForcePlayerInfoMouseOverlayEvent } from "../../../../src/client/InputHandler";
import { EventBus } from "../../../../src/core/EventBus";
import { Relation } from "../../../../src/core/game/Game";
import {
  GameView,
  PlayerView,
  UnitView,
} from "../../../../src/core/game/GameView";
import { UserSettings } from "../../../../src/core/game/UserSettings";

jest.mock("../../../../src/client/graphics/layers/PlayerInfoManager");

class MockPlayerInfoMouseOverlay {
  public game!: GameView;
  public eventBus!: EventBus;
  public transform!: TransformHandler;
  public userSettings!: UserSettings;

  private mouseX = 0;
  private mouseY = 0;
  private isDragging = false;
  private player: PlayerView | null = null;
  private unit: UnitView | null = null;
  private hasInfo = false;
  private forcePlayerInfoMouseOverlay = false;
  private playerInfoManager: any;
  private _isActive = false;
  private canvas: HTMLCanvasElement | null = null;
  private forceOverlayEventHandler = (
    event: ForcePlayerInfoMouseOverlayEvent,
  ) => this.onForcePlayerInfoMouseOverlayEvent(event);

  init() {
    if (this._isActive) return;

    this.playerInfoManager = PlayerInfoManager.getInstance(
      this.game,
      this.transform,
      this.eventBus,
    );
    this.playerInfoManager.init();
    this.playerInfoManager.subscribeToData(this.onHoverInfoUpdate.bind(this));
    this.playerInfoManager.subscribeToMouse(
      this.onMousePositionUpdate.bind(this),
    );
    this.setupEventListeners();
    this._isActive = true;
  }

  destroy() {
    this.playerInfoManager?.unsubscribeFromData(
      this.onHoverInfoUpdate.bind(this),
    );
    this.playerInfoManager?.unsubscribeFromMouse(
      this.onMousePositionUpdate.bind(this),
    );
    this.eventBus.off(
      ForcePlayerInfoMouseOverlayEvent,
      this.forceOverlayEventHandler,
    );
    this.removeCanvasEventListeners();
    this._isActive = false;
  }

  private onMousePositionUpdate(x: number, y: number) {
    this.mouseX = x;
    this.mouseY = y;
  }

  private onHoverInfoUpdate(hoverInfo: any) {
    this.player = hoverInfo.player;
    this.unit = hoverInfo.unit;
    this.hasInfo = !!(this.player ?? this.unit);
  }

  private onForcePlayerInfoMouseOverlayEvent(
    event: ForcePlayerInfoMouseOverlayEvent,
  ) {
    this.forcePlayerInfoMouseOverlay = event.forcePlayerInfoMouseOverlay;
  }

  connectedCallback() {
    this.setupCanvasEventListeners();
  }

  disconnectedCallback() {
    this.removeCanvasEventListeners();
    if (this.eventBus) {
      this.eventBus.off(
        ForcePlayerInfoMouseOverlayEvent,
        this.forceOverlayEventHandler,
      );
    }
  }

  private setupEventListeners() {
    this.eventBus.on = jest.fn();
    this.eventBus.on(
      ForcePlayerInfoMouseOverlayEvent,
      this.forceOverlayEventHandler,
    );
  }

  private setupCanvasEventListeners() {
    this.canvas = document.querySelector("canvas");
    if (this.canvas) {
      this.canvas.addEventListener(
        "mousedown",
        this.handleMouseDown.bind(this),
      );
      this.canvas.addEventListener("mouseup", this.handleMouseUp.bind(this));
      this.canvas.addEventListener(
        "mouseleave",
        this.handleMouseLeave.bind(this),
      );
    }
  }

  private removeCanvasEventListeners() {
    if (this.canvas) {
      this.canvas.removeEventListener(
        "mousedown",
        this.handleMouseDown.bind(this),
      );
      this.canvas.removeEventListener("mouseup", this.handleMouseUp.bind(this));
      this.canvas.removeEventListener(
        "mouseleave",
        this.handleMouseLeave.bind(this),
      );
      this.canvas = null;
    }
  }

  private handleMouseDown() {
    this.isDragging = true;
  }

  private handleMouseUp() {
    this.isDragging = false;
  }

  private handleMouseLeave() {
    this.isDragging = false;
  }

  private shouldRender(): boolean {
    return (
      this._isActive &&
      (this.userSettings?.showPlayerInfoMouseOverlay() ||
        this.forcePlayerInfoMouseOverlay) &&
      this.hasInfo &&
      !this.isDragging
    );
  }

  private getHudElement(): HTMLElement | null {
    return this.querySelector(".mouse-hud") as HTMLElement;
  }

  private getHUDPosition(): { x: number; y: number } {
    const hudElement = this.getHudElement();
    if (!hudElement) return { x: this.mouseX, y: this.mouseY };

    const w = hudElement.offsetWidth || 200;
    const h = hudElement.offsetHeight || 100;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = this.mouseX - w / 2;
    let y = this.mouseY + 28;

    if (x < 0) x = 10;
    if (x + w > vw) x = vw - w - 10;
    if (y + h > vh) y = this.mouseY - h - 10;
    if (y < 10) y = 10;

    return { x, y };
  }

  querySelector(selector: string): Element | null {
    return {
      offsetWidth: 150,
      offsetHeight: 80,
    } as any;
  }

  tick() {}

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  render() {
    if (!this.shouldRender()) {
      return { strings: [""] };
    }

    const position = this.getHUDPosition();
    const opacity =
      this.isDragging || this.getHudElement() === null ? "0" : "1";
    let content = "";

    if (this.player) {
      content += this.player.name();
    }
    if (this.unit) {
      content += this.unit.type() + "Health: " + this.unit.health();
    }

    return {
      strings: [
        `left: ${position.x}px; top: ${position.y}px; opacity: ${opacity}${content}`,
      ],
    };
  }
}

describe("PlayerInfoMouseOverlay", () => {
  let game: GameView;
  let eventBus: EventBus;
  let transform: TransformHandler;
  let userSettings: UserSettings;
  let overlay: MockPlayerInfoMouseOverlay;
  let mockPlayerInfoManager: any;
  let mockPlayer: PlayerView;
  let mockUnit: UnitView;
  let mockCanvas: HTMLCanvasElement;

  beforeEach(() => {
    game = {} as GameView;
    eventBus = {
      on: jest.fn(),
      off: jest.fn(),
    } as any;
    transform = {} as TransformHandler;

    userSettings = {
      showPlayerInfoMouseOverlay: jest.fn().mockReturnValue(true),
    } as any;

    mockPlayer = {
      name: jest.fn().mockReturnValue("TestPlayer"),
    } as any;

    mockUnit = {
      type: jest.fn().mockReturnValue("Warship"),
      owner: jest.fn().mockReturnValue(mockPlayer),
      hasHealth: jest.fn().mockReturnValue(true),
      health: jest.fn().mockReturnValue(80),
    } as any;

    const mockPlayerInfoService = {
      formatStats: jest.fn().mockReturnValue({
        row1: ["🛡️ 100", "💰 5.0K"],
        row2: ["⚓ 3", "🏙️ 2"],
      }),
      getShortDisplayName: jest.fn().mockReturnValue("TestPlayer"),
      getRelation: jest.fn().mockReturnValue(Relation.Neutral),
      getRelationClass: jest.fn().mockReturnValue("text-white"),
    };

    mockPlayerInfoManager = {
      init: jest.fn(),
      subscribeToData: jest.fn(),
      unsubscribeFromData: jest.fn(),
      subscribeToMouse: jest.fn(),
      unsubscribeFromMouse: jest.fn(),
      getPlayerInfoService: jest.fn().mockReturnValue(mockPlayerInfoService),
    };

    (PlayerInfoManager.getInstance as jest.Mock).mockReturnValue(
      mockPlayerInfoManager,
    );

    mockCanvas = document.createElement("canvas");
    document.querySelector = jest.fn().mockReturnValue(mockCanvas);

    overlay = new MockPlayerInfoMouseOverlay();
    overlay.game = game;
    overlay.eventBus = eventBus;
    overlay.transform = transform;
    overlay.userSettings = userSettings;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("should initialize correctly", () => {
    overlay.init();

    expect(mockPlayerInfoManager.init).toHaveBeenCalled();
    expect(mockPlayerInfoManager.subscribeToData).toHaveBeenCalled();
    expect(mockPlayerInfoManager.subscribeToMouse).toHaveBeenCalled();
  });

  it("should destroy and cleanup properly", () => {
    eventBus.off = jest.fn();
    overlay.eventBus = eventBus;
    overlay.init();
    overlay.destroy();

    expect(mockPlayerInfoManager.unsubscribeFromData).toHaveBeenCalled();
    expect(mockPlayerInfoManager.unsubscribeFromMouse).toHaveBeenCalled();
    expect(eventBus.off).toHaveBeenCalledWith(
      ForcePlayerInfoMouseOverlayEvent,
      overlay["forceOverlayEventHandler"],
    );
  });

  it("should update mouse position", () => {
    overlay.init();
    const mouseCallback =
      mockPlayerInfoManager.subscribeToMouse.mock.calls[0][0];

    mouseCallback(150, 250);

    expect(overlay["mouseX"]).toBe(150);
    expect(overlay["mouseY"]).toBe(250);
  });

  it("should show overlay when hover info contains data", () => {
    overlay.init();
    const dataCallback = mockPlayerInfoManager.subscribeToData.mock.calls[0][0];

    dataCallback({
      player: mockPlayer,
      unit: null,
      mouseX: 100,
      mouseY: 200,
    });

    expect(overlay["player"]).toBe(mockPlayer);
    expect(overlay["hasInfo"]).toBe(true);
  });

  it("should update hover info without checking user settings", () => {
    userSettings.showPlayerInfoMouseOverlay = jest.fn().mockReturnValue(false);
    overlay.init();
    const dataCallback = mockPlayerInfoManager.subscribeToData.mock.calls[0][0];

    dataCallback({
      player: mockPlayer,
      unit: null,
      mouseX: 100,
      mouseY: 200,
    });

    expect(overlay["player"]).toBe(mockPlayer);
    expect(overlay["hasInfo"]).toBe(true);
  });

  it("should show overlay when forced even if user settings disable it", () => {
    userSettings.showPlayerInfoMouseOverlay = jest.fn().mockReturnValue(false);
    overlay.init();
    overlay["hasInfo"] = true;
    overlay["forcePlayerInfoMouseOverlay"] = true;
    overlay["isDragging"] = false;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).not.toBe("");
  });

  it("should handle ForcePlayerInfoMouseOverlayEvent", () => {
    const event = {
      forcePlayerInfoMouseOverlay: true,
    } as ForcePlayerInfoMouseOverlayEvent;

    overlay["onForcePlayerInfoMouseOverlayEvent"](event);

    expect(overlay["forcePlayerInfoMouseOverlay"]).toBe(true);
  });

  it("should setup event bus listener for ForcePlayerInfoMouseOverlayEvent", () => {
    eventBus.on = jest.fn();
    overlay.eventBus = eventBus;

    overlay["setupEventListeners"]();

    expect(eventBus.on).toHaveBeenCalledWith(
      ForcePlayerInfoMouseOverlayEvent,
      expect.any(Function),
    );
  });

  it("should hide overlay when user settings disable it", () => {
    userSettings.showPlayerInfoMouseOverlay = jest.fn().mockReturnValue(false);
    overlay.init();
    overlay["hasInfo"] = true;
    overlay["forcePlayerInfoMouseOverlay"] = false;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toBe("");
  });

  it("should hide overlay when hover info is empty", () => {
    overlay.init();
    const dataCallback = mockPlayerInfoManager.subscribeToData.mock.calls[0][0];

    dataCallback({
      player: null,
      unit: null,
      mouseX: 100,
      mouseY: 200,
    });

    expect(overlay["hasInfo"]).toBe(false);
  });

  it("should setup canvas event listeners on connected", () => {
    const addEventListenerSpy = jest.spyOn(mockCanvas, "addEventListener");

    overlay.connectedCallback();

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
    );
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "mouseup",
      expect.any(Function),
    );
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "mouseleave",
      expect.any(Function),
    );
  });

  it("should remove canvas event listeners on disconnected", () => {
    const removeEventListenerSpy = jest.spyOn(
      mockCanvas,
      "removeEventListener",
    );
    overlay["canvas"] = mockCanvas;

    overlay.disconnectedCallback();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "mouseup",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "mouseleave",
      expect.any(Function),
    );
  });

  it("should handle mouse events for dragging state", () => {
    overlay.connectedCallback();

    expect(overlay["isDragging"]).toBe(false);

    overlay["handleMouseDown"]();
    expect(overlay["isDragging"]).toBe(true);

    overlay["handleMouseUp"]();
    expect(overlay["isDragging"]).toBe(false);

    overlay["handleMouseDown"]();
    overlay["handleMouseLeave"]();
    expect(overlay["isDragging"]).toBe(false);
  });

  it("should calculate HUD position correctly", () => {
    overlay["mouseX"] = 100;
    overlay["mouseY"] = 200;

    Object.defineProperty(window, "innerWidth", {
      value: 1920,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });

    const position = overlay["getHUDPosition"]();

    expect(position.x).toBe(25);
    expect(position.y).toBe(228);
  });

  it("should adjust HUD position when near screen edges", () => {
    overlay["mouseX"] = 50;
    overlay["mouseY"] = 1000;

    Object.defineProperty(window, "innerWidth", {
      value: 1920,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });

    const position = overlay["getHUDPosition"]();

    expect(position.x).toBe(10);
    expect(position.y).toBe(910);
  });

  it("should render player info correctly", () => {
    overlay.init();
    overlay["player"] = mockPlayer;
    overlay["hasInfo"] = true;
    overlay["isDragging"] = false;
    overlay["mouseX"] = 100;
    overlay["mouseY"] = 200;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toContain("TestPlayer");
  });

  it("should render unit info correctly", () => {
    overlay.init();
    overlay["unit"] = mockUnit;
    overlay["hasInfo"] = true;
    overlay["isDragging"] = false;
    overlay["mouseX"] = 100;
    overlay["mouseY"] = 200;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toContain("Warship");
    expect(htmlString).toContain("Health: 80");
  });

  it("should include opacity in render output", () => {
    overlay.init();
    overlay["player"] = mockPlayer;
    overlay["hasInfo"] = true;
    overlay["isDragging"] = false;
    overlay["mouseX"] = 100;
    overlay["mouseY"] = 200;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toContain("opacity: 1");
  });

  it("should set opacity to 0 when dragging", () => {
    overlay.init();
    overlay["player"] = mockPlayer;
    overlay["hasInfo"] = true;
    overlay["isDragging"] = true;
    overlay["mouseX"] = 100;
    overlay["mouseY"] = 200;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toBe("");
  });

  it("should not render when user settings disable overlay", () => {
    userSettings.showPlayerInfoMouseOverlay = jest.fn().mockReturnValue(false);

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toBe("");
  });

  it("should not render when not visible", () => {
    overlay.init();
    overlay["hasInfo"] = false;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toBe("");
  });

  it("should not render when dragging", () => {
    overlay.init();
    overlay["isDragging"] = true;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toBe("");
  });

  it("should handle tick updates", () => {
    expect(() => overlay.tick()).not.toThrow();
  });

  it("should handle empty render layer", () => {
    const mockContext = {} as CanvasRenderingContext2D;

    expect(() => overlay.renderLayer(mockContext)).not.toThrow();
  });

  it("should not transform", () => {
    expect(overlay.shouldTransform()).toBe(false);
  });

  it("should not initialize if already active", () => {
    overlay.init();
    const firstManagerCall = mockPlayerInfoManager.init.mock.calls.length;

    overlay.init();

    expect(mockPlayerInfoManager.init.mock.calls.length).toBe(firstManagerCall);
  });

  it("should unsubscribe from event bus in disconnectedCallback", () => {
    eventBus.off = jest.fn();
    overlay.eventBus = eventBus;

    overlay.disconnectedCallback();

    expect(eventBus.off).toHaveBeenCalledWith(
      ForcePlayerInfoMouseOverlayEvent,
      overlay["forceOverlayEventHandler"],
    );
  });

  it("should not call eventBus.off if eventBus is null in disconnectedCallback", () => {
    overlay.eventBus = null as any;

    expect(() => overlay.disconnectedCallback()).not.toThrow();
  });

  it("should adjust HUD position when y is below margin", () => {
    overlay["mouseX"] = 100;
    overlay["mouseY"] = -25;

    Object.defineProperty(window, "innerWidth", {
      value: 1920,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1080,
      configurable: true,
    });

    const position = overlay["getHUDPosition"]();

    expect(position.y).toBe(10);
  });
});
