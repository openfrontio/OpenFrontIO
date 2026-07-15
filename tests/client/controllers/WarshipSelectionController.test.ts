import { WarshipSelectionController } from "../../../src/client/controllers/WarshipSelectionController";
import { UnitSelectionEvent } from "../../../src/client/InputHandler";

describe("WarshipSelectionController", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;
  let view: any;

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
    view = { setSelectedUnits: vi.fn() };
  });

  it("tracks the selected unit on single-unit selection (rendering is WebGL)", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    const unit = {
      id: () => 1,
      type: () => "Warship",
      isActive: () => true,
      tile: () => ({}),
      owner: () => ({}),
    };
    const event = { isSelected: true, unit };
    ui["onUnitSelection"](event as UnitSelectionEvent);
    // selectedUnit is held for game-logic callers (the click handlers). The
    // visual selection box is drawn by WebGL SelectionBoxPass — wired from
    // ClientGameRunner via view.setSelectedUnits([unit.id()]).
    expect(ui["selectedUnit"]).toBe(unit);
  });

  it("clears selection on deselect", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    const unit = {
      id: () => 1,
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

  it("tracks multi-selection list", () => {
    const ui = new WarshipSelectionController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    const units = [
      { id: () => 1, isActive: () => true },
      { id: () => 2, isActive: () => true },
    ];
    ui["onUnitSelection"]({
      isSelected: true,
      unit: null,
      units,
    } as unknown as UnitSelectionEvent);
    expect(ui["multiSelectedWarships"]).toEqual(units);
    expect(ui["selectedUnit"]).toBeNull();
  });
});
