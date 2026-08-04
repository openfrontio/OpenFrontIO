import { GameRightSidebar } from "../src/client/hud/layers/GameRightSidebar";
import type { GameView } from "../src/client/view";
import { EventBus } from "../src/core/EventBus";
import { GameType } from "../src/core/game/Game";

vi.mock("../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/client/Utils")>()),
  translateText: (key: string) => key,
}));

interface TimerState {
  elapsedSeconds: number;
  inSpawnPhase: boolean;
  maxTimerValue: number | null;
  ticks: number;
}

function createSidebar(overrides: Partial<TimerState> = {}) {
  const state: TimerState = {
    elapsedSeconds: 0,
    inSpawnPhase: false,
    maxTimerValue: 2,
    ticks: 0,
    ...overrides,
  };
  const eventBus = new EventBus();
  const game = {
    config: () => ({
      doomsdayClockConfig: () => undefined,
      gameConfig: () => ({
        gameType: GameType.Public,
        maxTimerValue: state.maxTimerValue,
      }),
      isReplay: () => false,
      listed: false,
      numSpawnPhaseTurns: () => 400,
    }),
    elapsedGameSeconds: () => state.elapsedSeconds,
    inSpawnPhase: () => state.inSpawnPhase,
    myPlayer: () => undefined,
    ticks: () => state.ticks,
  } as unknown as GameView;

  const sidebar = new GameRightSidebar();
  sidebar.game = game;
  sidebar.eventBus = eventBus;
  document.body.appendChild(sidebar);
  sidebar.init();

  const setRemainingSeconds = async (remaining: number) => {
    if (state.maxTimerValue === null) {
      throw new Error("Cannot set remaining time without an end timer");
    }
    state.elapsedSeconds = state.maxTimerValue * 60 - remaining;
    sidebar.tick();
    await sidebar.updateComplete;
  };

  return { sidebar, state, setRemainingSeconds };
}

describe("GameRightSidebar end timer warnings", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("turns red and shows one centered alert at the one-minute mark", async () => {
    const { sidebar, setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(61);
    expect(sidebar.querySelector('[role="alert"]')).toBeNull();
    expect(sidebar.querySelector("[data-game-timer]")?.className).toBe("");

    await setRemainingSeconds(60);
    const alert = sidebar.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("game_timer.one_minute_remaining");
    expect(alert?.className).toContain("top-1/2");
    expect(alert?.className).toContain("left-1/2");
    expect(sidebar.querySelector("[data-game-timer]")?.className).toContain(
      "game-end-timer-last-minute",
    );

    alert?.dispatchEvent(new Event("animationend"));
    await sidebar.updateComplete;
    expect(sidebar.querySelector('[role="alert"]')).toBeNull();

    await setRemainingSeconds(59);
    expect(sidebar.querySelector('[role="alert"]')).toBeNull();
  });

  it("dismisses the one-minute alert after four seconds", async () => {
    vi.useFakeTimers();
    const { sidebar, setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(60);
    expect(sidebar.querySelector('[role="alert"]')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(4_000);
    await sidebar.updateComplete;
    expect(sidebar.querySelector('[role="alert"]')).toBeNull();
  });

  it("clears an active warning across disconnect and reconnect", async () => {
    vi.useFakeTimers();
    const { sidebar, setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(60);
    expect(sidebar.querySelector('[role="alert"]')).not.toBeNull();

    sidebar.remove();
    expect(vi.getTimerCount()).toBe(0);
    document.body.appendChild(sidebar);
    await sidebar.updateComplete;

    expect(sidebar.querySelector('[role="alert"]')).toBeNull();
  });

  it("dismisses an active warning when the timer reaches zero", async () => {
    vi.useFakeTimers();
    const { sidebar, setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(60);
    expect(sidebar.querySelector('[role="alert"]')).not.toBeNull();

    await setRemainingSeconds(0);

    expect(sidebar.querySelector('[role="alert"]')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flashes the timer for the last 30 seconds", async () => {
    const { sidebar, setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(31);
    expect(sidebar.querySelector("[data-game-timer]")?.className).toContain(
      "game-end-timer-last-minute",
    );
    expect(sidebar.querySelector("[data-game-timer]")?.className).not.toContain(
      "game-end-timer-flash",
    );

    await setRemainingSeconds(30);
    expect(sidebar.querySelector("[data-game-timer]")?.className).toContain(
      "game-end-timer-flash",
    );
  });

  it("flashes the whole sidebar for the last 10 seconds", async () => {
    const { sidebar, setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(11);
    expect(sidebar.querySelector("aside")?.className).not.toContain(
      "game-end-timer-sidebar-flash",
    );

    await setRemainingSeconds(10);
    expect(sidebar.querySelector("aside")?.className).toContain(
      "game-end-timer-sidebar-flash",
    );
    expect(sidebar.querySelector("[data-game-timer]")?.className).toContain(
      "game-end-timer-flash",
    );
  });

  it("does not use end-game warnings for the spawn countdown", async () => {
    const { sidebar, state } = createSidebar({
      inSpawnPhase: true,
      ticks: 100,
    });

    sidebar.tick();
    await sidebar.updateComplete;

    expect(
      sidebar.querySelector("[data-game-timer]")?.textContent?.trim(),
    ).toBe("00:30");
    expect(sidebar.querySelector("[data-game-timer]")?.className).toBe("");
    expect(sidebar.querySelector("aside")?.className).not.toContain(
      "game-end-timer-sidebar-flash",
    );
    expect(sidebar.querySelector('[role="alert"]')).toBeNull();

    state.inSpawnPhase = false;
  });

  it("keeps an untimed game's elapsed clock free of end-game warnings", async () => {
    const { sidebar, state } = createSidebar({ maxTimerValue: null });
    state.elapsedSeconds = 30;

    sidebar.tick();
    await sidebar.updateComplete;

    expect(
      sidebar.querySelector("[data-game-timer]")?.textContent?.trim(),
    ).toBe("00:30");
    expect(sidebar.querySelector("[data-game-timer]")?.className).toBe("");
    expect(sidebar.querySelector("aside")?.className).not.toContain(
      "game-end-timer-sidebar-flash",
    );
    expect(sidebar.querySelector('[role="alert"]')).toBeNull();
  });
});
