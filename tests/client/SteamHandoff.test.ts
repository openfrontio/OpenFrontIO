import { afterEach, describe, expect, it, vi } from "vitest";
import {
  launchSteamJoin,
  steamHandoffMode,
  steamJoinUrl,
} from "../../src/client/SteamHandoff";

const { onCrazyGames } = vi.hoisted(() => ({ onCrazyGames: { value: false } }));
vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: { isOnCrazyGames: () => onCrazyGames.value },
}));

function settings(
  steamLobbyLinks: "ask" | "steam" | "browser",
  steamBuildSeen: boolean,
) {
  return {
    steamLobbyLinks: () => steamLobbyLinks,
    steamBuildSeen: () => steamBuildSeen,
  };
}

describe("steamJoinUrl", () => {
  it("passes the game id as a +join_game launch argument", () => {
    expect(steamJoinUrl("aB3xY9zQ12")).toBe(
      "steam://run/3560670//+join_game%20aB3xY9zQ12/",
    );
  });
});

describe("steamHandoffMode", () => {
  afterEach(() => {
    onCrazyGames.value = false;
    delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
  });

  it("leaves a browser that has never seen the Steam build alone", () => {
    expect(steamHandoffMode(settings("ask", false), "")).toBe("none");
  });

  it("asks once the Steam build has been seen", () => {
    expect(steamHandoffMode(settings("ask", true), "")).toBe("ask");
  });

  it("follows a remembered choice whether or not the build was seen", () => {
    expect(steamHandoffMode(settings("steam", false), "")).toBe("steam");
    expect(steamHandoffMode(settings("browser", true), "")).toBe("none");
  });

  it("never hands off host or spectate links", () => {
    expect(steamHandoffMode(settings("steam", true), "?host")).toBe("none");
    expect(steamHandoffMode(settings("steam", true), "?spectate")).toBe("none");
  });

  it("never hands off from inside the desktop shell", () => {
    (window as { openfrontDesktop?: unknown }).openfrontDesktop = {};
    expect(steamHandoffMode(settings("steam", true), "")).toBe("none");
  });

  it("never hands off from inside CrazyGames", () => {
    onCrazyGames.value = true;
    expect(steamHandoffMode(settings("steam", true), "")).toBe("none");
  });
});

describe("launchSteamJoin", () => {
  it("waits for load, and can be cancelled before it fires", () => {
    const readyState = vi
      .spyOn(document, "readyState", "get")
      .mockReturnValue("interactive");
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const cancel = launchSteamJoin("aB3xY9zQ12");
    const listener = add.mock.calls.find(([type]) => type === "load")?.[1];
    expect(listener).toBeDefined();
    cancel();
    expect(remove).toHaveBeenCalledWith("load", listener);

    readyState.mockRestore();
    add.mockRestore();
    remove.mockRestore();
  });
});
