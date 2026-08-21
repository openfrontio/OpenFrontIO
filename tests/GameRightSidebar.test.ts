import { GameRightSidebar } from "../src/client/hud/layers/GameRightSidebar";
import { SendWinnerEvent } from "../src/client/Transport";
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

interface Toast {
  message: string;
  color: string;
  duration: number;
}

// The one-minute notice is handed to the heads-up toast layer, so the sidebar's
// side effect is the "show-message" event rather than markup it owns.
let toasts: Toast[] = [];
const captureToast = (event: Event) => {
  toasts.push((event as CustomEvent<Toast>).detail);
};

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
      // The overtime panel is embedded in the sidebar's template, so its
      // config read must exist even though these tests keep the mode off.
      overtimeConfig: () => ({ enabled: false, startMinutes: 30 }),
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

  return { sidebar, state, eventBus, setRemainingSeconds };
}

describe("GameRightSidebar end timer warnings", () => {
  beforeEach(() => {
    toasts = [];
    window.addEventListener("show-message", captureToast);
  });

  afterEach(() => {
    window.removeEventListener("show-message", captureToast);
    document.body.innerHTML = "";
  });

  it("turns the timer red and fires one heads-up toast at the one-minute mark", async () => {
    const { sidebar, setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(61);
    expect(toasts).toHaveLength(0);
    expect(sidebar.querySelector("[data-game-timer]")?.className).toBe("");

    await setRemainingSeconds(60);
    expect(toasts).toEqual([
      {
        message: "game_timer.one_minute_remaining",
        color: "red",
        duration: 4_000,
      },
    ]);
    expect(sidebar.querySelector("[data-game-timer]")?.className).toContain(
      "game-end-timer-last-minute",
    );

    // Every later tick is still inside the last minute; the notice fires once.
    await setRemainingSeconds(59);
    await setRemainingSeconds(58);
    expect(toasts).toHaveLength(1);
  });

  it("does not fire the toast once the timer has run out", async () => {
    const { setRemainingSeconds } = createSidebar();

    await setRemainingSeconds(0);

    expect(toasts).toHaveLength(0);
  });

  it("does not fire the toast after a winner is declared", async () => {
    const { eventBus, setRemainingSeconds } = createSidebar();

    eventBus.emit(new SendWinnerEvent(undefined, {}));
    await setRemainingSeconds(60);

    expect(toasts).toHaveLength(0);
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
    expect(toasts).toHaveLength(0);

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
    expect(toasts).toHaveLength(0);
  });
});
