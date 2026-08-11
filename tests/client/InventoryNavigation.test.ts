import type { LitElement } from "lit";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopNavBar } from "../../src/client/components/DesktopNavBar";
import { MobileNavBar } from "../../src/client/components/MobileNavBar";
import { PlayPage } from "../../src/client/components/PlayPage";

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
  });
}

async function mount<T extends LitElement>(element: T): Promise<T> {
  document.body.appendChild(element);
  await element.updateComplete;
  return element;
}

afterEach(() => document.body.replaceChildren());

describe("Inventory navigation", () => {
  it("renders Inventory in desktop and mobile navigation", async () => {
    const desktop = await mount(new DesktopNavBar());
    const mobile = await mount(new MobileNavBar());
    expect(
      desktop.querySelector(
        '[data-page="page-inventory"][data-i18n="main.inventory"]',
      ),
    ).toBeTruthy();
    expect(mobile.querySelector('[data-page="page-inventory"]')).toBeTruthy();
    expect(
      mobile.querySelector(
        '[data-page="page-inventory"] [data-i18n="main.inventory"], [data-page="page-inventory"][data-i18n="main.inventory"]',
      ),
    ).toBeTruthy();
  });

  it("removes cosmetic and flag selectors from the play page", async () => {
    const play = await mount(new PlayPage());
    expect(play.querySelector("cosmetics-input")).toBeNull();
    expect(play.querySelector("flag-input")).toBeNull();
    expect(play.querySelector("username-input")).toBeTruthy();
  });

  it("declares only the routed Inventory page in index.html", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "index.html"),
      "utf8",
    );
    expect(source).toContain('<inventory-modal\n          id="page-inventory"');
    expect(source).not.toContain("<cosmetics-modal");
    expect(source).not.toContain("<flag-input-modal");
  });
});
