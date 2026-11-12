import { UnitType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameHealthIndicators } from "../../src/client/hud/layers/GameHealthIndicators";
import {
  ConfirmGhostStructureEvent,
  InputHandler,
} from "../../src/client/InputHandler";
import type { UIState } from "../../src/client/UIState";
import type { GameView } from "../../src/client/view";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

describe("health warning keyboard activation over a build preview", () => {
  let element: GameHealthIndicators;
  let handler: InputHandler;
  let eventBus: EventBus;
  let uiState: UIState;
  let confirm = vi.fn<(event: ConfirmGhostStructureEvent) => void>();

  beforeEach(async () => {
    eventBus = new EventBus();
    confirm = vi.fn<(event: ConfirmGhostStructureEvent) => void>();
    eventBus.on(ConfirmGhostStructureEvent, confirm);
    uiState = {
      attackRatio: 20,
      ghostStructure: UnitType.City,
      rocketDirectionUp: true,
      upgradeMultiplier: 1,
    };
    handler = new InputHandler(
      { inSpawnPhase: () => false } as GameView,
      uiState,
      document.createElement("canvas"),
      eventBus,
    );
    handler.initialize();
    element = new GameHealthIndicators();
    element.status = {
      highLatency: true,
      connectionUnstable: false,
      performance: false,
    };
    document.body.appendChild(element);
    await element.updateComplete;
  });

  afterEach(() => {
    handler.destroy();
    element.remove();
    vi.restoreAllMocks();
  });

  const button = () => element.shadowRoot!.querySelector("button")!;
  const tooltip = () => element.shadowRoot!.querySelector('[role="tooltip"]');
  const keydown = (code: string, key: string) =>
    new KeyboardEvent("keydown", {
      code,
      key,
      bubbles: true,
      composed: true,
      cancelable: true,
    });

  it.each(["Enter", "NumpadEnter"])(
    "keeps %s for native warning activation without confirming the preview",
    async (code) => {
      const control = button();
      control.focus();
      const enter = keydown(code, "Enter");
      control.dispatchEvent(enter);
      expect(confirm).not.toHaveBeenCalled();
      expect(uiState.ghostStructure).toBe(UnitType.City);
      // jsdom does not synthesize a native button click from a keyboard
      // event; preserve that browser default and simulate its resulting click.
      expect(enter.defaultPrevented).toBe(false);
      control.click();
      control.dispatchEvent(new Event("mouseleave"));
      await element.updateComplete;
      expect(tooltip()?.textContent).toContain(
        "game_health.high_latency_description",
      );
      control.click();
      await element.updateComplete;
      expect(tooltip()).toBeNull();
    },
  );

  it("still confirms the build preview with Enter outside the warning", () => {
    window.dispatchEvent(keydown("Enter", "Enter"));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("keeps Escape available to dismiss the tooltip and cancel the preview", async () => {
    button().click();
    await element.updateComplete;
    expect(tooltip()).not.toBeNull();
    button().dispatchEvent(keydown("Escape", "Escape"));
    await element.updateComplete;
    expect(tooltip()).toBeNull();
    expect(uiState.ghostStructure).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });
});
