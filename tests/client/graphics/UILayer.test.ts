/**
 * @jest-environment jsdom
 */
import { UILayer } from "../../../src/client/graphics/layers/UILayer";
import { UnitSelectionEvent } from "../../../src/client/InputHandler";
import { UnitView } from "../../../src/core/game/GameView";

describe("UILayer", () => {
  let game: any;
  let eventBus: any;

  beforeEach(() => {
    game = {
      config: () => ({
        theme: () => ({
          territoryColor: () => ({
            lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
          }),
        }),
      }),
      height: () => 100,
      myPlayer: () => ({ id: () => 1 }),
      ticks: () => 1,
      unitInfo: () => ({ constructionDuration: 5, maxHealth: 10 }),
      updatesSinceLastTick: () => undefined,
      width: () => 100,
      x: () => 10,
      y: () => 10,
    };
    eventBus = { on: jest.fn() };
  });

  it("should initialize and redraw canvas", () => {
    const ui = new UILayer(game, eventBus);
    ui.redraw();
    // eslint-disable-next-line prefer-destructuring
    const canvas = ui["canvas"];
    expect(canvas).toBeDefined();
    if (canvas === undefined) throw new Error();
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(100);
    expect(ui["context"]).not.toBeNull();
  });

  it("should handle unit selection event", () => {
    const ui = new UILayer(game, eventBus);
    ui.redraw();
    const unit = {
      isActive: () => true,
      owner: () => ({}),
      tile: () => ({}),
      type: () => "Warship",
    };
    const event = { isSelected: true, unit };
    ui.drawSelectionBox = jest.fn();
    ui["onUnitSelection"](event as UnitSelectionEvent);
    expect(ui.drawSelectionBox).toHaveBeenCalledWith(unit);
  });

  it("should add and clear health bars", () => {
    const ui = new UILayer(game, eventBus);
    ui.redraw();
    const unit = {
      createdAt: () => 1,
      health: () => 5,
      id: () => 1,
      isActive: () => true,
      owner: () => ({}),
      tile: () => ({}),
      type: () => "Warship",
    } as unknown as UnitView;
    ui.drawHealthBar(unit);
    expect(ui["allHealthBars"].has(1)).toBe(true);

    // a full hp unit doesnt have a health bar
    unit.health = () => 10;
    ui.drawHealthBar(unit);
    expect(ui["allHealthBars"].has(1)).toBe(false);

    // a dead unit doesnt have a health bar
    unit.health = () => 5;
    ui.drawHealthBar(unit);
    expect(ui["allHealthBars"].has(1)).toBe(true);
    unit.health = () => 0;
    ui.drawHealthBar(unit);
    expect(ui["allHealthBars"].has(1)).toBe(false);
  });

  it("should remove health bars for inactive units", () => {
    const ui = new UILayer(game, eventBus);
    ui.redraw();
    const unit = {
      health: () => 5,
      id: () => 1,
      isActive: () => true,
      owner: () => ({}),
      tile: () => ({}),
      type: () => "Warship",
    } as unknown as UnitView;
    ui.drawHealthBar(unit);
    expect(ui["allHealthBars"].has(1)).toBe(true);

    // an inactive unit doesnt have a health bar
    unit.isActive = () => false;
    ui.drawHealthBar(unit);
    expect(ui["allHealthBars"].has(1)).toBe(false);
  });

  it("should add loading bar for unit", () => {
    const ui = new UILayer(game, eventBus);
    ui.redraw();
    const unit = {
      id: () => 2,
      isActive: () => true,
      tile: () => ({}),
    } as unknown as UnitView;
    ui.createLoadingBar(unit);
    expect(ui["allProgressBars"].has(2)).toBe(true);
  });

  it("should remove loading bar for inactive unit", () => {
    const ui = new UILayer(game, eventBus);
    ui.redraw();
    const unit = {
      constructionType: () => "City",
      id: () => 2,
      isActive: () => true,
      owner: () => ({ id: () => 1 }),
      tile: () => ({}),
      type: () => "Construction",
    } as unknown as UnitView;
    ui.onUnitEvent(unit);
    expect(ui["allProgressBars"].has(2)).toBe(true);

    // an inactive unit should not have a loading bar
    unit.isActive = () => false;
    ui.tick();
    expect(ui["allProgressBars"].has(2)).toBe(false);
  });

  it("should remove loading bar for a finished progress bar", () => {
    const ui = new UILayer(game, eventBus);
    ui.redraw();
    const unit = {
      constructionType: () => "City",
      createdAt: () => 1,
      id: () => 2,
      isActive: () => true,
      owner: () => ({ id: () => 1 }),
      tile: () => ({}),
      type: () => "Construction",
    } as unknown as UnitView;
    ui.onUnitEvent(unit);
    expect(ui["allProgressBars"].has(2)).toBe(true);

    game.ticks = () => 6; // simulate enough ticks for completion
    ui.tick();
    expect(ui["allProgressBars"].has(2)).toBe(false);
  });
});
