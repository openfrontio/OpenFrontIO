import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function createMockLocalStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

vi.mock("../../src/client/Api", () => ({
  getUserMe: vi.fn(),
}));

vi.mock("../../src/client/ClanApi", () => ({
  fetchClanExists: vi.fn(),
}));

import { getUserMe } from "../../src/client/Api";
import { fetchClanExists } from "../../src/client/ClanApi";
import { ClanTagInput } from "../../src/client/ClanTagInput";

const flushPromises = async () => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getUserMe).mockReset();
  vi.mocked(fetchClanExists).mockReset();
  vi.stubGlobal("localStorage", createMockLocalStorage());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ClanTagInput async ownership check", () => {
  it("surfaces tag_not_member when user is not a member and clan exists", async () => {
    vi.mocked(getUserMe).mockResolvedValue({
      user: {},
      player: {
        publicId: "p1",
        adfree: false,
        achievements: { singleplayerMap: [] },
        friends: [],
        subscription: null,
        clans: [],
      },
    } as any);
    vi.mocked(fetchClanExists).mockResolvedValue(true);

    const input = new ClanTagInput();
    (input as any).clanTag = "ABC";
    (input as any).validate();

    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(input.isValid()).toBe(false);
    expect((input as any).ownershipError).toBe("username.tag_not_member");
  });

  it("clears any stored clanTag when async detects ownership conflict", async () => {
    vi.mocked(getUserMe).mockResolvedValue({
      user: {},
      player: {
        publicId: "p1",
        adfree: false,
        achievements: { singleplayerMap: [] },
        friends: [],
        subscription: null,
        clans: [],
      },
    } as any);
    vi.mocked(fetchClanExists).mockResolvedValue(true);
    localStorage.setItem("clanTag", "ABC");

    const input = new ClanTagInput();
    (input as any).clanTag = "ABC";
    (input as any).validate();

    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(localStorage.getItem("clanTag")).toBeNull();
  });

  it("keeps the tag when the clan does not exist (fictional)", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    const input = new ClanTagInput();
    (input as any).clanTag = "FIC";
    (input as any).validate();

    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(input.isValid()).toBe(true);
    expect(localStorage.getItem("clanTag")).toBe("FIC");
  });

  it("fails closed: rejects the tag when existence check is inconclusive", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(null);

    const input = new ClanTagInput();
    (input as any).clanTag = "ABC";
    (input as any).validate();

    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(input.isValid()).toBe(false);
  });

  it("discards stale async results when the tag has changed", async () => {
    let resolveFirst!: (v: boolean | null) => void;
    let resolveSecond!: (v: boolean | null) => void;
    const first = new Promise<boolean | null>((r) => (resolveFirst = r));
    const second = new Promise<boolean | null>((r) => (resolveSecond = r));

    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);

    const input = new ClanTagInput();

    (input as any).clanTag = "AAA";
    (input as any).validate();
    vi.advanceTimersByTime(401);
    await flushPromises();

    // Now the user switches to a different tag before the first response lands.
    (input as any).clanTag = "BBB";
    (input as any).validate();
    vi.advanceTimersByTime(401);
    await flushPromises();

    // First (stale) response would have said "AAA exists" → conflict, but the
    // tag is no longer AAA, so this must NOT clobber the result for BBB.
    resolveFirst(true);
    await flushPromises();
    expect((input as any).ownershipError).toBe("");

    // Second response says BBB doesn't exist → fictional, accept.
    resolveSecond(false);
    await flushPromises();
    await flushPromises();

    expect(input.isValid()).toBe(true);
    expect(localStorage.getItem("clanTag")).toBe("BBB");
  });

  it("clears the pending timer in disconnectedCallback", () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    const input = new ClanTagInput();
    (input as any).clanTag = "ABC";
    (input as any).validate();

    expect((input as any).checkTimer).not.toBeNull();

    (input as any).disconnectedCallback();

    expect((input as any).checkTimer).toBeNull();
  });

  it("getValue returns null for empty/short/invalid tags and the tag when valid", () => {
    const input = new ClanTagInput();
    (input as any).clanTag = "";
    expect(input.getValue()).toBeNull();
    (input as any).clanTag = "A";
    expect(input.getValue()).toBeNull();
    (input as any).clanTag = "TOOLONG";
    expect(input.getValue()).toBeNull();
    (input as any).clanTag = "ABC";
    expect(input.getValue()).toBe("ABC");
  });
});
