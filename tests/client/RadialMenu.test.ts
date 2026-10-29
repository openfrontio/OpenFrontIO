import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, describe, expect, test, vi } from "vitest";
import { RadialMenu } from "../../src/client/hud/layers/RadialMenu";
import {
  centerButtonElement,
  rootMenuElement,
} from "../../src/client/hud/layers/RadialMenuElements";

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
    const radialMenu = new RadialMenu(
      new EventBus(),
      rootMenuElement,
      centerButtonElement,
    );
    radialMenu.init();
    const overlay = document.querySelector(
      ".radial-menu-container",
    ) as HTMLElement;
    return { radialMenu, overlay };
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
  });

  test("does not forward taps that landed on the menu itself", () => {
    const { overlay } = makeMenu();
    const { button, clicks } = makeBuildBarButton();
    stubElementFromPoint(button);

    const svg = overlay.querySelector("svg") as SVGElement;
    svg.dispatchEvent(
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
});
