import { describe, expect, it } from "vitest";
import { hasLinkedAccount } from "../src/client/Api";
import { UserMeResponse } from "../src/core/ApiSchemas";

// hasLinkedAccount gates the top bar, matchmaking, single-player, ranked, and
// the skins-page "not logged in" warning. A Google login sets user.google (no
// discord/email), so it must count as logged in — otherwise the UI shows
// "Sign in" despite a valid session (regression: Google users seen as logged
// out everywhere except the account modal).
function userWith(user: Record<string, unknown>): UserMeResponse {
  return { user } as unknown as UserMeResponse;
}

describe("hasLinkedAccount", () => {
  it("returns false when not logged in", () => {
    expect(hasLinkedAccount(false)).toBe(false);
  });

  it("returns false when the user has no linked identity", () => {
    expect(hasLinkedAccount(userWith({}))).toBe(false);
  });

  it("recognizes a Discord login", () => {
    expect(hasLinkedAccount(userWith({ discord: { id: "1" } }))).toBe(true);
  });

  it("recognizes an email (magic-link) login", () => {
    expect(hasLinkedAccount(userWith({ email: "a@example.com" }))).toBe(true);
  });

  it("recognizes a Google login", () => {
    expect(
      hasLinkedAccount(userWith({ google: { email: "a@example.com" } })),
    ).toBe(true);
  });
});
