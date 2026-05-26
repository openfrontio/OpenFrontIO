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
import {
  __resetIdentityStoreForTests,
  awaitIdentityReady,
  getClanTagForSubmit,
  getIdentityState,
  setClanTag,
} from "../../src/client/identity/IdentityStore";

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
  __resetIdentityStoreForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IdentityStore clan-tag ownership check", () => {
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

    setClanTag("ABC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    const state = getIdentityState();
    expect(state.clanTag.valid).toBe(false);
    expect(state.clanTag.error).toBe("username.tag_not_member");
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

    setClanTag("ABC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(localStorage.getItem("clanTag")).toBeNull();
  });

  it("keeps the tag when the clan does not exist (fictional)", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    setClanTag("FIC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(getIdentityState().clanTag.valid).toBe(true);
    expect(localStorage.getItem("clanTag")).toBe("FIC");
  });

  it("fails closed: rejects the tag when existence check is inconclusive", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(null);

    setClanTag("ABC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(getIdentityState().clanTag.valid).toBe(false);
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

    setClanTag("AAA");
    vi.advanceTimersByTime(401);
    await flushPromises();

    // User switches to a different tag before the first response lands.
    setClanTag("BBB");
    vi.advanceTimersByTime(401);
    await flushPromises();

    // First (stale) response would have said "AAA exists" → conflict, but the
    // tag is no longer AAA, so this must NOT clobber the result for BBB.
    resolveFirst(true);
    await flushPromises();
    expect(getIdentityState().clanTag.error).toBe("");

    // Second response says BBB doesn't exist → fictional, accept.
    resolveSecond(false);
    await flushPromises();
    await flushPromises();

    expect(getIdentityState().clanTag.valid).toBe(true);
    expect(localStorage.getItem("clanTag")).toBe("BBB");
  });

  it("flips ready false while a check is in flight, true on success", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    setClanTag("ABC");
    // Pre-debounce: checking flag already set so play buttons disable
    // immediately, not after the debounce.
    expect(getIdentityState().clanTagChecking).toBe(true);
    expect(getIdentityState().ready).toBe(false);

    vi.advanceTimersByTime(401);
    const ready = await awaitIdentityReady();
    expect(ready).toBe(false); // username still invalid (empty)
    expect(getIdentityState().clanTagChecking).toBe(false);
    expect(getIdentityState().clanTag.valid).toBe(true);
  });

  it("getClanTagForSubmit returns null while empty/short/pending; tag once accepted", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    setClanTag("");
    expect(getClanTagForSubmit()).toBeNull();

    setClanTag("A");
    expect(getClanTagForSubmit()).toBeNull();

    setClanTag("ABC");
    // Ownership check hasn't resolved yet → not submittable.
    expect(getIdentityState().clanTagChecking).toBe(true);
    expect(getClanTagForSubmit()).toBeNull();

    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(getClanTagForSubmit()).toBe("ABC");
  });
});
