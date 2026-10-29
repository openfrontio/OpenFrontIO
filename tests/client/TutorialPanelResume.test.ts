import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, it, vi } from "vitest";
import "../../src/client/hud/layers/TutorialPanel";
import type { TutorialPanel } from "../../src/client/hud/layers/TutorialPanel";
import type { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

function firstTick(tutorial?: boolean) {
  const myPlayer = vi.fn(() => null);
  const panel = document.createElement("tutorial-panel") as TutorialPanel;
  panel.game = {
    config: () => ({ isReplay: () => false, gameConfig: () => ({ tutorial }) }),
    myPlayer,
    setOwnSpawnRing: vi.fn(),
    setMarkedPlayers: vi.fn(),
  } as unknown as GameView;
  panel.eventBus = new EventBus();
  panel.userSettings = {
    tutorialDismissed: () => false,
  } as unknown as UserSettings;
  panel.tick();
  return { myPlayer };
}

describe("TutorialPanel", () => {
  it("runs for a player who hasn't dismissed it", () => {
    expect(firstTick().myPlayer).toHaveBeenCalled();
  });

  // The onboarding tutorial has its own guide (OnboardingOverlay).
  it("stays off in the onboarding tutorial", () => {
    expect(firstTick(true).myPlayer).not.toHaveBeenCalled();
  });
});
