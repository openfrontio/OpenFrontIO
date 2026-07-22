import { beforeEach, describe, expect, it, vi } from "vitest";
import { steamSDK } from "../../src/client/SteamSDK";
import { UsernameInput } from "../../src/client/UsernameInput";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("UsernameInput Steam seeding", () => {
  it("seeds and persists the Steam persona when nothing is stored", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "Ada",
    });
    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getUsername()).toBe("Ada");
    expect(localStorage.getItem("username")).toBe("Ada"); // usernameKey
  });

  it("keeps an already-stored username", async () => {
    localStorage.setItem("username", "MyName");
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "Ada",
    });
    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getUsername()).toBe("MyName");
  });
});
