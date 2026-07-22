import { PlayerInfo, PlayerType, UnitType } from "src/core/game/Game";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HoverHighlightController } from "../../../src/client/controllers/HoverHighlightController";
import { MouseMoveEvent } from "../../../src/client/InputHandler";
import { setup } from "../../util/Setup";

describe("HoverHighlightController", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;
  let view: any;

  beforeEach(async () => {
    game = await setup(
      "giantworldmap",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("player1", PlayerType.Human, null, "player1_id")],
    );

    eventBus = { on: vi.fn() };
    transformHandler = {
      screenToWorldCoordinatesFloat: vi
        .fn()
        .mockReturnValue({ x: 100.5, y: 200.5 }),
      screenToWorldCoordinates: vi
        .fn()
        .mockImplementation((x, y) => ({ x, y })),
    };
    view = {
      setMouseWorldPos: vi.fn(),
      setHighlightOwner: vi.fn(),
    };
  });

  it("sets highlight owner for land tiles and updates mouse world pos", () => {
    const player1 = game.player("player1_id");
    const tile = game.ref(200, 200);
    expect(game.isLand(tile)).toBe(true); // Make sure we are testing on land
    player1.conquer(tile);
    const ui = new HoverHighlightController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    ui.init();

    expect(eventBus.on).toHaveBeenCalledWith(
      MouseMoveEvent,
      expect.any(Function),
    );
    const handler = (eventBus.on as any).mock.calls[0][1];

    handler(new MouseMoveEvent(200, 200));

    expect(transformHandler.screenToWorldCoordinatesFloat).toHaveBeenCalledWith(
      200,
      200,
    );
    expect(view.setMouseWorldPos).toHaveBeenCalledWith(100.5, 200.5);
    expect(view.setHighlightOwner).toHaveBeenCalledWith(player1.smallID());
  });

  it("uses naval hover highlighting when tile is not land", () => {
    const waterTile = game.ref(50, 100);
    expect(game.isWater(waterTile)).toBe(true); // Make sure we are testing on water

    const unit = game
      .player("player1_id")
      .buildUnit(UnitType.Warship, waterTile, { patrolTile: waterTile });

    const ui = new HoverHighlightController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    // enable naval hover behavior
    ui["navalHighlightEnabled"] = () => true;

    ui.init();
    const handler = (eventBus.on as any).mock.calls[0][1];
    handler(new MouseMoveEvent(50, 101));

    expect(view.setHighlightOwner).toHaveBeenCalledWith(unit.owner().smallID());
  });

  it("clears hover highlight when naval hover finds no nearby units", () => {
    const waterTile = game.ref(50, 100);
    expect(game.isWater(waterTile)).toBe(true); // Make sure we are testing on water
    const unit = game
      .player("player1_id")
      .buildUnit(UnitType.Warship, waterTile, { patrolTile: waterTile });

    const ui = new HoverHighlightController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    // enable naval hover behavior
    ui["navalHighlightEnabled"] = () => true;
    ui["lastOwnerID"] = unit.owner().smallID() + 1; // set to a different owner ID to ensure it updates

    ui.init();
    const handler = (eventBus.on as any).mock.calls[0][1];
    handler(new MouseMoveEvent(200, 100)); // >50 tiles from unit
    expect(view.setHighlightOwner).toHaveBeenCalledWith(0);
  });
});
