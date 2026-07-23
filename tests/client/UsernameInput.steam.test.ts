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

  it("strips brackets from the Steam persona", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "[Ada]",
    });
    const el = new UsernameInput();
    el.connectedCallback();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.getUsername()).toBe("Ada");
  });

  it("keeps a valid generated name when the persona is invalid", async () => {
    vi.spyOn(steamSDK, "isOnSteam").mockReturnValue(true);
    vi.spyOn(steamSDK, "getUser").mockResolvedValue({
      steamId: "77",
      name: "x".repeat(100),
    });
    const el = new UsernameInput();
    el.connectedCallback();
    // Captured synchronously, before the async getUser() seed resolves: this is
    // the generated anon name loadStoredUsername() just produced.
    const generated = el.getUsername();
    await new Promise((r) => setTimeout(r, 0));
    // The invalid persona must be rejected and the exact generated name kept —
    // not merely replaced by some other valid name.
    expect(el.getUsername()).toBe(generated);
    expect(generated).not.toBe("x".repeat(100));
    expect(generated.length).toBeGreaterThan(0);
  });
});
