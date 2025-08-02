/**
 * @jest-environment jsdom
 */
import { ContextMenuEvent } from "../../../../src/client/InputHandler";
import { TransformHandler } from "../../../../src/client/graphics/TransformHandler";
import { PlayerInfoManager } from "../../../../src/client/graphics/layers/PlayerInfoManager";
import { EventBus } from "../../../../src/core/EventBus";
import { Relation } from "../../../../src/core/game/Game";
import {
  GameView,
  PlayerView,
  UnitView,
} from "../../../../src/core/game/GameView";
import { UserSettings } from "../../../../src/core/game/UserSettings";

jest.mock("../../../../src/client/graphics/layers/PlayerInfoManager");

class MockPlayerInfoOverlay {
  public game!: GameView;
  public eventBus!: EventBus;
  public transform!: TransformHandler;
  public userSettings!: UserSettings;

  private _isInfoVisible: boolean = false;
  private player: PlayerView | null = null;
  private unit: UnitView | null = null;
  private playerInfoManager: any;
  private _isActive = false;

  init() {
    this.playerInfoManager = PlayerInfoManager.getInstance(
      this.game,
      this.transform,
      this.eventBus,
    );
    this.playerInfoManager.init();
    this.playerInfoManager.subscribeToData(this.onHoverInfoUpdate.bind(this));
    this.setupEventListeners();
    this._isActive = true;
  }

  destroy() {
    this.playerInfoManager?.unsubscribeFromData(
      this.onHoverInfoUpdate.bind(this),
    );
    this._isActive = false;
  }

  private onHoverInfoUpdate(hoverInfo: any) {
    if (!this.userSettings?.showPlayerInfoOverlay()) {
      this.hide();
      return;
    }

    this.player = hoverInfo.player;
    this.unit = hoverInfo.unit;

    if (this.player || this.unit) {
      this.setVisible(true);
    } else {
      this.hide();
    }
  }

  private setupEventListeners() {
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
  }

  public hide() {
    this.setVisible(false);
    this.player = null;
    this.unit = null;
  }

  public async maybeShow(x: number, y: number) {
    this.hide();
    const hoverInfo = await this.playerInfoManager
      .getPlayerInfoService()
      .getHoverInfo(x, y);
    this.onHoverInfoUpdate(hoverInfo);
  }

  setVisible(visible: boolean) {
    this._isInfoVisible = visible;
  }

  tick() {}

  renderLayer(context: CanvasRenderingContext2D) {}

  shouldTransform(): boolean {
    return false;
  }

  requestUpdate() {}

  render() {
    if (!this.userSettings?.showPlayerInfoOverlay()) {
      return { strings: [""] };
    }

    const containerClasses = this._isInfoVisible
      ? "opacity-100 visible"
      : "opacity-0 invisible";
    let content = "";

    if (this.player) {
      content += this.player.name();
    }
    if (this.unit) {
      content += this.unit.type() + this.unit.health();
    }

    return { strings: [containerClasses + content] };
  }
}

describe("PlayerInfoOverlay", () => {
  let game: GameView;
  let eventBus: EventBus;
  let transform: TransformHandler;
  let userSettings: UserSettings;
  let overlay: MockPlayerInfoOverlay;
  let mockPlayerInfoManager: any;
  let mockPlayer: PlayerView;
  let mockUnit: UnitView;

  beforeEach(() => {
    game = {
      config: jest.fn().mockReturnValue({
        isUnitDisabled: jest.fn().mockReturnValue(false),
      }),
      myPlayer: jest.fn().mockReturnValue({
        smallID: jest.fn().mockReturnValue(1),
        isFriendly: jest.fn().mockReturnValue(false),
      }),
    } as any;

    eventBus = {
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    transform = {} as TransformHandler;

    userSettings = {
      showPlayerInfoOverlay: jest.fn().mockReturnValue(true),
    } as any;

    mockPlayer = {
      name: jest.fn().mockReturnValue("TestPlayer"),
      troops: jest.fn().mockReturnValue(100),
      outgoingAttacks: jest.fn().mockReturnValue([{ troops: 50 }]),
      gold: jest.fn().mockReturnValue(5000),
      totalUnitLevels: jest.fn().mockReturnValue(5),
      cosmetics: { flag: "test-flag" },
    } as any;

    mockUnit = {
      type: jest.fn().mockReturnValue("Warship"),
      owner: jest.fn().mockReturnValue(mockPlayer),
      hasHealth: jest.fn().mockReturnValue(true),
      health: jest.fn().mockReturnValue(80),
    } as any;

    const mockPlayerInfoService = {
      getHoverInfo: jest.fn().mockResolvedValue({
        player: null,
        unit: null,
        mouseX: 0,
        mouseY: 0,
      }),
      getRelation: jest.fn().mockReturnValue(Relation.Neutral),
      getRelationClass: jest.fn().mockReturnValue("text-white"),
      getShortDisplayName: jest.fn().mockReturnValue("TestPlayer"),
    };

    mockPlayerInfoManager = {
      init: jest.fn(),
      subscribeToData: jest.fn(),
      unsubscribeFromData: jest.fn(),
      getPlayerInfoService: jest.fn().mockReturnValue(mockPlayerInfoService),
    };

    (PlayerInfoManager.getInstance as jest.Mock).mockReturnValue(
      mockPlayerInfoManager,
    );

    overlay = new MockPlayerInfoOverlay();
    overlay.game = game;
    overlay.eventBus = eventBus;
    overlay.transform = transform;
    overlay.userSettings = userSettings;
  });

  it("should initialize correctly", () => {
    overlay.init();

    expect(mockPlayerInfoManager.init).toHaveBeenCalled();
    expect(mockPlayerInfoManager.subscribeToData).toHaveBeenCalled();
    expect(eventBus.on).toHaveBeenCalledWith(
      ContextMenuEvent,
      expect.any(Function),
    );
  });

  it("should destroy and cleanup properly", () => {
    overlay.init();
    overlay.destroy();

    expect(mockPlayerInfoManager.unsubscribeFromData).toHaveBeenCalled();
  });

  it("should hide overlay when user settings disable it", () => {
    userSettings.showPlayerInfoOverlay = jest.fn().mockReturnValue(false);
    const hideSpy = jest.spyOn(overlay, "hide");

    overlay.init();
    const callback = mockPlayerInfoManager.subscribeToData.mock.calls[0][0];
    callback({
      player: mockPlayer,
      unit: null,
      mouseX: 0,
      mouseY: 0,
    });

    expect(hideSpy).toHaveBeenCalled();
  });

  it("should show overlay when hover info contains player or unit", () => {
    const setVisibleSpy = jest.spyOn(overlay, "setVisible");

    overlay.init();
    const callback = mockPlayerInfoManager.subscribeToData.mock.calls[0][0];
    callback({
      player: mockPlayer,
      unit: null,
      mouseX: 0,
      mouseY: 0,
    });

    expect(setVisibleSpy).toHaveBeenCalledWith(true);
  });

  it("should hide overlay when hover info is empty", () => {
    const hideSpy = jest.spyOn(overlay, "hide");

    overlay.init();
    const callback = mockPlayerInfoManager.subscribeToData.mock.calls[0][0];
    callback({
      player: null,
      unit: null,
      mouseX: 0,
      mouseY: 0,
    });

    expect(hideSpy).toHaveBeenCalled();
  });

  it("should handle context menu events", async () => {
    const maybeShowSpy = jest.spyOn(overlay, "maybeShow").mockResolvedValue();

    overlay.init();
    const contextMenuCallback = (eventBus.on as jest.Mock).mock.calls.find(
      (call) => call[0] === ContextMenuEvent,
    )[1];

    const event = new ContextMenuEvent(100, 200);
    contextMenuCallback(event);

    expect(maybeShowSpy).toHaveBeenCalledWith(100, 200);
  });

  it("should render player info correctly", () => {
    overlay.init();
    overlay["player"] = mockPlayer;
    overlay["_isInfoVisible"] = true;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toContain("TestPlayer");
  });

  it("should render unit info correctly", () => {
    overlay.init();
    overlay["unit"] = mockUnit;
    overlay["_isInfoVisible"] = true;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toContain("Warship");
    expect(htmlString).toContain("80");
  });

  it("should not render when user settings disable overlay", () => {
    userSettings.showPlayerInfoOverlay = jest.fn().mockReturnValue(false);

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toBe("");
  });

  it("should not render when not visible", () => {
    overlay.init();
    overlay["_isInfoVisible"] = false;

    const result = overlay.render();
    const htmlString = result.strings.join("");

    expect(htmlString).toContain("opacity-0 invisible");
  });

  it("should reset hover state when hiding", () => {
    overlay.init();
    overlay["player"] = mockPlayer;
    overlay["unit"] = mockUnit;

    overlay.hide();

    expect(overlay["player"]).toBeNull();
    expect(overlay["unit"]).toBeNull();
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
});
