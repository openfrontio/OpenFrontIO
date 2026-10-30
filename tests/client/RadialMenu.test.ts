import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RadialMenu } from "../../src/client/hud/layers/RadialMenu";
import {
  centerButtonElement,
  rootMenuElement,
} from "../../src/client/hud/layers/RadialMenuElements";
import { CloseViewEvent, FORWARDED_CLICK } from "../../src/client/InputHandler";

// jsdom has no layout, so there is no element under a point to forward to.
function stubElementFromPoint(element: Element | null) {
  (document as any).elementFromPoint = vi.fn(() => element);
}

describe("RadialMenu overlay click-through", () => {
  afterEach(() => {
    delete (document as any).elementFromPoint;
    document
      .querySelectorAll(".radial-menu-container")
      .forEach((el) => el.remove());
  });

  function makeMenu() {
    const eventBus = new EventBus();
    const radialMenu = new RadialMenu(
      eventBus,
      rootMenuElement,
      centerButtonElement,
    );
    radialMenu.init();
    const overlay = document.querySelector(
      ".radial-menu-container",
    ) as HTMLElement;
    return { eventBus, radialMenu, overlay };
  }

  function makeBuildBarButton() {
    const layer = document.createElement("div");
    layer.setAttribute("data-radial-click-through", "");
    const button = document.createElement("button");
    layer.appendChild(button);
    document.body.appendChild(layer);
    const clicks: MouseEvent[] = [];
    button.addEventListener("click", (event) => clicks.push(event));
    return { button, clicks };
  }

  test("forwards a tap on the overlay to the build bar below it", () => {
    const { overlay } = makeMenu();
    const { button, clicks } = makeBuildBarButton();
    stubElementFromPoint(button);

    overlay.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }),
    );

    expect(clicks).toHaveLength(1);
    expect(clicks[0].clientX).toBe(10);
    expect(clicks[0].clientY).toBe(20);
    // The layer has to be able to tell a forwarded tap from a real press.
    expect(
      (clicks[0] as unknown as Record<string, unknown>)[FORWARDED_CLICK],
    ).toBe(true);
  });

  test("forwards a tap that landed on the menu's background", () => {
    // The menu's SVG is a large hit-testable box around the tap point, so a
    // tap on the build bar lands on it whenever the menu is close enough.
    const { overlay } = makeMenu();
    const { button, clicks } = makeBuildBarButton();
    stubElementFromPoint(button);

    const svg = overlay.querySelector("svg") as SVGElement;
    svg.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }),
    );

    expect(clicks).toHaveLength(1);
    expect(
      (clicks[0] as unknown as Record<string, unknown>)[FORWARDED_CLICK],
    ).toBe(true);
  });

  test("does not forward a tap on a menu item", () => {
    // Menu items stop the click from bubbling, so the overlay never sees it.
    const { overlay } = makeMenu();
    const { button, clicks } = makeBuildBarButton();
    stubElementFromPoint(button);

    const svg = overlay.querySelector("svg") as SVGElement;
    const item = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    ) as SVGPathElement;
    item.addEventListener("click", (event) => event.stopPropagation());
    svg.appendChild(item);
    item.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }),
    );

    expect(clicks).toHaveLength(0);
  });

  test("does not forward taps that miss the build bar", () => {
    const { overlay } = makeMenu();
    const other = document.createElement("div");
    document.body.appendChild(other);
    const clicks: MouseEvent[] = [];
    other.addEventListener("click", (event) => clicks.push(event));
    stubElementFromPoint(other);

    overlay.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 20 }),
    );

    expect(clicks).toHaveLength(0);
  });

  test("closes when the view is closed", () => {
    const { eventBus, radialMenu, overlay } = makeMenu();
    // The menu needs its params to rebuild itself on close; the overlay
    // hiding is what this test is about.
    vi.spyOn(radialMenu as any, "resetMenu").mockImplementation(() => {});
    (radialMenu as any).isVisible = true;
    overlay.style.display = "block";

    eventBus.emit(new CloseViewEvent());

    expect(overlay.style.display).toBe("none");
  });
});
