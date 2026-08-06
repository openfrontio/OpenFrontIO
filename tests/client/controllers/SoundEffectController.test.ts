import { SoundEffectController } from "../../../src/client/controllers/SoundEffectController";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";
import { EventBus } from "../../../src/core/EventBus";
import { UnitType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";

describe("SoundEffectController", () => {
  let eventBus: EventBus;
  let played: string[];
  let tick: number;
  let units: Map<number, any>;
  let game: any;
  let controller: SoundEffectController;

  function makeDetonatedWarhead(id: number) {
    return {
      id: () => id,
      type: () => UnitType.MIRVWarhead,
      isActive: () => false,
      reachedTarget: () => true,
      createdAt: () => 0,
      owner: () => ({}),
    };
  }

  function tickWithUnits(...us: Array<{ id: () => number }>) {
    tick++;
    units = new Map(us.map((u) => [u.id(), u]));
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.Unit]: us.map((u) => ({ id: u.id() })),
    });
    controller.tick();
  }

  beforeEach(() => {
    eventBus = new EventBus();
    played = [];
    eventBus.on(PlaySoundEffectEvent, (e) => played.push(e.effect));
    tick = 0;
    game = {
      ticks: () => tick,
      unit: (id: number) => units.get(id),
      myPlayer: () => null,
      updatesSinceLastTick: () => undefined,
    };
    controller = new SoundEffectController(game, eventBus);
  });

  it("plays at most one warhead boom per interval", () => {
    // 10 warheads detonate on the same tick — one boom.
    tickWithUnits(
      ...Array.from({ length: 10 }, (_, i) => makeDetonatedWarhead(i)),
    );
    expect(played).toEqual(["atom-hit"]);

    // More warheads land on the next few ticks — still inside the interval.
    tickWithUnits(makeDetonatedWarhead(20));
    tickWithUnits(makeDetonatedWarhead(21));
    expect(played).toEqual(["atom-hit"]);

    // Once the interval has passed, the next detonation booms again.
    tick += 5;
    tickWithUnits(makeDetonatedWarhead(30));
    expect(played).toEqual(["atom-hit", "atom-hit"]);
  });

  it("does not play a boom for intercepted warheads", () => {
    const intercepted = {
      id: () => 1,
      type: () => UnitType.MIRVWarhead,
      isActive: () => false,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => ({}),
    };
    tickWithUnits(intercepted);
    expect(played).toEqual([]);
  });
});
