import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOTO_INTERVAL_MS,
  GoToPositionEvent,
  TransformHandler,
} from "../../src/client/TransformHandler";
import type { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";

function makeHandler() {
  const game = {
    width: () => 400,
    height: () => 400,
    myPlayer: () => null,
  } as unknown as GameView;
  const eventBus = new EventBus();
  const handler = new TransformHandler(
    game,
    eventBus,
    document.createElement("canvas"),
  );
  return { handler, eventBus };
}

describe("TransformHandler", () => {
  it("starts with the default camera and no pending changes", () => {
    const { handler } = makeHandler();
    expect(handler.scale).toBe(1.8);
    expect(handler.hasChanged()).toBe(false);
  });

  it("treats a goTo tick after the target was cleared as a programming error", () => {
    const { handler } = makeHandler();
    handler.override(); // clears any target
    expect(() => (handler as any).goTo()).toThrow("null target");
  });

  describe("go-to animation", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("pans toward the target each tick until manual control clears it", () => {
      const { handler, eventBus } = makeHandler();
      const startX = handler.offsetX;

      eventBus.emit(new GoToPositionEvent(500, 500));
      vi.advanceTimersByTime(GOTO_INTERVAL_MS);
      expect(handler.offsetX).not.toBe(startX);
      expect(handler.hasChanged()).toBe(true);

      // Taking manual control stops the pending go-to interval.
      handler.override(10, 20, 1);
      const [x, y] = [handler.offsetX, handler.offsetY];
      vi.advanceTimersByTime(GOTO_INTERVAL_MS * 5);
      expect(handler.offsetX).toBe(x);
      expect(handler.offsetY).toBe(y);
    });
  });
});
