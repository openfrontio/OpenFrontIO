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
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

const anonMe = {
  user: {},
  player: {
    publicId: "p1",
    adfree: false,
    achievements: { singleplayerMap: [] },
    friends: [],
    subscription: null,
    clans: [],
  },
} as any;

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
  it("rejects with tag_not_member when not a member and the clan exists", async () => {
    vi.mocked(getUserMe).mockResolvedValue(anonMe);
    vi.mocked(fetchClanExists).mockResolvedValue(true);

    setClanTag("ABC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    const state = getIdentityState();
    expect(state.clanTag.valid).toBe(false);
    expect(state.clanTag.error).toBe("username.tag_not_member");
  });

  it("clears any stored clanTag on an ownership conflict", async () => {
    vi.mocked(getUserMe).mockResolvedValue(anonMe);
    vi.mocked(fetchClanExists).mockResolvedValue(true);
    localStorage.setItem("clanTag", "ABC");

    setClanTag("ABC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(localStorage.getItem("clanTag")).toBeNull();
  });

  it("accepts a fictional tag (clan does not exist)", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    setClanTag("FIC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(getIdentityState().clanTag.valid).toBe(true);
    expect(localStorage.getItem("clanTag")).toBe("FIC");
  });

  it("accepts a member's tag without probing existence", async () => {
    vi.mocked(getUserMe).mockResolvedValue({
      ...anonMe,
      player: { ...anonMe.player, clans: [{ tag: "ABC" }] },
    });

    setClanTag("ABC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(getIdentityState().clanTag.valid).toBe(true);
    expect(fetchClanExists).not.toHaveBeenCalled();
  });

  it("rejects with tag_check_failed when existence is inconclusive", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(null);

    setClanTag("ABC");
    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    // Can't prove ownership -> stays gated, with a message telling the user.
    const state = getIdentityState();
    expect(state.clanTag.valid).toBe(false);
    expect(state.clanTag.error).toBe("username.tag_check_failed");
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

    // Switch tags before the first probe lands.
    setClanTag("BBB");
    vi.advanceTimersByTime(401);
    await flushPromises();

    // Stale "AAA exists" must not clobber BBB.
    resolveFirst(true);
    await flushPromises();
    expect(getIdentityState().clanTag.error).toBe("");

    resolveSecond(false);
    await flushPromises();
    await flushPromises();

    expect(getIdentityState().clanTag.valid).toBe(true);
    expect(localStorage.getItem("clanTag")).toBe("BBB");
  });

  it("gates play while a check is in flight, then clears it", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    setClanTag("ABC");
    // Pre-debounce: checking is already set so buttons disable immediately.
    expect(getIdentityState().clanTagChecking).toBe(true);
    expect(getIdentityState().ready).toBe(false);

    vi.advanceTimersByTime(401);
    const ready = await awaitIdentityReady();
    expect(ready).toBe(false); // username still invalid (empty)
    expect(getIdentityState().clanTagChecking).toBe(false);
    expect(getIdentityState().clanTag.valid).toBe(true);
  });

  it("getClanTagForSubmit: null while empty/short/checking; tag once accepted", async () => {
    vi.mocked(getUserMe).mockResolvedValue(false);
    vi.mocked(fetchClanExists).mockResolvedValue(false);

    setClanTag("");
    expect(getClanTagForSubmit()).toBeNull();

    setClanTag("A"); // too short -> format invalid
    expect(getClanTagForSubmit()).toBeNull();

    setClanTag("ABC");
    expect(getIdentityState().clanTagChecking).toBe(true);
    expect(getClanTagForSubmit()).toBeNull();

    vi.advanceTimersByTime(401);
    await flushPromises();
    await flushPromises();

    expect(getClanTagForSubmit()).toBe("ABC");
  });
});
