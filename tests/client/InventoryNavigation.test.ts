import fs from "fs";
import type { LitElement } from "lit";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../src/client/InventoryModal";
import type { InventoryModal } from "../../src/client/InventoryModal";
import { modalRouter } from "../../src/client/ModalRouter";
import { initNavigation } from "../../src/client/Navigation";
import { DesktopNavBar } from "../../src/client/components/DesktopNavBar";
import { MobileNavBar } from "../../src/client/components/MobileNavBar";
import { PlayPage } from "../../src/client/components/PlayPage";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import type { Cosmetics } from "../../src/core/CosmeticSchemas";

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

  it("routes an actual navigation click with the active tab and restores deep links", async () => {
    history.replaceState(null, "", "/");
    const play = document.createElement("div");
    play.id = "page-play";
    document.body.appendChild(play);
    const inventory = document.createElement(
      "inventory-modal",
    ) as InventoryModal;
    inventory.id = "page-inventory";
    inventory.setAttribute("inline", "");
    inventory.className = "page-content hidden";
    Object.assign(inventory as unknown as Record<string, unknown>, {
      cosmetics: {
        patterns: {},
        flags: {},
        crowns: {},
        skins: {},
        effects: {},
      } as Cosmetics,
      userMeResponse: {
        user: {},
        player: { flares: [] },
      } as unknown as UserMeResponse,
      ownershipState: "loaded",
      isLoading: false,
      loadFailed: false,
    });
    document.body.appendChild(inventory);
    const desktop = await mount(new DesktopNavBar());
    modalRouter.register("inventory", {
      tag: "inventory-modal",
      pageId: "page-inventory",
    });
    initNavigation();

    desktop.querySelector<HTMLElement>('[data-page="page-inventory"]')!.click();

    await vi.waitFor(() => {
      expect(window.location.hash).toBe("#modal=inventory&tab=skins");
    });
    expect(
      desktop
        .querySelector<HTMLElement>('[data-page="page-inventory"]')!
        .classList.contains("active"),
    ).toBe(true);

    inventory.setActiveTab("effects");
    expect(window.location.hash).toBe("#modal=inventory&tab=effects");

    inventory.close();
    history.replaceState(null, "", "/#modal=inventory&tab=crowns");
    expect(modalRouter.routeFromHash()).toBe(true);
    await vi.waitFor(() => {
      expect((inventory as unknown as { activeTab: string }).activeTab).toBe(
        "crowns",
      );
    });
    expect(window.location.hash).toBe("#modal=inventory&tab=crowns");
  });
});
