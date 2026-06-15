import { ClientGameRunner } from "../../src/client/ClientGameRunner";
import { MouseUpEvent } from "../../src/client/InputHandler";
import { Platform } from "../../src/client/Platform";
import { SendAttackIntentEvent } from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";

// Builds a ClientGameRunner with just enough wiring for inputEvent() to reach
// the attack decision. The constructor is bypassed (Object.create) so we don't
// have to stand up the whole rendering/transport stack.
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeRunner(eventBus: EventBus, actions: any) {
  const runner = Object.create(
    ClientGameRunner.prototype,
  ) as ClientGameRunner & Record<string, any>;

  runner["isActive"] = true;
  runner["eventBus"] = eventBus;
  runner["renderer"] = {
    uiState: { ghostStructure: null, attackRatio: 0.5 },
    transformHandler: {
      screenToWorldCoordinates: () => ({ x: 1, y: 1 }),
    },
  };
  runner["gameView"] = {
    isValidCoord: () => true,
    ref: () => 42,
    isLand: () => true,
    hasOwner: () => true,
    inSpawnPhase: () => false,
    config: () => ({ isRandomSpawn: () => false }),
    owner: () => ({ id: () => "enemy-id" }),
  };
  runner["myPlayer"] = {
    actions: vi.fn().mockResolvedValue(actions),
    troops: () => 100,
  };
  return runner;
}

describe("ClientGameRunner left-click attack (Mac Ctrl suppression)", () => {
  let originalIsMac: boolean;
  let eventBus: EventBus;

  beforeEach(() => {
    originalIsMac = Platform.isMac;
    eventBus = new EventBus();
  });

  afterEach(() => {
    (Platform as any).isMac = originalIsMac;
  });

  test("suppresses attack on Mac when Ctrl is held", async () => {
    (Platform as any).isMac = true;
    const emit = vi.spyOn(eventBus, "emit");
    const runner = makeRunner(eventBus, {
      canAttack: true,
      buildableUnits: [],
    });

    runner["inputEvent"](new MouseUpEvent(150, 250, true));
    await flush();

    const attackEmitted = emit.mock.calls.some(
      (c) => c[0] instanceof SendAttackIntentEvent,
    );
    expect(attackEmitted).toBe(false);
  });

  test("attacks on Mac when Ctrl is NOT held", async () => {
    (Platform as any).isMac = true;
    const emit = vi.spyOn(eventBus, "emit");
    const runner = makeRunner(eventBus, {
      canAttack: true,
      buildableUnits: [],
    });

    runner["inputEvent"](new MouseUpEvent(150, 250, false));
    await flush();

    const attackEmitted = emit.mock.calls.some(
      (c) => c[0] instanceof SendAttackIntentEvent,
    );
    expect(attackEmitted).toBe(true);
  });

  test("attacks on non-Mac even when Ctrl is held", async () => {
    (Platform as any).isMac = false;
    const emit = vi.spyOn(eventBus, "emit");
    const runner = makeRunner(eventBus, {
      canAttack: true,
      buildableUnits: [],
    });

    runner["inputEvent"](new MouseUpEvent(150, 250, true));
    await flush();

    const attackEmitted = emit.mock.calls.some(
      (c) => c[0] instanceof SendAttackIntentEvent,
    );
    expect(attackEmitted).toBe(true);
  });
});
