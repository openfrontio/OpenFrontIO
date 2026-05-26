import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SkinTestController } from "../../src/client/SkinTestController";
import { SendAttackIntentEvent } from "../../src/client/Transport";
import { EventBus } from "../../src/core/EventBus";

describe("SkinTestController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const makePlayer = () =>
    ({
      cosmetics: { pattern: { name: "pattern1", colorPalette: { name: "p" } } },
      troops: () => 100,
    }) as any;

  function makeController(opts?: {
    onPreviewEnded?: () => void;
    modal?: { showByName: ReturnType<typeof vi.fn> } | null;
  }) {
    const player = makePlayer();
    const gameView = { playerByClientID: () => player } as any;
    const eventBus = new EventBus();
    const onAttack = vi.fn();
    eventBus.on(SendAttackIntentEvent, onAttack);
    const modal = opts?.modal ?? { showByName: vi.fn() };
    const onPreviewEnded = opts?.onPreviewEnded ?? vi.fn();
    const controller = new SkinTestController(
      gameView,
      "client1" as any,
      eventBus,
      modal as any,
      onPreviewEnded,
    );
    return { controller, onAttack, modal, onPreviewEnded };
  }

  it("schedules an initial attack with a fixed troop count", () => {
    const { controller, onAttack } = makeController();
    controller.start();
    vi.advanceTimersByTime(200);
    expect(onAttack).toHaveBeenCalledTimes(1);
    expect(onAttack.mock.calls[0][0]).toMatchObject({
      targetID: null,
      troops: 1_000_000,
    });
  });

  it("showModal cancels the initial attack and shows the modal", () => {
    const { controller, onAttack, modal, onPreviewEnded } = makeController();
    controller.start();
    controller.showModal();
    expect(onPreviewEnded).toHaveBeenCalledOnce();
    expect(modal!.showByName).toHaveBeenCalledWith("pattern1", { name: "p" });
    vi.advanceTimersByTime(500);
    expect(onAttack).not.toHaveBeenCalled();
  });

  it("stop() prevents the modal from firing on its own timer", () => {
    const { controller, modal } = makeController();
    controller.start();
    controller.stop();
    vi.advanceTimersByTime(200_000);
    expect(modal!.showByName).not.toHaveBeenCalled();
  });
});
