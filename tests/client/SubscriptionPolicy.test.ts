import { describe, expect, it } from "vitest";
import {
  STEAM_CANCEL_IN_APP,
  STEAM_TIER_CHANGE_IN_APP,
} from "../../src/client/SubscriptionPolicy";

// Lead decisions of 6 Sept 2026 (infra OPE-230), pending Josh. Flipping
// either is a deliberate one-line change that should have to update this
// file too — alongside the server's STEAM_TIER_CHANGE_ENABLED for S1.
describe("Steam-rail launch policies", () => {
  it("blocks in-app tier change on Steam (S1)", () => {
    expect(STEAM_TIER_CHANGE_IN_APP).toBe(false);
  });

  it("hides in-game Cancel on Steam (S2)", () => {
    expect(STEAM_CANCEL_IN_APP).toBe(false);
  });
});
