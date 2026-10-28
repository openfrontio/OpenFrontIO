import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserMeMock = vi.hoisted(() => vi.fn());
const fetchPublicPlayerProgressMock = vi.hoisted(() => vi.fn());
const noteFigureMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/Api", () => ({ getUserMe: getUserMeMock }));
vi.mock("../../src/client/ProgressionApi", () => ({
  fetchPublicPlayerProgress: fetchPublicPlayerProgressMock,
}));

vi.mock("../../src/client/ProvisionalProgress", () => ({
  noteFigure: noteFigureMock,
}));

import { loadPlayerProgress } from "../../src/client/PlayerProgress";

const PUBLIC = {
  prestige: 1,
  level: 12,
  lifetimeXp: 9000,
  legend: false,
  prestigeHistory: [{ rank: 1, at: "2026-09-06T00:00:00.000Z" }],
};
const OWN = { ...PUBLIC, xpInLevel: 5, xpForNext: 100, canPrestige: false };

const me = (publicId: string) => ({ player: { publicId, progress: OWN } });

describe("loadPlayerProgress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the public progress first, for anyone", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(PUBLIC);
    expect(await loadPlayerProgress("abcd1234")).toBe(PUBLIC);
    expect(fetchPublicPlayerProgressMock).toHaveBeenCalledWith("abcd1234");
    expect(getUserMeMock).not.toHaveBeenCalled();
  });

  it("falls back to /users/@me for the player's own hidden level", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    getUserMeMock.mockResolvedValue(me("abcd1234"));
    expect(await loadPlayerProgress("abcd1234")).toBe(OWN);
  });

  it("never falls back for someone else", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    getUserMeMock.mockResolvedValue(me("someone-else"));
    expect(await loadPlayerProgress("abcd1234")).toBeNull();
  });

  it("hands every figure it reads to the pending-XP store", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(PUBLIC);
    await loadPlayerProgress("abcd1234");
    expect(noteFigureMock).toHaveBeenCalledWith("abcd1234", PUBLIC);
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    getUserMeMock.mockResolvedValue(me("abcd1234"));
    await loadPlayerProgress("abcd1234");
    expect(noteFigureMock).toHaveBeenLastCalledWith("abcd1234", OWN);
    // Nothing read, nothing handed in.
    noteFigureMock.mockClear();
    getUserMeMock.mockResolvedValue(false);
    await loadPlayerProgress("abcd1234");
    expect(noteFigureMock).not.toHaveBeenCalled();
  });

  it("is null when nothing can be read", async () => {
    fetchPublicPlayerProgressMock.mockResolvedValue(false);
    getUserMeMock.mockResolvedValue(false);
    expect(await loadPlayerProgress("abcd1234")).toBeNull();
    getUserMeMock.mockRejectedValue(new Error("offline"));
    expect(await loadPlayerProgress("abcd1234")).toBeNull();
  });
});
