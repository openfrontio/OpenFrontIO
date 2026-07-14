import { describe, it, expect, beforeEach, vi } from "vitest";
import { HoverHighlightController } from "../../../src/client/controllers/HoverHighlightController";
import { MouseMoveEvent } from "../../../src/client/InputHandler";

describe("HoverHighlightController", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;
  let view: any;

  beforeEach(() => {
    game = {
      isValidCoord: () => true,
      ref: () => 42,
      isLand: () => true,
      tileState: () => 3,
    };
    eventBus = { on: vi.fn() };
    transformHandler = {
      screenToWorldCoordinatesFloat: vi.fn().mockReturnValue({ x: 100.5, y: 200.5 }),
      screenToWorldCoordinates: vi.fn().mockReturnValue({ x: 2, y: 3 }),
    };
    view = {
      setMouseWorldPos: vi.fn(),
      setHighlightOwner: vi.fn(),
    };
  });

  it("sets highlight owner for land tiles and updates mouse world pos", () => {
    const ui = new HoverHighlightController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    ui.init();

    expect(eventBus.on).toHaveBeenCalledWith(MouseMoveEvent, expect.any(Function));
    const handler = (eventBus.on as any).mock.calls[0][1];

    handler(new MouseMoveEvent(10, 20));

    expect(transformHandler.screenToWorldCoordinatesFloat).toHaveBeenCalledWith(10, 20);
    expect(view.setMouseWorldPos).toHaveBeenCalledWith(100.5, 200.5);
    expect(view.setHighlightOwner).toHaveBeenCalledWith(3);
  });

  it("uses naval hover highlighting when tile is not land", () => {
    game.isLand = () => false;
    game.ref = () => 5;
    game.euclideanDistSquared = () => 1000; // less than 2500
    const unit = {
      tile: () => 7,
      owner: () => ({ smallID: () => 9 }),
    };
    game.units = (..._args: any[]) => [unit];

    const ui = new HoverHighlightController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    // enable naval hover behavior
    ui["userSettings"] = { navalHoverHighlight: () => true } as any;

    ui.init();
    const handler = (eventBus.on as any).mock.calls[0][1];
    handler(new MouseMoveEvent(1, 2));

    expect(view.setHighlightOwner).toHaveBeenCalledWith(9);
  });

  it("does not highlight if there are no naval units nearby", () => {
    game.isLand = () => false;
    game.units = (..._args: any[]) => [];
    game.ref = () => 20;
    game.euclideanDistSquared = () => 3000; // greater than 2500

    const ui = new HoverHighlightController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    // enable naval hover behavior
    ui["userSettings"] = { navalHoverHighlight: () => true } as any;

    ui.init();
    const handler = (eventBus.on as any).mock.calls[0][1];
    handler(new MouseMoveEvent(1, 2));

    expect(view.setHighlightOwner).toHaveBeenCalledWith(0);
  });


});
