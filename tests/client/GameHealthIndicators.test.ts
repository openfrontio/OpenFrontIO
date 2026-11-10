import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameHealthIndicators } from "../../src/client/hud/layers/GameHealthIndicators";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

describe("GameHealthIndicators", () => {
  let element: GameHealthIndicators;

  beforeEach(async () => {
    element = new GameHealthIndicators();
    document.body.appendChild(element);
    await element.updateComplete;
  });

  afterEach(() => element.remove());

  const button = (key: string) =>
    element.shadowRoot!.querySelector<HTMLButtonElement>(
      `[data-warning="${key}"]`,
    )!;
  const tooltip = () =>
    element.shadowRoot!.querySelector<HTMLElement>('[role="tooltip"]');

  async function warn() {
    element.status = {
      highLatency: true,
      connectionUnstable: true,
      performance: true,
    };
    await element.updateComplete;
  }

  it("shows no buttons or tooltip until a problem is detected", () => {
    expect(element.shadowRoot!.querySelectorAll("button")).toHaveLength(0);
    expect(tooltip()).toBeNull();
  });

  it("shows each warning independently with accessible translated labels", async () => {
    await warn();
    expect(element.shadowRoot!.querySelectorAll("button")).toHaveLength(3);
    expect(button("highLatency").getAttribute("aria-label")).toBe(
      "game_health.high_latency",
    );
    expect(button("connectionUnstable").getAttribute("aria-label")).toBe(
      "game_health.connection_unstable",
    );
    expect(button("performance").getAttribute("aria-label")).toBe(
      "game_health.performance",
    );
    // Pass-through HUD controls forward pointerdown to the map. These must
    // remain regular UI controls so tapping a warning never issues an action.
    expect(
      element.shadowRoot!.querySelector("[data-game-input-pass-through]"),
    ).toBeNull();
  });

  it("opens and closes explanatory text by tapping on mobile", async () => {
    await warn();
    button("highLatency").click();
    await element.updateComplete;
    expect(tooltip()?.textContent).toContain(
      "game_health.high_latency_description",
    );
    expect(button("highLatency").getAttribute("aria-describedby")).toBe(
      tooltip()?.id,
    );
    button("highLatency").click();
    await element.updateComplete;
    expect(tooltip()).toBeNull();
  });

  it("supports keyboard focus, Escape, and pointer hover", async () => {
    await warn();
    button("performance").focus();
    await element.updateComplete;
    expect(tooltip()?.textContent).toContain(
      "game_health.performance_description",
    );
    button("performance").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape" }),
    );
    await element.updateComplete;
    expect(tooltip()).toBeNull();
    button("connectionUnstable").dispatchEvent(new Event("mouseenter"));
    await element.updateComplete;
    expect(tooltip()?.textContent).toContain(
      "game_health.connection_unstable_description",
    );
    button("connectionUnstable").dispatchEvent(new Event("mouseleave"));
    await element.updateComplete;
    expect(tooltip()).toBeNull();
  });

  it("removes resolved warnings and clears stale explanations between games", async () => {
    await warn();
    button("highLatency").click();
    element.status = {
      highLatency: false,
      connectionUnstable: true,
      performance: false,
    };
    await element.updateComplete;
    expect(tooltip()).toBeNull();
    expect(element.shadowRoot!.querySelectorAll("button")).toHaveLength(1);
    element.clear();
    await element.updateComplete;
    await warn();
    expect(tooltip()).toBeNull();
  });
});
