import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/ServerEnv", () => ({
  ServerEnv: {
    jwtIssuer: () => "http://auth.test",
    apiKey: () => "test-key",
  },
}));

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  _clearClanExistsCacheForTest,
  clanExistsByTag,
} from "../../src/server/jwt";

const jsonResponse = (status: number, body: unknown = "") => ({
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  _clearClanExistsCacheForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clanExistsByTag", () => {
  it("returns true on HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200))),
    );
    await expect(clanExistsByTag("ABC")).resolves.toBe(true);
  });

  it("returns false on HTTP 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(404))),
    );
    await expect(clanExistsByTag("XYZ")).resolves.toBe(false);
  });

  it("returns null and fails open on unexpected status (5xx)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(503))),
    );
    await expect(clanExistsByTag("ABC")).resolves.toBeNull();
  });

  it("returns null and fails open on rate-limit (429)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(429))),
    );
    await expect(clanExistsByTag("ABC")).resolves.toBeNull();
  });

  it("returns null on transport error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    await expect(clanExistsByTag("ABC")).resolves.toBeNull();
  });

  it("caches results across calls within TTL", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(jsonResponse(200)));
    vi.stubGlobal("fetch", fetchSpy);
    await clanExistsByTag("ABC");
    await clanExistsByTag("ABC");
    await clanExistsByTag("ABC");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not cache fail-open (null) results so transient outages recover", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(clanExistsByTag("ABC")).resolves.toBeNull();
    await expect(clanExistsByTag("ABC")).resolves.toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uppercases the tag in the URL", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(jsonResponse(200)),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await clanExistsByTag("abc");
    const calledUrl = fetchSpy.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("/public/clan/ABC/exists");
  });

  it("treats a body {exists:false} as false on 200 (forward-compat)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(200, { exists: false }))),
    );
    await expect(clanExistsByTag("ABC")).resolves.toBe(false);
  });

  it("caches by uppercased tag (different cases hit the same entry)", async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(jsonResponse(200)));
    vi.stubGlobal("fetch", fetchSpy);
    await clanExistsByTag("abc");
    await clanExistsByTag("ABC");
    await clanExistsByTag("Abc");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends Accept: application/json header", async () => {
    const fetchSpy = vi.fn(
      (_input: string | URL | Request, _init?: RequestInit) =>
        Promise.resolve(jsonResponse(200)),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await clanExistsByTag("ABC");
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Accept).toBe(
      "application/json",
    );
  });
});
