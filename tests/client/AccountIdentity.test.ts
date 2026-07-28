import { describe, expect, it } from "vitest";
import {
  hasLinkedIdentity,
  isSteamPrimaryUser,
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
