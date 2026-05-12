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
  it("prevents the default action of each Safari gesture event on document", () => {
    const uninstall = installSafariPinchZoomBlocker();

    try {
      for (const type of GESTURE_EVENTS) {
        const event = dispatchCancelableGestureEvent(document, type);
        expect(event.defaultPrevented).toBe(true);
      }
    } finally {
      uninstall();
    }
  });

  it("attaches listeners to the provided target", () => {
    const target = document.createElement("div");
    const uninstall = installSafariPinchZoomBlocker(target);

    try {
      for (const type of GESTURE_EVENTS) {
        const event = dispatchCancelableGestureEvent(target, type);
        expect(event.defaultPrevented).toBe(true);
      }
    } finally {
      uninstall();
    }
  });

  it("removes the listeners when the returned disposer is called", () => {
    const target = document.createElement("div");
    const uninstall = installSafariPinchZoomBlocker(target);
    uninstall();

    for (const type of GESTURE_EVENTS) {
      const event = dispatchCancelableGestureEvent(target, type);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("does not affect events on unrelated targets", () => {
    const scope = document.createElement("div");
    const other = document.createElement("div");
    const uninstall = installSafariPinchZoomBlocker(scope);

    try {
      const event = dispatchCancelableGestureEvent(other, "gesturestart");
      expect(event.defaultPrevented).toBe(false);
    } finally {
      uninstall();
    }
  });

  it("leaves unrelated event types alone", () => {
    const uninstall = installSafariPinchZoomBlocker();

    try {
      const event = new Event("touchstart", {
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      uninstall();
    }
  });
});
