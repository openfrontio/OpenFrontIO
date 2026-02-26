import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TestSkinExecution } from "../../src/core/execution/TestSkinExecution";

describe("TestSkinExecution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("showModal calls onShowModal and prevents scheduled initial attack", () => {
    const fakePlayer = {
      cosmetics: { pattern: { name: "pattern1", colorPalette: { name: "p" } } },
      troops: () => 100,
    } as any;

    const gameView = {
      playerByClientID: (_: any) => fakePlayer,
    } as any;

    const onShowModalRequested = vi.fn();
    const onAttackIntent = vi.fn();
    const onShowModal = vi.fn();

    const exec = new TestSkinExecution(
      gameView,
      "client1" as any,
      () => true,
      onShowModalRequested,
      onAttackIntent,
      onShowModal,
    );

    exec.start();

    // Immediately show modal which should clear timeouts
    exec.showModal();

    // Should have requested runner to stop
    expect(onShowModalRequested).toHaveBeenCalled();

    // Should have called onShowModal with the right payload
    expect(onShowModal).toHaveBeenCalledWith("pattern1", { name: "p" });

    // Advance timers past the initial attack delay; since showModal cleared timeouts, no attack should fire
    vi.advanceTimersByTime(500);
    expect(onAttackIntent).not.toHaveBeenCalled();
  });

  it("start schedules initial attack if not cancelled", () => {
    const fakePlayer = {
      cosmetics: { pattern: { name: "pattern1", colorPalette: null } },
      troops: () => 100,
    } as any;

    const gameView = {
      playerByClientID: (_: any) => fakePlayer,
    } as any;

    const onAttackIntent = vi.fn();

    const exec = new TestSkinExecution(
      gameView,
      "client1" as any,
      () => true,
      () => {},
      onAttackIntent,
      () => {},
    );

    exec.start();

    // advance past initial attack delay
    vi.advanceTimersByTime(200);

    // initial attack should have called the onAttackIntent callback
    expect(onAttackIntent).toHaveBeenCalledWith(null, 50);
  });
});
