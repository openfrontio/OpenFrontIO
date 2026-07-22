import { describe, expect, it, beforeEach, vi } from "vitest";
import { steamSDK } from "../src/client/SteamSDK";

beforeEach(() => {
  delete (window as any).openfrontDesktop;
});

describe("SteamSDK", () => {
  it("isOnSteam is false without the bridge", () => {
    expect(steamSDK.isOnSteam()).toBe(false);
  });
  it("isOnSteam true and passes through ticket/user with the bridge", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockResolvedValue("deadbeef"),
        getUser: vi.fn().mockResolvedValue({ steamId: "77", name: "Ada" }),
      },
    };
    expect(steamSDK.isOnSteam()).toBe(true);
    expect(await steamSDK.getTicket()).toBe("deadbeef");
    expect(await steamSDK.getUser()).toEqual({ steamId: "77", name: "Ada" });
  });
  it("getTicket degrades to null when bridge rejects", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn().mockRejectedValue(new Error("boom")),
        getUser: vi.fn(),
      },
    };
    expect(await steamSDK.getTicket()).toBeNull();
  });
  it("getUser degrades to null when bridge rejects", async () => {
    (window as any).openfrontDesktop = {
      steam: {
        getAuthTicket: vi.fn(),
        getUser: vi.fn().mockRejectedValue(new Error("boom")),
      },
    };
    expect(await steamSDK.getUser()).toBeNull();
  });
});
