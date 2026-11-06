import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "../../src/client/HelpModal";
import type { HelpModal } from "../../src/client/HelpModal";

const matchMediaDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "matchMedia",
);

function setPrimaryPointerIsTouch(isTouch: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (media: string) => ({
      matches: isTouch && media === "(pointer: coarse)",
    }),
  });
}

async function mountHelpModal(): Promise<HelpModal> {
  const modal = document.createElement("help-modal") as HelpModal;
  document.body.appendChild(modal);
  await modal.updateComplete;
  return modal;
}

describe("HelpModal mobile rendering", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    delete (window as Window & { __hasKeyboard?: boolean }).__hasKeyboard;
  });

  afterEach(() => {
    document.body.replaceChildren();
    delete (window as Window & { __hasKeyboard?: boolean }).__hasKeyboard;
    if (matchMediaDescriptor) {
      Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("hides Hotkeys on a touchscreen-only device", async () => {
    setPrimaryPointerIsTouch(true);

    const modal = await mountHelpModal();

    expect(
      (modal.querySelector("#help-hotkeys-heading") as HTMLElement).hidden,
    ).toBe(true);
    expect(
      (modal.querySelector("#help-hotkeys-content") as HTMLElement).hidden,
    ).toBe(true);
  });

  it("shows Hotkeys when a touchscreen device has a keyboard", async () => {
    setPrimaryPointerIsTouch(true);
    (window as Window & { __hasKeyboard?: boolean }).__hasKeyboard = true;

    const modal = await mountHelpModal();

    expect(
      (modal.querySelector("#help-hotkeys-heading") as HTMLElement).hidden,
    ).toBe(false);
    expect(
      (modal.querySelector("#help-hotkeys-content") as HTMLElement).hidden,
    ).toBe(false);
  });

  it("shows Hotkeys on a non-touch device", async () => {
    setPrimaryPointerIsTouch(false);

    const modal = await mountHelpModal();

    expect(
      (modal.querySelector("#help-hotkeys-heading") as HTMLElement).hidden,
    ).toBe(false);
    expect(
      (modal.querySelector("#help-hotkeys-content") as HTMLElement).hidden,
    ).toBe(false);
  });

  it("shows the translated troubleshooting label with mobile wrapping", async () => {
    setPrimaryPointerIsTouch(true);

    const modal = await mountHelpModal();
    const button = modal.querySelector<HTMLButtonElement>(
      "#troubleshooting-button",
    );
    const label = button?.querySelector("span");

    expect(label?.textContent?.trim()).toBeTruthy();
    expect(button?.classList.contains("w-full")).toBe(true);
    expect(button?.classList.contains("whitespace-normal")).toBe(true);
    expect(button?.classList.contains("break-words")).toBe(true);
  });
});
