import { afterEach, describe, expect, it, vi } from "vitest";
import { initNavigation } from "../../src/client/Navigation";

// Re-clicking the nav item of the page already shown changes nothing, so it
// mustn't run that page's close guard (the Inventory's unsaved-card prompt),
// nor close and reopen it: closing the Inventory drops the unsaved card draft.

const confirmBeforeClose = vi.fn(async () => true);
const close = vi.fn();

function setup() {
  const page = document.createElement("div");
  page.id = "page-inventory";
  page.className = "page-content";
  Object.assign(page, { isOpen: () => true, confirmBeforeClose, close });
  document.body.appendChild(page);
  for (const id of ["page-inventory", "page-store"]) {
    const item = document.createElement("button");
    item.className = "nav-menu-item";
    item.dataset.page = id;
    document.body.appendChild(item);
  }
}

initNavigation();

afterEach(() => {
  document.body.replaceChildren();
  confirmBeforeClose.mockClear();
  close.mockClear();
});

const click = async (id: string) => {
  document
    .querySelector<HTMLElement>(`.nav-menu-item[data-page='${id}']`)!
    .click();
  await new Promise((r) => setTimeout(r, 0));
};

describe("nav: the page already shown", () => {
  it("re-clicking it doesn't ask to leave", async () => {
    setup();
    await click("page-inventory");
    expect(confirmBeforeClose).not.toHaveBeenCalled();
  });

  it("re-clicking it doesn't close and reopen it, so the draft survives", async () => {
    setup();
    await click("page-inventory");
    expect(close).not.toHaveBeenCalled();
    expect(document.getElementById("page-inventory")!.classList).not.toContain(
      "hidden",
    );
  });

  it("another page still asks first", async () => {
    setup();
    await click("page-store");
    expect(confirmBeforeClose).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
