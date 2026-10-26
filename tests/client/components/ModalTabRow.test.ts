import { afterEach, describe, expect, it } from "vitest";
import "../../../src/client/components/baseComponents/Modal";
import type { OModal } from "../../../src/client/components/baseComponents/Modal";
import { BaseModal } from "../../../src/client/components/BaseModal";

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

  it("compacts the tabs below sm, keeping the tap target, and not above", async () => {
    const row = tabRow(await render("stats"));
    // Narrow row padding and no gaps on a phone; as before from sm up.
    expect(row.className).toMatch(/(^| )px-2( |$)/);
    expect(row.className).toContain("sm:px-4");
    expect(row.className).toContain("lg:px-6");
    expect(row.className).toContain("sm:gap-1");
    for (const tab of row.querySelectorAll('[role="tab"]')) {
      const cls = tab.className.split(/\s+/);
      // Phone: smaller, less tracked, less padded labels, still 40px tall.
      expect(cls).toEqual(
        expect.arrayContaining([
          "px-2",
          "text-[11px]",
          "tracking-wide",
          "min-h-10",
          "py-3",
        ]),
      );
      // From sm up, the row as it was.
      expect(cls).toEqual(
        expect.arrayContaining([
          "sm:px-4",
          "sm:text-sm",
          "sm:leading-5",
          "sm:tracking-wider",
        ]),
      );
    }
    // The active tab keeps its underline.
    const active = row.querySelector('[aria-selected="true"]')!;
    expect(active.querySelector(".bg-malibu-blue")).not.toBeNull();
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

describe("o-modal scroll-to-top", () => {
  it("spawns when scrolled down, has localized aria-label, and resets", async () => {
    const modal = await render("stats");
    modal.showScrollToTop = true;
    const scrollEl = modal.shadowRoot!.querySelector<HTMLElement>(
      "[data-modal-scroll]",
    )!;
    Object.defineProperty(scrollEl, "scrollTop", {
      value: 300,
      writable: true,
    });
    scrollEl.dispatchEvent(new Event("scroll"));
    await modal.updateComplete;

    const btn =
      modal.shadowRoot!.querySelector<HTMLButtonElement>("button[aria-label]")!;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("common.scroll_to_top");

    let scrolledTo = false;
    scrollEl.scrollTo = () => {
      scrolledTo = true;
    };
    btn.click();
    await modal.updateComplete;

    expect(scrolledTo).toBe(true);
    expect(modal.shadowRoot!.querySelector("button[aria-label]")).toBeNull();

    // Suppressed during upward scroll animation (scrollTop moving from 300 to 250)
    Object.defineProperty(scrollEl, "scrollTop", {
      value: 250,
      writable: true,
    });
    scrollEl.dispatchEvent(new Event("scroll"));
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("button[aria-label]")).toBeNull();

    // User interrupts by reversing direction (scrolling down to 300): button reappears immediately
    Object.defineProperty(scrollEl, "scrollTop", {
      value: 300,
      writable: true,
    });
    scrollEl.dispatchEvent(new Event("scroll"));
    await modal.updateComplete;
    const interruptedBtn =
      modal.shadowRoot!.querySelector<HTMLButtonElement>("button[aria-label]")!;
    expect(interruptedBtn).not.toBeNull();

    // Click again and test scrollend
    interruptedBtn.click();
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("button[aria-label]")).toBeNull();

    // scrollend clears scrollingToTop flag
    scrollEl.dispatchEvent(new Event("scrollend"));
    await modal.updateComplete;

    // Scrolling down again spawns button
    Object.defineProperty(scrollEl, "scrollTop", {
      value: 250,
      writable: true,
    });
    scrollEl.dispatchEvent(new Event("scroll"));
    await modal.updateComplete;
    expect(
      modal.shadowRoot!.querySelector("button[aria-label]"),
    ).not.toBeNull();

    modal.resetScrollToTop();
    await modal.updateComplete;
    expect(modal.shadowRoot!.querySelector("button[aria-label]")).toBeNull();
  });

  it("resets scroll-to-top when an inline modal closes", async () => {
    class TestInlineModal extends BaseModal {
      protected modalConfig() {
        return { showScrollToTop: true };
      }
    }
    if (!customElements.get("test-inline-scroll-modal")) {
      customElements.define("test-inline-scroll-modal", TestInlineModal);
    }
    const m = document.createElement(
      "test-inline-scroll-modal",
    ) as TestInlineModal;
    m.inline = true;
    document.body.appendChild(m);
    await m.updateComplete;
    m.open();
    await m.updateComplete;

    const modalEl = m.renderRoot.querySelector("o-modal") as OModal;
    await modalEl.updateComplete;
    const scrollEl = modalEl.shadowRoot!.querySelector<HTMLElement>(
      "[data-modal-scroll]",
    )!;
    Object.defineProperty(scrollEl, "scrollTop", {
      value: 300,
      writable: true,
    });
    scrollEl.dispatchEvent(new Event("scroll"));
    await modalEl.updateComplete;
    expect(
      modalEl.shadowRoot!.querySelector("button[aria-label]"),
    ).not.toBeNull();

    m.close();
    await modalEl.updateComplete;
    expect(modalEl.shadowRoot!.querySelector("button[aria-label]")).toBeNull();
  });

  it("adds bottom padding to scroll container only when showScrollToTop is enabled", async () => {
    const modal = await render("stats");
    const scrollEl = modal.shadowRoot!.querySelector<HTMLElement>(
      "[data-modal-scroll]",
    )!;
    expect(scrollEl.className).not.toContain("pb-16");

    modal.showScrollToTop = true;
    await modal.updateComplete;
    expect(scrollEl.className).toContain("pb-16");

    modal.showScrollToTop = false;
    await modal.updateComplete;
    expect(scrollEl.className).not.toContain("pb-16");
  });
});
