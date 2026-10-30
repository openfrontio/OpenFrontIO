import { describe, expect, it } from "vitest";
import {
  inCircle,
  judge,
  LOW_TROOP_SHARE,
  OnboardingProgress,
  SPAWN_ZONE,
  stepFor,
} from "../../src/client/hud/Onboarding";

const start: OnboardingProgress = {
  hasSpawned: false,
  bordersKingdom: false,
  expandedAWhile: false,
  troopsSeen: false,
  kingdomAlive: true,
  empireAlive: true,
  ownsSilo: false,
  nuked: false,
};

describe("onboarding steps", () => {
  it("walks spawn, expand, troops, kingdom, nuke, empire, then won", () => {
    expect(stepFor(start)).toBe("spawn");
    const spawned = { ...start, hasSpawned: true };
    expect(stepFor(spawned)).toBe("expand");
    const expanding = { ...spawned, expandedAWhile: true };
    expect(stepFor(expanding)).toBe("troops");
    // Back to expanding until we reach the kingdom.
    expect(stepFor({ ...expanding, troopsSeen: true })).toBe("expand");
    const met = { ...expanding, bordersKingdom: true };
    expect(stepFor({ ...met, troopsSeen: true })).toBe("kingdom");
    // Taking the silo doesn't end the kingdom step: the kingdom goes first.
    expect(stepFor({ ...met, troopsSeen: true, ownsSilo: true })).toBe(
      "kingdom",
    );
    const kingdomGone = { ...spawned, kingdomAlive: false, ownsSilo: true };
    expect(stepFor(kingdomGone)).toBe("nuke");
    expect(stepFor({ ...kingdomGone, nuked: true })).toBe("empire");
    expect(stepFor({ ...kingdomGone, nuked: true, empireAlive: false })).toBe(
      "won",
    );
  });

  it("shows the troop bar on reaching the kingdom early", () => {
    expect(stepFor({ ...start, hasSpawned: true, bordersKingdom: true })).toBe(
      "troops",
    );
  });

  it("goes to the empire without a silo to fire", () => {
    expect(stepFor({ ...start, hasSpawned: true, kingdomAlive: false })).toBe(
      "empire",
    );
  });

  it("is won once both nations fall, nuked or not", () => {
    expect(
      stepFor({
        ...start,
        hasSpawned: true,
        kingdomAlive: false,
        empireAlive: false,
      }),
    ).toBe("won");
  });

  it("sends a player whose kingdom border was pushed back to expanding", () => {
    expect(
      stepFor({
        ...start,
        hasSpawned: true,
        expandedAWhile: true,
        troopsSeen: true,
        bordersKingdom: false,
      }),
    ).toBe("expand");
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
      "kingdom",
      "nuke",
      "empire",
    ] as const) {
      expect(judge(step, { kind: "attack", target: "free" }, full)).toBe("ok");
    }
  });

  it("lets the kingdom be attacked while it's the target", () => {
    expect(judge("kingdom", { kind: "attack", target: "kingdom" }, full)).toBe(
      "ok",
    );
  });

  it("keeps the empire for the last step, after the nuke", () => {
    for (const kind of ["attack", "boat"] as const) {
      for (const step of ["expand", "kingdom", "nuke"] as const) {
        expect(judge(step, { kind, target: "empire" }, full)).toBe(
          "wrong_target",
        );
      }
      expect(judge("empire", { kind, target: "empire" }, full)).toBe("ok");
    }
  });

  it("holds boats until the kingdom is gone", () => {
    expect(judge("kingdom", { kind: "boat", target: "free" }, full)).toBe(
      "wrong_target",
    );
    expect(judge("empire", { kind: "boat", target: "free" }, full)).toBe("ok");
  });

  it("only builds the atom bomb, once the kingdom is gone", () => {
    expect(judge("kingdom", { kind: "build", atomBomb: true }, full)).toBe(
      "wrong_target",
    );
    for (const step of ["nuke", "empire"] as const) {
      expect(judge(step, { kind: "build", atomBomb: true }, full)).toBe("ok");
      expect(judge(step, { kind: "build", atomBomb: false }, full)).toBe(
        "wrong_target",
      );
    }
  });

  it("stops attacks that would leave troops low", () => {
    const low = LOW_TROOP_SHARE - 0.01;
    expect(judge("kingdom", { kind: "attack", target: "kingdom" }, low)).toBe(
      "low_troops",
    );
    expect(judge("empire", { kind: "boat", target: "empire" }, low)).toBe(
      "low_troops",
    );
    // A wrong target is the thing to fix first.
    expect(judge("expand", { kind: "attack", target: "empire" }, low)).toBe(
      "wrong_target",
    );
  });
});
