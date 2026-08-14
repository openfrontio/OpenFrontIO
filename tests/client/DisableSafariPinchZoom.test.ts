import {
  installDoubleTapZoomBlocker,
  installSafariPinchZoomBlocker,
} from "../../src/client/utilities/DisableSafariPinchZoom";

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

function dispatchTouchEnd(
  target: EventTarget,
  timeStamp: number,
  position?: { x: number; y: number },
): Event {
  // jsdom has no TouchEvent constructor; dispatch a plain cancelable Event
  // with the read-only timeStamp (and, when given, changedTouches) stubbed.
  const event = new Event("touchend", {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  if (position) {
    Object.defineProperty(event, "changedTouches", {
      value: [{ clientX: position.x, clientY: position.y }],
    });
  }
  target.dispatchEvent(event);
  return event;
}

describe("installDoubleTapZoomBlocker", () => {
  it("cancels the second tap of a double-tap", () => {
    const target = document.createElement("div");
    installDoubleTapZoomBlocker(target);

    expect(dispatchTouchEnd(target, 1000).defaultPrevented).toBe(false);
    expect(dispatchTouchEnd(target, 1200).defaultPrevented).toBe(true);
  });

  it("leaves taps alone when they are too far apart in time", () => {
    const target = document.createElement("div");
    installDoubleTapZoomBlocker(target);

    expect(dispatchTouchEnd(target, 1000).defaultPrevented).toBe(false);
    expect(dispatchTouchEnd(target, 2000).defaultPrevented).toBe(false);
  });

  it("leaves taps alone when they are too far apart on screen", () => {
    const target = document.createElement("div");
    installDoubleTapZoomBlocker(target);

    dispatchTouchEnd(target, 1000, { x: 0, y: 0 });
    const second = dispatchTouchEnd(target, 1200, { x: 400, y: 300 });
    expect(second.defaultPrevented).toBe(false);
  });

  it("does not cancel double-taps on interactive elements", () => {
    const scope = document.createElement("div");
    const button = scope.appendChild(document.createElement("button"));
    installDoubleTapZoomBlocker(scope);

    expect(dispatchTouchEnd(button, 1000).defaultPrevented).toBe(false);
    expect(dispatchTouchEnd(button, 1200).defaultPrevented).toBe(false);
  });

  it("recognizes interactive elements inside shadow DOM", () => {
    const scope = document.createElement("div");
    const host = scope.appendChild(document.createElement("div"));
    const shadow = host.attachShadow({ mode: "open" });
    const button = shadow.appendChild(document.createElement("button"));
    installDoubleTapZoomBlocker(scope);

    expect(dispatchTouchEnd(button, 1000).defaultPrevented).toBe(false);
    expect(dispatchTouchEnd(button, 1200).defaultPrevented).toBe(false);
  });

  it("defaults to attaching the listener to document", () => {
    const addEventListenerSpy = vi
      .spyOn(document, "addEventListener")
      .mockImplementation(() => {});

    try {
      installDoubleTapZoomBlocker();

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "touchend",
        expect.any(Function),
        { passive: false },
      );
    } finally {
      addEventListenerSpy.mockRestore();
    }
  });
});
