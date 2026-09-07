import { describe, expect, it } from "vitest";
import { STEAM_TIER_CHANGE_IN_APP } from "../../src/client/SubscriptionPolicy";

// Lead decision of 6 Sept 2026 (infra OPE-230), pending Josh. Flipping it is
// a deliberate one-line change that should have to update this file too —
// alongside the server's STEAM_TIER_CHANGE_ENABLED. (S2, in-game Cancel on
// Steam, was decided by Josh on 7 Sept 2026: shown, no switch.)
describe("Steam-rail launch policies", () => {
  it("blocks in-app tier change on Steam (S1)", () => {
    expect(STEAM_TIER_CHANGE_IN_APP).toBe(false);
  });
});
