import { describe, expect, it } from "vitest";
import { isSteamPrimaryUser } from "../../src/client/accountIdentity";
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
