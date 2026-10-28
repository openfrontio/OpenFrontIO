import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, it, vi } from "vitest";
import "../../src/client/hud/layers/TutorialPanel";
import type { TutorialPanel } from "../../src/client/hud/layers/TutorialPanel";
import type { UserSettings } from "../../src/client/UserSettings";
import type { GameView } from "../../src/client/view";

function firstTick(resumedFromSave: boolean) {
  const myPlayer = vi.fn(() => null);
  const panel = document.createElement("tutorial-panel") as TutorialPanel;
  panel.game = {
    config: () => ({ isReplay: () => false }),
    myPlayer,
    resumedFromSave: () => resumedFromSave,
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
    expect(firstTick(false).myPlayer).toHaveBeenCalled();
  });

  // Its first steps would hold the spawn ring on the player's territory
  // until they next attack.
  it("stays off in a game resumed from a save", () => {
    expect(firstTick(true).myPlayer).not.toHaveBeenCalled();
  });
});
