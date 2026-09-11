import { AmbienceController } from "../../../src/client/controllers/AmbienceController";
import { SetAmbienceEvent } from "../../../src/client/sound/Sounds";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

describe("AmbienceController", () => {
  let eventBus: EventBus;
  let emitted: (string | null)[];
  let gains: number[];
  let nearby: Array<{ unit: { type: () => UnitType }; distSquared: number }>;
  let game: any;
  let transformHandler: any;
  let controller: AmbienceController;

  function structure(type: UnitType, distSquared: number) {
    return { unit: { type: () => type }, distSquared };
  }

  beforeEach(() => {
    eventBus = new EventBus();
    emitted = [];
    gains = [];
    eventBus.on(SetAmbienceEvent, (e) => {
      emitted.push(e.track);
      gains.push(e.gain);
    });
    nearby = [];
    game = {
      isValidCoord: () => true,
      ref: (x: number, y: number) => y * 1000 + x,
      nearbyUnits: () => nearby,
    };
    // screenCenter() returns world coordinates despite the field names.
    transformHandler = {
      scale: 10,
      screenCenter: () => ({ screenX: 5, screenY: 5 }),
    };
    controller = new AmbienceController(game, eventBus, transformHandler);
  });

  it("emits the nearest structure's ambience when zoomed in", () => {
    nearby = [structure(UnitType.Factory, 9), structure(UnitType.City, 4)];
    controller.tick();
    expect(emitted).toEqual(["city"]);
  });

  it("emits nothing when zoomed out", () => {
    transformHandler.scale = 1.8;
    nearby = [structure(UnitType.City, 4)];
    controller.tick();
    expect(emitted).toEqual([]);
  });

  it("clears the ambience when no structure is near anymore", () => {
    nearby = [structure(UnitType.SAMLauncher, 4)];
    controller.tick();
    nearby = [];
    controller.tick();
    expect(emitted).toEqual(["sam-silo", null]);
  });

  it("does not re-emit an unchanged track", () => {
    nearby = [structure(UnitType.MissileSilo, 4)];
    controller.tick();
    controller.tick();
    expect(emitted).toEqual(["missile-silo"]);
  });

  describe("zoom envelope", () => {
    // The sound designer asked for -20 dB below the channel at the deepest
    // zoom, fading to silence as the player pulls back out.
    it("peaks at -20 dB when fully zoomed in", () => {
      transformHandler.scale = 20; // the clamp ceiling
      nearby = [structure(UnitType.City, 4)];
      controller.tick();
      expect(gains[0]).toBeCloseTo(0.1);
    });

    it("is silent at the threshold and rises from there", () => {
      transformHandler.scale = 8; // AMBIENCE_ZOOM_SCALE
      nearby = [structure(UnitType.City, 4)];
      controller.tick();
      expect(gains[0]).toBeCloseTo(0);

      transformHandler.scale = 14; // halfway
      controller.tick();
      expect(gains[1]).toBeCloseTo(0.05);
    });

    it("re-emits while the player keeps zooming, on the same track", () => {
      nearby = [structure(UnitType.City, 4)];
      transformHandler.scale = 10;
      controller.tick();
      transformHandler.scale = 16;
      controller.tick();
      expect(emitted).toEqual(["city", "city"]);
      expect(gains[1]).toBeGreaterThan(gains[0]);
    });

    it("ignores a zoom nudge too small to hear", () => {
      nearby = [structure(UnitType.City, 4)];
      transformHandler.scale = 10;
      controller.tick();
      transformHandler.scale = 10.01;
      controller.tick();
      expect(emitted).toEqual(["city"]);
    });

    it("reports no gain once there is nothing to play", () => {
      nearby = [structure(UnitType.City, 4)];
      controller.tick();
      nearby = [];
      controller.tick();
      expect(emitted).toEqual(["city", null]);
      expect(gains[1]).toBe(0);
    });
  });
});
