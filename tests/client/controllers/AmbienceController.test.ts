import { AmbienceController } from "../../../src/client/controllers/AmbienceController";
import { SetAmbienceEvent } from "../../../src/client/sound/Sounds";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";

describe("AmbienceController", () => {
  let eventBus: EventBus;
  let emitted: (string | null)[];
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
    eventBus.on(SetAmbienceEvent, (e) => emitted.push(e.track));
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
});
