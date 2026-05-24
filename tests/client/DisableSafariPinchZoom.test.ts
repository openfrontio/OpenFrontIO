import { installSafariPinchZoomBlocker } from "../../src/client/utilities/DisableSafariPinchZoom";

const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

function dispatchCancelableGestureEvent(
  target: EventTarget,
  type: string,
): Event {
  // Safari's GestureEvent is not available in jsdom. Dispatch a plain
  // cancelable Event of the same name so preventDefault() is observable via
  // defaultPrevented.
  const event = new Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("installSafariPinchZoomBlocker", () => {
  it("calls preventDefault on each Safari gesture event dispatched at the target", () => {
    const target = document.createElement("div");
    installSafariPinchZoomBlocker(target);

    for (const type of GESTURE_EVENTS) {
      const event = dispatchCancelableGestureEvent(target, type);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it("defaults to attaching the listeners to document", () => {
    const addEventListenerSpy = vi
      .spyOn(document, "addEventListener")
      .mockImplementation(() => {});

    try {
      installSafariPinchZoomBlocker();

      for (const type of GESTURE_EVENTS) {
        expect(addEventListenerSpy).toHaveBeenCalledWith(
          type,
          expect.any(Function),
        );
      }
    } finally {
      addEventListenerSpy.mockRestore();
    }
  });

  it("does not affect events dispatched at unrelated targets", () => {
    const scope = document.createElement("div");
    const other = document.createElement("div");
    installSafariPinchZoomBlocker(scope);

    const event = dispatchCancelableGestureEvent(other, "gesturestart");
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves unrelated event types alone", () => {
    const target = document.createElement("div");
    installSafariPinchZoomBlocker(target);

    const event = new Event("touchstart", { bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
