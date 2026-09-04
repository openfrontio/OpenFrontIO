import { describe, expect, it } from "vitest";
import { barSource } from "../src/client/components/DesktopStatusBar";

describe("barSource", () => {
  it("shows nothing when both states are healthy", () => {
    expect(
      barSource(
        { status: "current", bytes: 0, total: 0 },
        { status: "signed-in" },
      ),
    ).toBe("none");
  });

  it("shows the update when the session is fine", () => {
    expect(
      barSource(
        { status: "downloading", bytes: 1, total: 2 },
        { status: "signed-in" },
      ),
    ).toBe("update");
  });

  // Session wins over EVERY update state, downloading and staged included:
  // the update's remedy is a reload, which leads straight back to the same
  // wall -- and a reload re-runs the update flow anyway, so nothing is lost.
  it.each([
    "checking",
    "current",
    "downloading",
    "staged",
    "blocked",
    "failed",
  ] as const)("shows the session over update state %s", (status) => {
    expect(
      barSource(
        { status, bytes: 0, total: 0 },
        {
          status: "signed-out",
          reason: "steam-wedged",
        },
      ),
    ).toBe("session");
  });

  // OPE-194 pairs with this: an unrecognised error kind now GATES multiplayer,
  // so it must never gate silently. The bar's visibility and its label/action
  // key off `status`, not `error.kind`, so a failure this client cannot
  // classify still surfaces "couldn't download the update" plus Retry -- a
  // visible reason and an action, which is what keeps gating from being
  // punishment without recourse.
  it("surfaces a failure whose error kind is unrecognised", () => {
    expect(
      barSource(
        {
          status: "failed",
          bytes: 0,
          total: 0,
          error: { kind: "quota-exceeded", message: "from a newer shell" },
        },
        { status: "signed-in" },
      ),
    ).toBe("update");
  });

  it("shows nothing on the web, where neither bridge exists", () => {
    expect(barSource(null, null)).toBe("none");
  });
});
