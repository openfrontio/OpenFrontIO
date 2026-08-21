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

  // All four kinds asserted explicitly at the call site's own predicate, so a
  // future edit collapsing the gating/non-gating split fails here too.
  const failed = (kind: string) => ({
    status: "failed" as const,
    bytes: 0,
    total: 0,
    error: { kind, message: kind },
  });

  it("blocks a failed check when Retry is a real remedy", () => {
    expect(shouldBlockMultiplayerAction(failed("network"))).toBe(true);
    expect(shouldBlockMultiplayerAction(failed("verify"))).toBe(true);
  });

  it("does not block failures no player-side action can change", () => {
    expect(shouldBlockMultiplayerAction(failed("refused"))).toBe(false);
    expect(shouldBlockMultiplayerAction(failed("parse"))).toBe(false);
  });
});
