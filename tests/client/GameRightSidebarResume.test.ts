import { GameType } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, it, vi } from "vitest";
import { gamePortal } from "../../src/client/GamePortal";
import "../../src/client/hud/layers/GameRightSidebar";
import type { GameRightSidebar } from "../../src/client/hud/layers/GameRightSidebar";
import { PauseGameIntentEvent } from "../../src/client/Transport";
import type { GameView } from "../../src/client/view";

type TestSidebar = GameRightSidebar & { updateComplete: Promise<unknown> };

async function mount(resumedFromSave: boolean) {
  const config = {
    gameConfig: () => ({ gameType: GameType.Singleplayer }),
    doomsdayClockConfig: () => ({ enabled: false }),
    overtimeConfig: () => ({ enabled: false, startMinutes: 0 }),
    isReplay: () => false,
    listed: false,
  };
  const el = document.createElement("game-right-sidebar") as TestSidebar;
  el.game = {
    config: () => config,
    inSpawnPhase: () => false,
    elapsedGameSeconds: () => 0,
    myPlayer: () => undefined,
    gameID: () => "test-game",
    resumedFromSave: () => resumedFromSave,
  } as unknown as GameView;
  el.eventBus = new EventBus();
  el.init();
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const pauseButton = (el: TestSidebar) =>
  el.renderRoot.querySelector<HTMLImageElement>('img[alt="play/pause"]')!;

describe("GameRightSidebar on a resumed save", () => {
  it("shows Play, since LocalServer opens the game paused", async () => {
    vi.spyOn(gamePortal, "gameplayStart").mockImplementation(async () => {});
    const el = await mount(true);
    expect(pauseButton(el).src).toContain("PlayIconWhite");

    const intents: boolean[] = [];
    el.eventBus.on(PauseGameIntentEvent, (e) => intents.push(e.paused));
    pauseButton(el).parentElement!.click();
    expect(intents).toEqual([false]);
  });

  it("shows Pause in a new game", async () => {
    const el = await mount(false);
    expect(pauseButton(el).src).toContain("PauseIconWhite");
  });
});
