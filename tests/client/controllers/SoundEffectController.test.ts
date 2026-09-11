import { SoundEffectController } from "../../../src/client/controllers/SoundEffectController";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";
import { SendSpawnIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { MessageType, UnitType } from "../../../src/core/game/Game";
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

  // createdAt reads `tick` lazily, so the unit counts as created on whichever
  // tick tickWithUnits delivers it.
  function makeCreatedUnit(id: number, type: UnitType, owner: object) {
    return {
      id: () => id,
      type: () => type,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => tick,
      owner: () => owner,
      hasTrainStation: () => false,
    };
  }

  it("plays game-start when the spawn phase ends", () => {
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.SpawnPhaseEnd]: [{ startTick: 10 }],
    });
    controller.tick();
    expect(played).toEqual(["game-start"]);
  });

  it("plays spawn on every spawn placement", () => {
    controller.init();
    eventBus.emit(new SendSpawnIntentEvent(0 as never));
    eventBus.emit(new SendSpawnIntentEvent(1 as never));
    expect(played).toEqual(["spawn", "spawn"]);
  });

  it("plays nuke-warning only for nukes inbound to my player", () => {
    game.myPlayer = () => ({ smallID: () => 7 });
    game.inSpawnPhase = () => false;
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.UnitIncoming]: [
        { playerID: 7, messageType: MessageType.NUKE_INBOUND },
        { playerID: 8, messageType: MessageType.HYDROGEN_BOMB_INBOUND },
        { playerID: 7, messageType: MessageType.NAVAL_INVASION_INBOUND },
      ],
    });
    controller.tick();
    expect(played).toEqual(["nuke-warning"]);
  });

  it("plays build sounds only for my own factory and transport ship", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    tickWithUnits(
      makeCreatedUnit(1, UnitType.Factory, me),
      makeCreatedUnit(2, UnitType.TransportShip, me),
      makeCreatedUnit(3, UnitType.Factory, {}),
      makeCreatedUnit(4, UnitType.TransportShip, {}),
    );
    expect(played).toEqual(["build-factory", "transport-ship"]);
  });

  it("plays build-train-station when my structure gains a station", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    let hasStation = false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => hasStation,
    };
    tickWithUnits(city);
    expect(played).toEqual([]);
    hasStation = true;
    tickWithUnits(city);
    expect(played).toEqual(["build-train-station"]);
    tickWithUnits(city);
    expect(played).toEqual(["build-train-station"]);
  });

  it("stays silent for a structure first seen with a station already", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => true,
    };
    tickWithUnits(city);
    expect(played).toEqual([]);
  });
});
