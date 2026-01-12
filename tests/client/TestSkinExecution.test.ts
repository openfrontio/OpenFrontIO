import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowSkinTestModalEvent } from "../../src/client/graphics/layers/SkinTestWinModal";
import { TestSkinExecution } from "../../src/client/TestSkinExecution";
import { SendAttackIntentEvent } from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";

describe("TestSkinExecution", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("showModal emits ShowSkinTestModalEvent and prevents scheduled initial attack", () => {
    const fakePlayer = {
      cosmetics: { pattern: { name: "pattern1", colorPalette: { name: "p" } } },
      troops: () => 100,
    } as any;

    const gameView = {
      playerByClientID: (_: any) => fakePlayer,
    } as any;

    const spyEmit = vi.spyOn(eventBus, "emit");
    const onShowModalRequested = vi.fn();

    const exec = new TestSkinExecution(
      gameView,
      eventBus,
      "client1" as any,
      () => true,
      onShowModalRequested,
    );

    exec.start();

    // Immediately show modal which should clear timeouts
    exec.showModal();

    // Should have requested runner to stop
    expect(onShowModalRequested).toHaveBeenCalled();

    // Should have emitted the ShowSkinTestModalEvent once with the right payload
    const emitted = spyEmit.mock.calls.map((c) => c[0]);
    expect(emitted.some((e) => e instanceof ShowSkinTestModalEvent)).toBe(true);
    const modalEvent = emitted.find(
      (e) => e instanceof ShowSkinTestModalEvent,
    ) as ShowSkinTestModalEvent;
    expect(modalEvent).toBeDefined();
    expect(modalEvent.patternName).toBe("pattern1");

    // Advance timers past the initial attack delay; since showModal cleared timeouts, no SendAttackIntentEvent should be emitted
    vi.advanceTimersByTime(500);
    const emittedAfter = spyEmit.mock.calls.map((c) => c[0]);
    expect(emittedAfter.some((e) => e instanceof SendAttackIntentEvent)).toBe(
      false,
    );
  });

  it("start schedules initial attack if not cancelled", () => {
    const fakePlayer = {
      cosmetics: { pattern: { name: "pattern1", colorPalette: null } },
      troops: () => 100,
    } as any;

    const gameView = {
      playerByClientID: (_: any) => fakePlayer,
    } as any;

    const spyEmit = vi.spyOn(eventBus, "emit");

    const exec = new TestSkinExecution(
      gameView,
      eventBus,
      "client1" as any,
      () => true,
      () => {},
    );

    exec.start();

    // advance past initial attack delay
    vi.advanceTimersByTime(200);

    // initial attack should have emitted a SendAttackIntentEvent
    expect(
      spyEmit.mock.calls.some((c) => c[0] instanceof SendAttackIntentEvent),
    ).toBe(true);
  });
});
