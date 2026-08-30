import { PlayerInfo, PlayerType, UnitType } from "src/core/game/Game";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoverHighlightController } from "../../../src/client/controllers/HoverHighlightController";
import { MouseMoveEvent } from "../../../src/client/InputHandler";
import { setup } from "../../util/Setup";

describe("HoverHighlightController", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;
  let view: any;
  // Controlled performance.now() — the controller delays the highlight by
  // wall-clock time, so tests drive the clock explicitly.
  let nowMs: number;

  beforeEach(async () => {
    game = await setup(
      "giantworldmap",
      { infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("player1", PlayerType.Human, null, "player1_id"),
        new PlayerInfo("player2", PlayerType.Human, null, "player2_id"),
      ],
    );

    nowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);

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
      // Default to no delay so the immediate-behavior tests stay focused on
      // routing; the delay itself is covered by the dedicated tests below.
      getSettings: () =>
        ({ mapOverlay: { navalHighlight: false, highlightDelayMs: 0 } }) as any,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  describe("hover delay", () => {
    let player1: any;
    let player2: any;
    let handler: (e: MouseMoveEvent) => void;
    let ui: HoverHighlightController;

    beforeEach(() => {
      // Use the settings-driven delay so these tests cover the gating logic.
      view.getSettings = () =>
        ({
          mapOverlay: { navalHighlight: false, highlightDelayMs: 500 },
        }) as any;

      player1 = game.player("player1_id");
      player2 = game.player("player2_id");
      ui = new HoverHighlightController(game, eventBus, transformHandler, view);
      ui.init();
      handler = (eventBus.on as any).mock.calls[0][1];
    });

    it("does not highlight a newly hovered owner before the delay elapses", () => {
      const tile = game.ref(200, 200);
      expect(game.isLand(tile)).toBe(true);
      player1.conquer(tile);

      nowMs = 1_000;
      handler(new MouseMoveEvent(200, 200)); // enter the territory
      expect(view.setHighlightOwner).not.toHaveBeenCalled();

      // The highlight must still apply via tick() even though the mouse
      // stopped moving and no further MouseMoveEvents arrive.
      nowMs = 1_400;
      ui.tick();
      expect(view.setHighlightOwner).not.toHaveBeenCalled();

      nowMs = 1_500;
      ui.tick();
      expect(view.setHighlightOwner).toHaveBeenCalledTimes(1);
      expect(view.setHighlightOwner).toHaveBeenCalledWith(player1.smallID());
    });

    it("keeps the delay timer running while the cursor moves within the same territory", () => {
      // Conquer a block so adjacent moves stay on the same owner.
      for (let x = 196; x <= 204; x++) {
        for (let y = 196; y <= 204; y++) {
          const t = game.ref(x, y);
          if (game.isLand(t)) player1.conquer(t);
        }
      }

      nowMs = 1_000;
      handler(new MouseMoveEvent(200, 200)); // enter the territory
      // Wander within the same territory — every event must land on the same
      // owner, so the entry timestamp must not reset.
      for (let i = 1; i <= 4; i++) {
        nowMs = 1_000 + i * 100;
        handler(new MouseMoveEvent(200 + i, 200 + i));
      }
      expect(view.setHighlightOwner).not.toHaveBeenCalled();

      nowMs = 1_500;
      ui.tick();
      expect(view.setHighlightOwner).toHaveBeenCalledWith(player1.smallID());
    });

    it("does not reset the delay when sweeping to a new owner and back to the highlighted one", () => {
      const tileA = game.ref(200, 200);
      const tileB = game.ref(300, 200);
      expect(game.isLand(tileA)).toBe(true);
      expect(game.isLand(tileB)).toBe(true);
      player1.conquer(tileA);
      player2.conquer(tileB);

      nowMs = 1_000;
      handler(new MouseMoveEvent(200, 200)); // hover A
      nowMs = 1_500;
      ui.tick(); // A qualifies
      expect(view.setHighlightOwner).toHaveBeenCalledTimes(1);
      expect(view.setHighlightOwner).toHaveBeenCalledWith(player1.smallID());

      // Quick excursion to B and back before B's delay elapses.
      nowMs = 1_600;
      handler(new MouseMoveEvent(300, 200)); // hover B — pending
      nowMs = 1_700;
      handler(new MouseMoveEvent(200, 200)); // back on A (already applied)
      nowMs = 2_500;
      ui.tick();
      // A stays highlighted the whole time; nothing flashes off and back on.
      expect(view.setHighlightOwner).toHaveBeenCalledTimes(1);
    });

    it("highlights a new owner only after it has been hovered for the full delay", () => {
      const tileA = game.ref(200, 200);
      const tileB = game.ref(300, 200);
      expect(game.isLand(tileA)).toBe(true);
      expect(game.isLand(tileB)).toBe(true);
      player1.conquer(tileA);
      player2.conquer(tileB);

      nowMs = 1_000;
      handler(new MouseMoveEvent(200, 200)); // hover A
      nowMs = 1_500;
      ui.tick(); // A qualifies
      expect(view.setHighlightOwner).toHaveBeenCalledWith(player1.smallID());

      nowMs = 2_000;
      handler(new MouseMoveEvent(300, 200)); // move to B — timer restarts
      nowMs = 2_400;
      ui.tick();
      expect(view.setHighlightOwner).toHaveBeenCalledTimes(1); // B not yet due

      nowMs = 2_500;
      ui.tick();
      expect(view.setHighlightOwner).toHaveBeenCalledTimes(2);
      expect(view.setHighlightOwner).toHaveBeenLastCalledWith(
        player2.smallID(),
      );
    });

    it("delays clearing the highlight when the cursor leaves the map", () => {
      const tile = game.ref(200, 200);
      expect(game.isLand(tile)).toBe(true);
      player1.conquer(tile);

      nowMs = 1_000;
      handler(new MouseMoveEvent(200, 200)); // hover the territory
      nowMs = 1_500;
      ui.tick();
      expect(view.setHighlightOwner).toHaveBeenCalledWith(player1.smallID());

      transformHandler.screenToWorldCoordinates.mockReturnValue({
        x: -50,
        y: -50,
      });
      nowMs = 1_600;
      handler(new MouseMoveEvent(0, 0)); // off-map — clear becomes pending
      nowMs = 2_000;
      ui.tick();
      expect(view.setHighlightOwner).toHaveBeenCalledTimes(1); // still held

      nowMs = 2_100;
      ui.tick();
      expect(view.setHighlightOwner).toHaveBeenLastCalledWith(0);
    });
  });
});
