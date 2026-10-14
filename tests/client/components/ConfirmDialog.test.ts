import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/components/ConfirmDialog";
import type { ConfirmDialog } from "../../../src/client/components/ConfirmDialog";

describe("<confirm-dialog> message", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the message's paragraph breaks and adds none of its own", async () => {
    const dialog = document.createElement("confirm-dialog") as ConfirmDialog;
    dialog.message = "First paragraph.\n\nSecond paragraph.";
    document.body.appendChild(dialog);
    await dialog.updateComplete;

    // The dialog renders into a portal on <body>, not inside itself.
    const p = document.body.querySelector("p.whitespace-pre-line")!;
    expect(p.textContent).toBe("First paragraph.\n\nSecond paragraph.");
    expect(p.classList.contains("whitespace-pre-line")).toBe(true);
  });
});
