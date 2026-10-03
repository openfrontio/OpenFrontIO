import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/components/baseComponents/Modal";
import type { OModal } from "../../../src/client/components/baseComponents/Modal";

const tabs = ["stats", "games", "clans", "progression"].map((key) => ({
  key,
  label: key,
}));

async function render(activeTab: string): Promise<OModal> {
  const modal = document.createElement("o-modal") as OModal;
  modal.tabs = tabs;
  modal.activeTab = activeTab;
  modal.inline = true;
  document.body.appendChild(modal);
  await modal.updateComplete;
  return modal;
}

function tabRow(modal: OModal): HTMLElement {
  return modal.shadowRoot!.querySelector<HTMLElement>('[role="tablist"]')!;
}

afterEach(() => {
  document.body.innerHTML = "";
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe("o-modal tab row", () => {
  it("keeps every tab on one scrollable row instead of wrapping", async () => {
    const row = tabRow(await render("stats"));
    expect(row.className).toContain("flex-nowrap");
    expect(row.className).toContain("overflow-x-auto");
    expect(row.className).not.toMatch(/\bflex-wrap\b/);
    for (const tab of row.querySelectorAll('[role="tab"]')) {
      expect(tab.className).toContain("shrink-0");
      expect(tab.className).toContain("whitespace-nowrap");
    }
  });

  it("brings the active tab into view when it changes", async () => {
    // jsdom has no scrollIntoView; give tabs one that records the call.
    const seen: string[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        seen.push(this.dataset.key ?? "");
      },
    });
    const modal = await render("stats");
    modal.activeTab = "progression";
    await modal.updateComplete;
    expect(seen[seen.length - 1]).toBe("progression");
  });
});
