import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ header: "Bearer t" }));
vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: async () => auth.header,
}));
vi.mock("../../src/client/ApiBase", () => ({
  getApiBase: () => "https://api.test",
}));

import { fetchNemesisCount, nemesisLine } from "../../src/client/NemesisApi";

describe("nemesisLine", () => {
  it("adds this game and shows from the threshold", () => {
    expect(nemesisLine(1)).toBeNull();
    expect(nemesisLine(2)).toEqual({ count: 3 });
    expect(nemesisLine(7)).toEqual({ count: 8 });
  });
});

describe("fetchNemesisCount", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    auth.header = "Bearer t";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads the count for that player", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ eliminations: 2 }), { status: 200 }),
    );
    expect(await fetchNemesisCount("pub 1")).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.test/users/@me/nemesis/pub%201",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer t" }),
      }),
    );
  });

  it("fetch failure gives null", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await fetchNemesisCount("pub1")).toBeNull();
  });

  it("a non-200 or a bad body gives null", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await fetchNemesisCount("pub1")).toBeNull();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ eliminations: "x" }), { status: 200 }),
    );
    expect(await fetchNemesisCount("pub1")).toBeNull();
  });

  it("signed out makes no request", async () => {
    auth.header = "";
    expect(await fetchNemesisCount("pub1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
