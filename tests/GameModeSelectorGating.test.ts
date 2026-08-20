import { describe, expect, it } from "vitest";
import { shouldBlockMultiplayerAction } from "../src/client/GameModeSelector";

describe("shouldBlockMultiplayerAction", () => {
  it("allows everything when no desktop update state has arrived", () => {
    expect(shouldBlockMultiplayerAction(null)).toBe(false);
  });

  it("allows multiplayer when the client is current", () => {
    expect(
      shouldBlockMultiplayerAction({ status: "current", bytes: 0, total: 0 }),
    ).toBe(false);
  });

  it("blocks while downloading and while staged", () => {
    expect(
      shouldBlockMultiplayerAction({
        status: "downloading",
        bytes: 1,
        total: 2,
      }),
    ).toBe(true);
    expect(
      shouldBlockMultiplayerAction({ status: "staged", bytes: 2, total: 2 }),
    ).toBe(true);
  });

  it("does not block when the shell is too old to update", () => {
    expect(
      shouldBlockMultiplayerAction({ status: "blocked", bytes: 0, total: 0 }),
    ).toBe(false);
  });

  it("blocks a failed check only when Retry has something to retry", () => {
    expect(
      shouldBlockMultiplayerAction({
        status: "failed",
        bytes: 0,
        total: 0,
        error: { kind: "network", message: "offline" },
      }),
    ).toBe(true);
    expect(
      shouldBlockMultiplayerAction({
        status: "failed",
        bytes: 0,
        total: 0,
        error: { kind: "refused", message: "403" },
      }),
    ).toBe(false);
    expect(
      shouldBlockMultiplayerAction({
        status: "failed",
        bytes: 0,
        total: 0,
        error: { kind: "parse", message: "bad json" },
      }),
    ).toBe(false);
  });
});
