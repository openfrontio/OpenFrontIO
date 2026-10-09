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

  // jsdom does no layout: give the row a width and each tab a box, 100px
  // apiece from the row's left edge, moved by the row's scroll.
  function layOut(modal: OModal, rowWidth: number): HTMLElement {
    const row = tabRow(modal);
    const tabEls = [...row.querySelectorAll<HTMLElement>('[role="tab"]')];
    Object.defineProperty(row, "clientWidth", { value: rowWidth });
    Object.defineProperty(row, "scrollWidth", { value: tabEls.length * 100 });
    row.getBoundingClientRect = () => new DOMRect(0, 0, rowWidth, 40);
    tabEls.forEach((tab, i) => {
      tab.getBoundingClientRect = () =>
        new DOMRect(i * 100 - row.scrollLeft, 0, 100, 40);
    });
    return row;
  }

  it("scrolls the row, and only the row, to the active tab when it changes", async () => {
    const scrolled: string[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolled.push(this.dataset.key ?? "");
      },
    });
    const modal = await render("stats");
    const row = layOut(modal, 250);
    modal.activeTab = "progression";
    await modal.updateComplete;
    // The last tab spans 300-400: its right edge meets the row's.
    expect(row.scrollLeft).toBe(150);
    modal.activeTab = "stats";
    await modal.updateComplete;
    expect(row.scrollLeft).toBe(0);
    expect(scrolled).toEqual([]);
  });

  it("leaves a row that fits alone", async () => {
    const modal = await render("stats");
    const row = layOut(modal, 400);
    modal.activeTab = "progression";
    await modal.updateComplete;
    expect(row.scrollLeft).toBe(0);
  });
});
