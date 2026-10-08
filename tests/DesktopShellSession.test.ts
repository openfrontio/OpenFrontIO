import { describe, expect, it } from "vitest";
import {
  multiplayerAllowedForSession,
  type SessionFailureKind,
} from "../src/client/DesktopShell";

const ALL_REASONS: SessionFailureKind[] = [
  "steam-unavailable",
  "steam-wedged",
  "steam-error",
  "steam-ticket-rejected",
  "steam-backend",
  "network",
];

describe("multiplayerAllowedForSession", () => {
  it("allows multiplayer on the web, where there is no session state", () => {
    expect(multiplayerAllowedForSession(null)).toBe(true);
  });

  it("allows multiplayer while the first attempt is still in flight", () => {
    // Mirrors `checking` in the update state machine: no evidence of a
    // problem yet, and blocking every launch to prove a negative is the
    // blocking-splash design OPE-185 rejected.
    expect(multiplayerAllowedForSession({ status: "unknown" })).toBe(true);
  });

  it("allows multiplayer once signed in", () => {
    expect(multiplayerAllowedForSession({ status: "signed-in" })).toBe(true);
  });

  it("gates multiplayer while a retry is in flight", () => {
    expect(multiplayerAllowedForSession({ status: "retrying" })).toBe(false);
  });

  // Deliberately unlike multiplayerAllowed, which spares the states the
  // player cannot act on. Here, not gating does not let them play -- the
  // game server refuses the join regardless -- so every reason gates.
  it.each(ALL_REASONS)("gates multiplayer when signed out (%s)", (reason) => {
    expect(multiplayerAllowedForSession({ status: "signed-out", reason })).toBe(
      false,
    );
  });
});
