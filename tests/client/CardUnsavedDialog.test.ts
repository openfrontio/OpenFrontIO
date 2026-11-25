import { afterEach, describe, expect, it } from "vitest";
import "../../src/client/components/inventory/CardUnsavedDialog";

type Dialog = HTMLElement & {
  count: number;
  lines: string[];
  saving: boolean;
  updateComplete: Promise<unknown>;
};

async function mount(saving: boolean): Promise<Dialog> {
  const dialog = document.createElement("card-unsaved-dialog") as Dialog;
  dialog.count = 1;
  dialog.lines = ["Tracker 3: Games played"];
  dialog.saving = saving;
  document.body.appendChild(dialog);
  await dialog.updateComplete;
  return dialog;
}

function tab(shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<card-unsaved-dialog> focus", () => {
  it("Tab past the last button wraps to the first", async () => {
    const dialog = await mount(false);
    const buttons = [
      ...dialog.querySelectorAll<HTMLButtonElement>("button:not([disabled])"),
    ];
    expect(buttons.length).toBeGreaterThan(1);
    buttons[buttons.length - 1].focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("while saving (every button disabled), Tab still can't leave the dialog", async () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    await mount(true);
    expect(tab().defaultPrevented).toBe(true);
    expect(tab(true).defaultPrevented).toBe(true);
  });
});
