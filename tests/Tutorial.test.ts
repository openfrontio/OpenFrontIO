import {
  STEP_DONE_LINGER_TICKS,
  TUTORIAL_STEPS,
  TutorialContext,
  TutorialProgress,
} from "../src/client/hud/layers/Tutorial";

function ctx(overrides: Partial<TutorialContext> = {}): TutorialContext {
  return {
    hasSpawned: false,
    attacking: false,
    attackingBot: false,
    botsExist: true,
    gold: 0n,
    cityCost: null,
    cityDisabled: false,
    cities: 0,
    portDisabled: false,
    ports: 0,
    factoryDisabled: false,
    factories: 0,
    warshipDisabled: false,
    warships: 0,
    siloDisabled: false,
    silos: 0,
    ...overrides,
  };
}

// Feed the same context until the completed step has lingered and advanced.
function settle(progress: TutorialProgress, c: TutorialContext) {
  for (let i = 0; i <= STEP_DONE_LINGER_TICKS; i++) progress.update(c);
}

describe("TutorialProgress", () => {
  it("walks the steps in order as the player acts", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("spawn");
    expect(p.stepDone()).toBe(true);

    settle(p, ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");

    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("troops");

    p.acknowledge();
    settle(p, ctx({ hasSpawned: true, attacking: true }));
    expect(p.current()?.id).toBe("capture_tribes");

    settle(
      p,
      ctx({
        hasSpawned: true,
        attacking: true,
        gold: 125_000n,
        cityCost: 125_000n,
      }),
    );
    expect(p.current()?.id).toBe("attack_bot");
  });

  it("lingers on a completed step before advancing", () => {
    const p = new TutorialProgress();
    p.update(ctx({ hasSpawned: true }));
    for (let i = 1; i < STEP_DONE_LINGER_TICKS; i++) {
      p.update(ctx({ hasSpawned: true }));
      expect(p.current()?.id).toBe("spawn");
    }
    p.update(ctx({ hasSpawned: true }));
    expect(p.current()?.id).toBe("attack_wilderness");
  });

  it("only advances informational steps on acknowledge", () => {
    const p = new TutorialProgress();
    const c = ctx({ hasSpawned: true, attacking: true });
    settle(p, c);
    settle(p, c);
    expect(p.current()?.id).toBe("troops");

    for (let i = 0; i < 100; i++) p.update(c);
    expect(p.current()?.id).toBe("troops");
    expect(p.stepDone()).toBe(false);

    p.acknowledge();
    expect(p.stepDone()).toBe(true);
    settle(p, c);
    expect(p.current()?.id).toBe("capture_tribes");
  });

  it("ignores acknowledge on action steps", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    p.acknowledge();
    expect(p.stepDone()).toBe(false);
  });

  it("skips steps that don't apply to the game and counts only the rest", () => {
    const p = new TutorialProgress();
    const c = ctx({
      hasSpawned: true,
      attacking: true,
      botsExist: false,
      cityDisabled: true,
      portDisabled: true,
      factoryDisabled: true,
      warshipDisabled: true,
      siloDisabled: true,
    });
    expect(p.total(c)).toBe(TUTORIAL_STEPS.length - 9);

    settle(p, c);
    settle(p, c);
    expect(p.current()?.id).toBe("troops");
    expect(p.position(c)).toBe(3);

    p.acknowledge();
    settle(p, c);
    expect(p.current()?.id).toBe("gold");
    expect(p.position(c)).toBe(4);

    p.acknowledge();
    settle(p, c);
    expect(p.finished()).toBe(true);
    expect(p.current()).toBeNull();
  });

  it("gates the tribes step on affordable gold, then the city step on the city existing", () => {
    const p = new TutorialProgress([
      TUTORIAL_STEPS.find((s) => s.id === "capture_tribes")!,
      TUTORIAL_STEPS.find((s) => s.id === "buy_city")!,
    ]);
    p.update(ctx({ gold: 500_000n, cityCost: null }));
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ gold: 100_000n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);

    p.update(ctx({ gold: 125_000n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(true);
    settle(p, ctx({ gold: 125_000n, cityCost: 125_000n }));
    expect(p.current()?.id).toBe("buy_city");

    // Spending the gold elsewhere doesn't complete the step; the city does.
    p.update(ctx({ gold: 0n, cityCost: 125_000n }));
    expect(p.stepDone()).toBe(false);
    p.update(ctx({ gold: 0n, cityCost: 250_000n, cities: 1 }));
    expect(p.stepDone()).toBe(true);
  });

  it("runs city, factory, port, warship, silo, pausing on each info step", () => {
    const first = TUTORIAL_STEPS.findIndex((s) => s.id === "buy_factory");
    const p = new TutorialProgress(TUTORIAL_STEPS.slice(first));
    p.update(ctx());
    expect(p.current()?.id).toBe("buy_factory");

    settle(p, ctx({ factories: 1 }));
    expect(p.current()?.id).toBe("factory_info");
    for (let i = 0; i < 50; i++) p.update(ctx({ factories: 1 }));
    expect(p.current()?.id).toBe("factory_info");
    p.acknowledge();
    settle(p, ctx({ factories: 1 }));

    expect(p.current()?.id).toBe("buy_port");
    expect(p.current()?.highlight).toBe("port");
    settle(p, ctx({ factories: 1, ports: 1 }));
    expect(p.current()?.id).toBe("port_info");
    expect(p.current()?.bullets).toHaveLength(2);
    p.acknowledge();
    settle(p, ctx({ factories: 1, ports: 1 }));

    expect(p.current()?.id).toBe("buy_warship");
    expect(p.current()?.highlight).toBe("warship");
    settle(p, ctx({ factories: 1, ports: 1, warships: 1 }));

    expect(p.current()?.id).toBe("buy_silo");
    expect(p.current()?.highlight).toBe("silo");
    p.update(ctx({ factories: 1, ports: 1, warships: 1 }));
    expect(p.stepDone()).toBe(false);
    settle(p, ctx({ factories: 1, ports: 1, warships: 1, silos: 1 }));
    expect(p.finished()).toBe(true);
  });
});

describe("TutorialProgress.skip", () => {
  it("moves past the current step without completing it", () => {
    const p = new TutorialProgress();
    p.update(ctx());
    expect(p.current()?.id).toBe("spawn");

    p.skip();
    expect(p.stepDone()).toBe(false);
    p.update(ctx());
    expect(p.current()?.id).toBe("attack_wilderness");

    // Skipping lands on the next *applicable* step.
    p.skip();
    p.update(ctx({ botsExist: false }));
    expect(p.current()?.id).toBe("troops");
    p.skip();
    p.update(ctx({ botsExist: false }));
    expect(p.current()?.id).toBe("gold");
  });

  it("can skip through to the end", () => {
    const p = new TutorialProgress();
    for (let i = 0; i < TUTORIAL_STEPS.length; i++) p.skip();
    p.update(ctx());
    expect(p.finished()).toBe(true);
    p.skip();
    expect(p.finished()).toBe(true);
  });
});
