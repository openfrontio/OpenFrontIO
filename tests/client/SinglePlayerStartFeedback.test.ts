import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerCosmetics } from "../../src/core/Schemas";

const cosmeticsMocks = vi.hoisted(() => ({
  getPlayerCosmetics: vi.fn(),
  prewarmCosmetics: vi.fn(),
}));

vi.mock("../../src/client/Cosmetics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Cosmetics")>()),
  getPlayerCosmetics: cosmeticsMocks.getPlayerCosmetics,
  prewarmCosmetics: cosmeticsMocks.prewarmCosmetics,
}));

import {
  SinglePlayerModal,
  START_COSMETICS_DEADLINE_MS,
} from "../../src/client/SinglePlayerModal";

type Internals = {
  startGame(): Promise<void>;
  onOpen(): void;
  onClose(): void;
  starting: boolean;
  close(): void;
};

function internals(modal: SinglePlayerModal): Internals {
  return modal as unknown as Internals;
}

// Lets the pending awaits in startGame() run without letting the cosmetics
// promise settle — the state the button has to describe.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function startButton(modal: SinglePlayerModal): Element {
  const container = document.createElement("div");
  render(
    (modal as unknown as { render(): unknown }).render() as never,
    container,
  );
  const button = Array.from(container.querySelectorAll("o-button")).find((b) =>
    (b.getAttribute("translationKey") ?? "").startsWith("game_settings.start"),
  );
  if (button === undefined) throw new Error("no start button rendered");
  return button;
}

describe("SinglePlayerModal start feedback", () => {
  let modal: SinglePlayerModal;
  let joins: CustomEvent[];

  beforeEach(() => {
    cosmeticsMocks.getPlayerCosmetics.mockResolvedValue({});
    cosmeticsMocks.prewarmCosmetics.mockResolvedValue(undefined);
    modal = new SinglePlayerModal();
    // close() walks the modal shell and the router, neither of which exists
    // for a bare instance; the dispatch above it is what these tests read.
    vi.spyOn(internals(modal), "close").mockImplementation(() => undefined);
    joins = [];
    modal.addEventListener("join-lobby", (e) => joins.push(e as CustomEvent));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // The whole complaint from the playtest was that the click did nothing
  // visible while the network calls ran. The busy flag has to be set before
  // the first await, not after them.
  it("marks itself busy before cosmetics resolve", async () => {
    cosmeticsMocks.getPlayerCosmetics.mockReturnValue(new Promise(() => {}));

    const started = internals(modal).startGame();
    await flush();

    expect(internals(modal).starting).toBe(true);
    expect(joins).toHaveLength(0);
    void started;
  });

  it("renders the button disabled and relabelled while busy", async () => {
    cosmeticsMocks.getPlayerCosmetics.mockReturnValue(new Promise(() => {}));

    expect(startButton(modal).getAttribute("translationKey")).toBe(
      "game_settings.start",
    );

    void internals(modal).startGame();
    await flush();

    const button = startButton(modal);
    expect(button.getAttribute("translationKey")).toBe(
      "game_settings.starting",
    );
    expect((button as unknown as { disable: boolean }).disable).toBe(true);
  });

  // A second click during the wait would dispatch a second join-lobby for a
  // different gameID — two games racing to start.
  it("ignores a second click while the first is still resolving", async () => {
    cosmeticsMocks.getPlayerCosmetics.mockReturnValue(new Promise(() => {}));

    void internals(modal).startGame();
    await flush();
    await internals(modal).startGame();

    expect(cosmeticsMocks.getPlayerCosmetics).toHaveBeenCalledTimes(1);
    expect(joins).toHaveLength(0);
  });

  // Offline, the bounded catalog fetch fails and getPlayerCosmetics degrades
  // to defaults. The match still has to start: nothing about the result
  // decides whether a bot game can run.
  it("starts the match when cosmetics degrade to defaults", async () => {
    const defaults: PlayerCosmetics = {};
    cosmeticsMocks.getPlayerCosmetics.mockResolvedValue(defaults);

    await internals(modal).startGame();

    expect(joins).toHaveLength(1);
    expect(joins[0].detail.gameStartInfo.players[0].cosmetics).toEqual(
      defaults,
    );
    expect(internals(modal).starting).toBe(false);
  });

  it("clears the busy state when the start path throws", async () => {
    cosmeticsMocks.getPlayerCosmetics.mockRejectedValue(new Error("boom"));

    await expect(internals(modal).startGame()).rejects.toThrow("boom");

    // Otherwise the button stays disabled and the player cannot retry.
    expect(internals(modal).starting).toBe(false);
  });

  // Regression: the busy flag is cleared in a finally, and a finally never
  // runs if the promise it is waiting on never settles. A stalled connection
  // (captive portal, DNS blackhole) reaching any unbounded fetch beneath
  // getPlayerCosmetics used to pin the button at "Starting…" for the rest of
  // the session — surviving close and reopen, and silently no-opping the
  // Tutorial entry point on the re-entrancy guard.
  it("does not stay busy when cosmetics never settle", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    cosmeticsMocks.getPlayerCosmetics.mockReturnValueOnce(
      new Promise(() => {}),
    );

    const started = internals(modal).startGame();
    await vi.advanceTimersByTimeAsync(START_COSMETICS_DEADLINE_MS);
    await started;

    expect(internals(modal).starting).toBe(false);
    // The match still starts, on defaults — the point of the deadline.
    expect(joins).toHaveLength(1);
    vi.useRealTimers();
  });

  it("accepts a second Start click after a stalled attempt", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    cosmeticsMocks.getPlayerCosmetics.mockReturnValueOnce(
      new Promise(() => {}),
    );

    const started = internals(modal).startGame();
    await vi.advanceTimersByTimeAsync(START_COSMETICS_DEADLINE_MS);
    await started;

    cosmeticsMocks.getPlayerCosmetics.mockResolvedValueOnce({});
    await internals(modal).startGame();

    expect(joins).toHaveLength(2);
    vi.useRealTimers();
  });

  // Belt and braces: whatever left an attempt in flight, closing and
  // reopening the modal hands back a live button.
  it("clears the busy state on close", async () => {
    cosmeticsMocks.getPlayerCosmetics.mockReturnValue(new Promise(() => {}));

    void internals(modal).startGame();
    await flush();
    expect(internals(modal).starting).toBe(true);

    internals(modal).onClose();

    expect(internals(modal).starting).toBe(false);
  });

  // The deadline must never pre-empt a resolution that is merely slow: every
  // fetch beneath it is bounded at 10s, so it has to sit above that.
  it("keeps the deadline above the fetch bounds beneath it", () => {
    expect(START_COSMETICS_DEADLINE_MS).toBeGreaterThan(10_000);
  });

  // The prewarm is what keeps the click off the network in the first place:
  // the round trip is spent while the player picks a map.
  it("prewarms cosmetics when the modal opens", () => {
    internals(modal).onOpen();

    expect(cosmeticsMocks.prewarmCosmetics).toHaveBeenCalledTimes(1);
  });

  it("prewarms cosmetics on the tutorial path, which never opens the modal", async () => {
    await modal.startTutorial();

    expect(cosmeticsMocks.prewarmCosmetics).toHaveBeenCalled();
    expect(joins).toHaveLength(1);
  });
});
