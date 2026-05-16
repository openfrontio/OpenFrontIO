import { UILayer } from "../../../src/client/graphics/layers/UILayer";
import { UnitSelectionEvent } from "../../../src/client/InputHandler";

describe("UILayer", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;

  beforeEach(() => {
    game = {
      width: () => 100,
      height: () => 100,
      config: () => ({
        theme: () => ({
          territoryColor: () => ({
            lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
          }),
        }),
      }),
      x: () => 10,
      y: () => 10,
      unitInfo: () => ({ maxHealth: 10, constructionDuration: 5 }),
      myPlayer: () => ({ id: () => 1 }),
      ticks: () => 1,
      updatesSinceLastTick: () => undefined,
    };
    eventBus = { on: vi.fn() };
    transformHandler = {};
  });

  it("should initialize and redraw canvas", () => {
    const ui = new UILayer(game, eventBus, transformHandler);
    ui.redraw();
    expect(ui["canvas"].width).toBe(100);
    expect(ui["canvas"].height).toBe(100);
    expect(ui["context"]).not.toBeNull();
  });

  it("should handle unit selection event", () => {
    const ui = new UILayer(game, eventBus, transformHandler);
    ui.redraw();
    const unit = {
      type: () => "Warship",
      isActive: () => true,
      tile: () => ({}),
      owner: () => ({}),
    };
    const event = { isSelected: true, unit };
    ui.drawSelectionBox = vi.fn();
    ui["onUnitSelection"](event as UnitSelectionEvent);
    expect(ui.drawSelectionBox).toHaveBeenCalledWith(unit);
  });
});
