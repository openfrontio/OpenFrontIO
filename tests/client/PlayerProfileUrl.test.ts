import { describe, expect, it } from "vitest";
import {
  parsePlayerProfilePath,
  playerProfileRouteArgs,
} from "../../src/client/utilities/PlayerProfileUrl";

describe("parsePlayerProfilePath", () => {
  it("reads the id from every form of the profile path", () => {
    for (const path of [
      "/player/aB3dE5fX",
      "/player/aB3dE5fX/",
      "/w0/player/aB3dE5fX",
      "/w12/player/aB3dE5fX/",
      "/v/abc1234/player/aB3dE5fX",
      "/v/abc1234/w1/player/aB3dE5fX",
    ]) {
      expect(parsePlayerProfilePath(path), path).toBe("aB3dE5fX");
    }
  });

  it("accepts the url-safe characters ids are made of", () => {
    expect(parsePlayerProfilePath("/player/a_b-C9")).toBe("a_b-C9");
  });

  it("ignores other paths and ids that can't be one", () => {
    for (const path of [
      "/",
      "/player",
      "/player/",
      "/player/aB3dE5fX/games",
      "/players/aB3dE5fX",
      "/x/player/aB3dE5fX",
      "/wx/player/aB3dE5fX",
      "/game/aB3dE5fX",
      "/player/a%2Bb",
      "/player/<script>",
      "/player/aaaaaaaaaaaaaaaaaaaaaaa", // 23 characters
    ]) {
      expect(parsePlayerProfilePath(path), path).toBeNull();
    }
  });
});

describe("playerProfileRouteArgs", () => {
  it("opens the profile named by the path", () => {
    expect(
      playerProfileRouteArgs({ pathname: "/player/aB3dE5fX", search: "" }),
    ).toEqual({ publicID: "aB3dE5fX" });
  });

  it("takes a known tab from ?tab=", () => {
    for (const tab of ["stats", "games", "clans", "progression"]) {
      expect(
        playerProfileRouteArgs({
          pathname: "/player/aB3dE5fX/",
          search: `?tab=${tab}`,
        }),
      ).toEqual({ publicID: "aB3dE5fX", tab });
    }
  });

  it("drops an unknown tab", () => {
    expect(
      playerProfileRouteArgs({
        pathname: "/player/aB3dE5fX",
        search: "?tab=friends",
      }),
    ).toEqual({ publicID: "aB3dE5fX" });
  });

  it("is null for any other page", () => {
    expect(
      playerProfileRouteArgs({ pathname: "/", search: "?tab=stats" }),
    ).toBeNull();
    expect(
      playerProfileRouteArgs({ pathname: "/player/bad!id", search: "" }),
    ).toBeNull();
  });
});
