import { describe, expect, it } from "vitest";
import {
  inCircle,
  ISLET,
  judge,
  LOW_TROOP_SHARE,
  OnboardingProgress,
  SPAWN_ZONE,
  stepFor,
} from "../../src/client/hud/Onboarding";

const start: OnboardingProgress = {
  hasSpawned: false,
  bordersTribe: false,
  troopsSeen: false,
  tribeAlive: true,
  ownsIslet: false,
  nationAlive: true,
};

describe("onboarding steps", () => {
  it("walks spawn, expand, troops, tribe, boat, nation, then won", () => {
    expect(stepFor(start)).toBe("spawn");
    const spawned = { ...start, hasSpawned: true };
    expect(stepFor(spawned)).toBe("expand");
    expect(stepFor({ ...spawned, bordersTribe: true })).toBe("troops");
    expect(stepFor({ ...spawned, bordersTribe: true, troopsSeen: true })).toBe(
      "tribe",
    );
    const tribeGone = { ...spawned, tribeAlive: false };
    expect(stepFor(tribeGone)).toBe("boat");
    expect(stepFor({ ...tribeGone, ownsIslet: true })).toBe("nation");
    expect(stepFor({ ...tribeGone, ownsIslet: true, nationAlive: false })).toBe(
      "won",
    );
  });

  it("is won once the nation falls, islet or not", () => {
    expect(
      stepFor({
        ...start,
        hasSpawned: true,
        tribeAlive: false,
        nationAlive: false,
      }),
    ).toBe("won");
  });

  it("sends a player whose tribe border was pushed back to expanding", () => {
    expect(stepFor({ ...start, hasSpawned: true, bordersTribe: false })).toBe(
      "expand",
    );
  });
});

describe("onboarding rules", () => {
  const full = 1;

  it("only takes a spawn inside the zone", () => {
    expect(judge("spawn", { kind: "spawn", inZone: true }, full)).toBe("ok");
    expect(judge("spawn", { kind: "spawn", inZone: false }, full)).toBe(
      "wrong_target",
    );
    expect(inCircle(SPAWN_ZONE, SPAWN_ZONE.x, SPAWN_ZONE.y)).toBe(true);
    expect(
      inCircle(SPAWN_ZONE, SPAWN_ZONE.x + SPAWN_ZONE.radius + 1, SPAWN_ZONE.y),
    ).toBe(false);
  });

  it("always lets the player grow into free land", () => {
    for (const step of [
      "expand",
      "troops",
      "tribe",
      "boat",
      "nation",
    ] as const) {
      expect(judge(step, { kind: "attack", target: "free" }, full)).toBe("ok");
    }
  });

  it("keeps the nation for the last step", () => {
    for (const kind of ["attack", "boat"] as const) {
      expect(judge("expand", { kind, target: "nation" }, full)).toBe(
        "wrong_target",
      );
      expect(judge("boat", { kind, target: "nation" }, full)).toBe(
        "wrong_target",
      );
      expect(judge("nation", { kind, target: "nation" }, full)).toBe("ok");
    }
  });

  it("holds boats until the boat step, then sends them to the islet", () => {
    expect(judge("tribe", { kind: "boat", target: "islet" }, full)).toBe(
      "wrong_target",
    );
    expect(judge("boat", { kind: "boat", target: "islet" }, full)).toBe("ok");
    expect(inCircle(ISLET, ISLET.x, ISLET.y)).toBe(true);
  });

  it("lets the tribe be attacked while it's the target", () => {
    expect(judge("tribe", { kind: "attack", target: "tribe" }, full)).toBe(
      "ok",
    );
  });

  it("stops attacks that would leave troops low", () => {
    const low = LOW_TROOP_SHARE - 0.01;
    expect(judge("tribe", { kind: "attack", target: "tribe" }, low)).toBe(
      "low_troops",
    );
    expect(judge("boat", { kind: "boat", target: "islet" }, low)).toBe(
      "low_troops",
    );
    // A wrong target is the thing to fix first.
    expect(judge("expand", { kind: "attack", target: "nation" }, low)).toBe(
      "wrong_target",
    );
  });
});
