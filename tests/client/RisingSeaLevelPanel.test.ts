import { RisingSeaLevelPanel } from "../../src/client/components/RisingSeaLevelPanel";
import type { GameView } from "../../src/client/view";
import {
  RisingSeaLevelSpeed,
  risingSeaLevelSchedule,
} from "../../src/core/game/RisingSeaLevel";

// Keys pass through with their params appended, so assertions can check both
// which string is shown and what it was filled with.
vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: (key: string, params?: Record<string, string | number>) =>
    params ? `${key}|${Object.values(params).join(",")}` : key,
}));

interface PanelOptions {
  enabled?: boolean;
  speed?: RisingSeaLevelSpeed;
  elapsedSeconds?: number;
  hasWinner?: boolean;
}

function createPanel({
  enabled = true,
  speed = "normal",
  elapsedSeconds = 0,
  hasWinner = false,
}: PanelOptions = {}) {
  const game = {
    config: () => ({ risingSeaLevelConfig: () => ({ enabled, speed }) }),
    elapsedGameSeconds: () => elapsedSeconds,
  } as unknown as GameView;

  const panel = new RisingSeaLevelPanel();
  panel.game = game;
  panel.hasWinner = hasWinner;
  document.body.appendChild(panel);
  return panel;
}

const { graceSeconds, submergeSeconds } = risingSeaLevelSchedule("normal");

describe("RisingSeaLevelPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("counts down to the first tile while the sea is still calm", async () => {
    const panel = createPanel({ elapsedSeconds: graceSeconds - 65 });
    await panel.updateComplete;

    expect(panel.style.display).toBe("block");
    expect(panel.textContent).toContain("rising_sea_level.calm");
    expect(panel.textContent).not.toContain("rising_sea_level.rising");
    expect(panel.textContent).toContain("rising_sea_level.starts_in|01:05");
    expect(panel.textContent).toContain("rising_sea_level.submerged|0");
  });

  it("counts down to full submersion once the sea is rising", async () => {
    // A quarter of the way through the flood.
    const panel = createPanel({
      elapsedSeconds: graceSeconds + submergeSeconds / 4,
    });
    await panel.updateComplete;

    expect(panel.textContent).toContain("rising_sea_level.rising");
    expect(panel.textContent).not.toContain("rising_sea_level.calm");
    expect(panel.textContent).toContain("rising_sea_level.submerged|25");
    // Three quarters of normal's 25 minutes left, in mm:ss like the other
    // timer panels.
    expect(panel.textContent).toContain("rising_sea_level.full_in|18:45");
  });

  it("fills the bar to the share the schedule has reached", async () => {
    const panel = createPanel({
      elapsedSeconds: graceSeconds + submergeSeconds / 2,
    });
    await panel.updateComplete;

    const bar = panel.querySelector<HTMLElement>(".bg-sky-400");
    expect(bar?.style.width).toBe("50%");
  });

  it("does not run past 100% when a game outlasts the schedule", async () => {
    const panel = createPanel({
      elapsedSeconds: graceSeconds + submergeSeconds * 3,
    });
    await panel.updateComplete;

    expect(panel.textContent).toContain("rising_sea_level.submerged|100");
    expect(panel.textContent).toContain("rising_sea_level.full_in|00:00");
  });

  it("paces itself by the preset the host picked", async () => {
    // Same elapsed time, faster preset: further along.
    const slow = createPanel({
      speed: "slow",
      elapsedSeconds: graceSeconds + 360,
    });
    await slow.updateComplete;
    expect(slow.textContent).toContain("rising_sea_level.submerged|17");
    document.body.innerHTML = "";

    const fast = createPanel({
      speed: "veryfast",
      elapsedSeconds: graceSeconds + 360,
    });
    await fast.updateComplete;
    expect(fast.textContent).toContain("rising_sea_level.submerged|50");
  });

  it("stays hidden when the mode is off", async () => {
    const panel = createPanel({ enabled: false });
    await panel.updateComplete;

    expect(panel.style.display).toBe("none");
    expect(panel.textContent).not.toContain("rising_sea_level");
  });

  it("stays hidden once the game has a winner", async () => {
    // The game is over; the sea's schedule is no longer news.
    const panel = createPanel({
      hasWinner: true,
      elapsedSeconds: graceSeconds + 60,
    });
    await panel.updateComplete;

    expect(panel.style.display).toBe("none");
    expect(panel.textContent).not.toContain("rising_sea_level");
  });
});
