import { describe, expect, it } from "vitest";
import {
  hasLinkedIdentity,
  isSteamPrimaryUser,
  responseHasLinkedIdentity,
} from "../../src/client/AccountIdentity";
import { UserMeResponse } from "../../src/core/ApiSchemas";

type User = UserMeResponse["user"];

const steam: User["steam"] = {
  steamId: "76561198000000000",
  personaName: "Player",
  avatarUrl: null,
};
const discord: User["discord"] = {
  id: "1",
  avatar: null,
  username: "player",
  global_name: null,
  discriminator: "0",
};
const google: User["google"] = { email: "player@example.com" };
const email = "player@example.com";

describe("isSteamPrimaryUser", () => {
  it.each<[string, User | undefined, boolean]>([
    ["steam-only", { steam }, true],
    ["steam + discord", { steam, discord }, false],
    ["steam + google", { steam, google }, false],
    ["steam + email", { steam, email }, false],
    ["no steam", { discord }, false],
    ["undefined user", undefined, false],
  ])("%s -> %s", (_name, user, expected) => {
    expect(isSteamPrimaryUser(user)).toBe(expected);
  });
});

describe("hasLinkedIdentity", () => {
  it.each<[string, User | undefined, boolean]>([
    ["discord", { discord }, true],
    ["google", { google }, true],
    ["steam", { steam }, true],
    ["email", { email }, true],
    // The case that motivated extracting this: an empty-string `email` must
    // not mask a real identity. A `??` chain gets this right only while
    // `email` happens to be ordered last.
    ["steam + empty-string email", { steam, email: "" }, true],
    ["discord + empty-string email", { discord, email: "" }, true],
    // An empty-string email on its own is not an identity (unchanged
    // behaviour — the API should never send one).
    ["empty-string email only", { email: "" }, false],
    ["no identities", {}, false],
    ["undefined user", undefined, false],
  ])("%s -> %s", (_name, user, expected) => {
    expect(hasLinkedIdentity(user)).toBe(expected);
  });
});

// The response-level form every gate now shares. It exists because five call
// sites each held their own `userMe !== false && ...` unwrapping, and one of
// them (the old hasLinkedAccount) forgot Steam — see OPE-199/OPE-260.
describe("responseHasLinkedIdentity", () => {
  function res(user: User): UserMeResponse {
    return { user } as unknown as UserMeResponse;
  }

  it("returns false when there is no session at all", () => {
    expect(responseHasLinkedIdentity(false)).toBe(false);
  });

  // The regression this whole change exists for: a Steam-only account is a
  // real, fully authenticated session. The API sends `user: { steam }` and
  // nothing else — no discord, google or email — so any predicate without a
  // steam term reads it as logged out.
  it("recognizes a Steam-only account as logged in", () => {
    expect(responseHasLinkedIdentity(res({ steam }))).toBe(true);
  });

  it.each<[string, User, boolean]>([
    ["discord", { discord }, true],
    // Absorbed from the retired tests/HasLinkedAccount.test.ts: a Google
    // login sets user.google and neither discord nor email, so it must count
    // as logged in (regression: Google users seen as logged out everywhere
    // except the account modal — the same shape of miss as the Steam one).
    ["google", { google }, true],
    ["email", { email }, true],
    ["steam + discord", { steam, discord }, true],
    ["no identities", {}, false],
  ])("%s -> %s", (_name, user, expected) => {
    expect(responseHasLinkedIdentity(res(user))).toBe(expected);
  });

  // Behaviour change carried over from the retired hasLinkedAccount, which
  // tested `email !== undefined` and so counted an empty string as an
  // identity. hasLinkedIdentity does not, and this form inherits that.
  it("does not count a present-but-empty email as an identity", () => {
    expect(responseHasLinkedIdentity(res({ email: "" }))).toBe(false);
  });
});
