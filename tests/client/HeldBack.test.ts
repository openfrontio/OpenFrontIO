import { describe, expect, it } from "vitest";
import {
  CARD_TAUNTS_ENABLED,
  CARD_TITLES_ENABLED,
} from "../../src/client/components/card/HeldBack";

// Taunts and titles are held back for this release. Update this test when
// either is switched back on.
describe("held-back card items", () => {
  it("taunts and titles are switched off", () => {
    expect(CARD_TAUNTS_ENABLED).toBe(false);
    expect(CARD_TITLES_ENABLED).toBe(false);
  });
});
