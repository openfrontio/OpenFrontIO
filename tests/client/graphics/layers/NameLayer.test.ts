/**
 * @jest-environment jsdom
 */
jest.mock("../../../../src/core/CosmeticSchemas", () => ({}));

import { NameLayer } from "../../../../src/client/graphics/layers/NameLayer";

describe("NameLayer", () => {
  let nameLayer: NameLayer;
  let game: any;
  let transformHandler: any;
  let eventBus: any;

  beforeEach(() => {
    game = {
      ticks: jest.fn().mockReturnValue(1000),
      config: jest.fn().mockReturnValue({
        theme: jest.fn().mockReturnValue("default"),
      }),
    };

    transformHandler = {};
    eventBus = {};

    nameLayer = new NameLayer(game, transformHandler, eventBus);
  });

  test("createAllianceIconWithTimer creates container with timer element", () => {
    const src = "test-icon.png";
    const size = 20;
    const id = "test-alliance";
    const expiresAt = 1500;

    const result = (nameLayer as any).createAllianceIconWithTimer(
      src,
      size,
      id,
      expiresAt,
    );

    expect(result).toBeDefined();
    expect(result.tagName).toBe("DIV");
    expect(result.getAttribute("data-icon")).toBe(id);
    expect(result.style.width).toBe(`${size}px`);
    expect(result.style.height).toBe(`${size}px`);
    expect(result.children.length).toBe(2); // icon + timer

    // Check timer element exists
    const timer = result.querySelector('[data-timer="alliance-timer"]');
    expect(timer).toBeDefined();
    expect(timer.style.position).toBe("absolute");
  });

  test("createAllianceIconWithTimer without expiration creates container", () => {
    const src = "test-icon.png";
    const size = 15;
    const id = "test-alliance-no-timer";

    const result = (nameLayer as any).createAllianceIconWithTimer(
      src,
      size,
      id,
    );

    expect(result).toBeDefined();
    expect(result.children.length).toBe(2); // icon + timer element (but timer won't be updated)
  });

  test("updateAllianceTimer formats time correctly", () => {
    const container = document.createElement("div");
    const timer = document.createElement("div");
    timer.setAttribute("data-timer", "alliance-timer");
    container.appendChild(timer);

    // Test with 650 ticks remaining (65 seconds = 1:05)
    const expiresAt = 1650; // current time (1000) + 650 ticks
    (nameLayer as any).updateAllianceTimer(container, expiresAt);

    expect(timer.textContent).toBe("1:05");

    // Test with 50 ticks remaining (5 seconds = 0:05)
    const expiresAtShort = 1050;
    (nameLayer as any).updateAllianceTimer(container, expiresAtShort);

    expect(timer.textContent).toBe("0:05");

    // Test with expired timer (0 remaining)
    const expiredAt = 900; // before current time
    (nameLayer as any).updateAllianceTimer(container, expiredAt);

    expect(timer.textContent).toBe("0:00");
  });
});
