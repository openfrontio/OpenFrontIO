import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeadsUpMessage } from "../../src/client/hud/layers/HeadsUpMessage";

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    button: 0,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
}

describe("HeadsUpMessage toast gestures", () => {
  let element: HeadsUpMessage;

  beforeEach(async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
    });
    if (!customElements.get("heads-up-message")) {
      customElements.define("heads-up-message", HeadsUpMessage);
    }
    element = document.createElement("heads-up-message") as HeadsUpMessage;
    document.body.appendChild(element);
    await element.updateComplete;
  });

  afterEach(() => {
    element.remove();
    vi.unstubAllGlobals();
  });

  async function showToast(): Promise<HTMLElement> {
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: "Connection failed",
          color: "red",
          duration: 60_000,
        },
      }),
    );
    await element.updateComplete;
    const toast = element.querySelector<HTMLElement>("[data-game-toast]");
    expect(toast).not.toBeNull();
    Object.defineProperty(toast, "setPointerCapture", { value: () => {} });
    return toast!;
  }

  it("follows a drag and snaps back below the dismissal threshold", async () => {
    const toast = await showToast();

    dispatchPointer(toast, "pointerdown", 10, 10);
    dispatchPointer(toast, "pointermove", 50, 30);
    await element.updateComplete;
    expect(
      element.querySelector<HTMLElement>("[data-game-toast-content]")?.style
        .transform,
    ).toBe("translate3d(40px, 20px, 0)");

    dispatchPointer(toast, "pointerup", 50, 30);
    await element.updateComplete;
    expect(element.querySelector("[data-game-toast]")).not.toBeNull();
    expect(
      element.querySelector<HTMLElement>("[data-game-toast-content]")?.style
        .transform,
    ).toBe("translate3d(0px, 0px, 0)");
  });

  it("dismisses the toast after dragging past the threshold", async () => {
    const toast = await showToast();

    dispatchPointer(toast, "pointerdown", 0, 0);
    dispatchPointer(toast, "pointermove", 80, 0);
    dispatchPointer(toast, "pointerup", 80, 0);
    await element.updateComplete;

    expect(element.querySelector("[data-game-toast]")).toBeNull();
  });

  it("restores the toast when the pointer gesture is cancelled", async () => {
    const toast = await showToast();

    dispatchPointer(toast, "pointerdown", 0, 0);
    dispatchPointer(toast, "pointermove", 100, 20);
    dispatchPointer(toast, "pointercancel", 100, 20);
    await element.updateComplete;

    expect(element.querySelector("[data-game-toast]")).not.toBeNull();
    expect(
      element.querySelector<HTMLElement>("[data-game-toast-content]")?.style
        .transform,
    ).toBe("translate3d(0px, 0px, 0)");
  });
});
