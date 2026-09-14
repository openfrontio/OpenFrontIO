import { describe, expect, it } from "vitest";
import { stripeKeyMatchesEnv } from "../../src/client/StripeInline";
import { GameEnv } from "../../src/core/configuration/Config";

// The build define blanks the key under vitest, so stripeInlineAvailable()
// itself cannot be exercised here; the mode-match rule it delegates to can.
describe("stripeKeyMatchesEnv", () => {
  it("accepts a live key only on prod", () => {
    expect(stripeKeyMatchesEnv("pk_live_abc", GameEnv.Prod)).toBe(true);
    expect(stripeKeyMatchesEnv("pk_live_abc", GameEnv.Preprod)).toBe(false);
    expect(stripeKeyMatchesEnv("pk_live_abc", GameEnv.Dev)).toBe(false);
  });

  it("accepts a test key everywhere except prod", () => {
    expect(stripeKeyMatchesEnv("pk_test_abc", GameEnv.Prod)).toBe(false);
    expect(stripeKeyMatchesEnv("pk_test_abc", GameEnv.Preprod)).toBe(true);
    expect(stripeKeyMatchesEnv("pk_test_abc", GameEnv.Dev)).toBe(true);
  });
});
