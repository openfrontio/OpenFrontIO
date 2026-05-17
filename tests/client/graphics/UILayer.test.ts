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

  it("tracks the selected unit on single-unit selection (rendering is WebGL)", () => {
    const ui = new UILayer(game, eventBus, transformHandler);
    ui.redraw();
    const unit = {
      type: () => "Warship",
      isActive: () => true,
      tile: () => ({}),
      owner: () => ({}),
    };
    const event = { isSelected: true, unit };
    ui["onUnitSelection"](event as UnitSelectionEvent);
    // selectedUnit is held for game-logic callers (the click handlers). The
    // visual selection box is now drawn by WebGL SelectionBoxPass — wired
    // from ClientGameRunner via view.setSelectedUnit(unit.id()).
    expect(ui["selectedUnit"]).toBe(unit);
  });

  it("clears selection on deselect", () => {
    const ui = new UILayer(game, eventBus, transformHandler);
    ui.redraw();
    const unit = {
      type: () => "Warship",
      isActive: () => true,
      tile: () => ({}),
      owner: () => ({}),
    };
    ui["onUnitSelection"]({ isSelected: true, unit } as UnitSelectionEvent);
    ui["onUnitSelection"]({
      isSelected: false,
      unit: null,
    } as unknown as UnitSelectionEvent);
    expect(ui["selectedUnit"]).toBeNull();
  });
});
