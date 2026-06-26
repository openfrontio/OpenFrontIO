import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import {
  approveClanRequest,
  demoteMember,
  denyClanRequest,
  disbandClan,
  fetchDiscordInvite,
  joinClan,
  kickMember,
  leaveClan,
  promoteMember,
  transferLeadership,
  updateClan,
  withdrawClanRequest,
} from "../../../src/client/ClanApi";

const okJson = (data: unknown, status = 200) => ({
  ok: true,
  status,
  json: async () => data,
});

const failRes = (status: number, data: unknown = {}) => ({
  ok: false,
  status,
  headers: new Headers(),
  json: async () => data,
});

const mockFetch = (impl: (...args: unknown[]) => unknown) =>
  vi.stubGlobal("fetch", vi.fn(impl));

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("joinClan", () => {
  it("returns { status: 'joined' } on success", async () => {
    mockFetch(() => okJson({ status: "joined" }));
    const result = await joinClan("TEST");
    expect(result).toEqual({ status: "joined" });
  });

  it("returns { status: 'requested' } for open-request clans", async () => {
    mockFetch(() => okJson({ status: "requested" }));
    const result = await joinClan("CLSD");
    expect(result).toEqual({ status: "requested" });
  });

  it("returns error key on 409 (already member)", async () => {
    mockFetch(() => failRes(409));
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_already_member" });
  });

  it("returns request pending error on 409 when message contains 'request'", async () => {
    mockFetch(() => failRes(409, { message: "join request already pending" }));
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_request_pending" });
  });

  it("returns rate limited error on 429", async () => {
    mockFetch(() => failRes(429));
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_rate_limited_generic" });
  });

  it("returns generic error on other non-ok response", async () => {
    mockFetch(() => failRes(400, { message: "clan is full" }));
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("gone"))),
    );
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });

  it("returns banned error with reason on 403 BANNED with reason", async () => {
    mockFetch(() => failRes(403, { code: "BANNED", reason: "toxic behavior" }));
    const result = await joinClan("TEST");
    expect(result).toEqual({
      error: "clan_modal.error_banned_reason",
      reason: "toxic behavior",
    });
  });

  it("returns banned error without reason on 403 BANNED with null reason", async () => {
    mockFetch(() => failRes(403, { code: "BANNED", reason: null }));
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_banned" });
  });

  it("returns generic 403 error when code is not BANNED", async () => {
    mockFetch(() => failRes(403, { message: "not authorized" }));
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns fallback error when 403 body has no code or message", async () => {
    mockFetch(() => failRes(403, {}));
    const result = await joinClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });
});

describe("leaveClan", () => {
  it("returns true on success", async () => {
    mockFetch(() => okJson({}));
    const result = await leaveClan("TEST");
    expect(result).toBe(true);
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(400, { message: "not a member" }));
    const result = await leaveClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns generic error when no message in failure body", async () => {
    mockFetch(() => failRes(500, {}));
    const result = await leaveClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await leaveClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("kickMember", () => {
  it("returns true on success", async () => {
    mockFetch(() => okJson({}));
    const result = await kickMember("TEST", "player-1");
    expect(result).toBe(true);
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(403, { message: "not authorized" }));
    const result = await kickMember("TEST", "player-1");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await kickMember("TEST", "player-1");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("promoteMember", () => {
  it("returns true on success", async () => {
    mockFetch(() => okJson({}));
    const result = await promoteMember("TEST", "player-2");
    expect(result).toBe(true);
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(403, { message: "insufficient permissions" }));
    const result = await promoteMember("TEST", "player-2");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await promoteMember("TEST", "player-2");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("demoteMember", () => {
  it("returns true on success", async () => {
    mockFetch(() => okJson({}));
    const result = await demoteMember("TEST", "player-3");
    expect(result).toBe(true);
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(400, { message: "cannot demote leader" }));
    const result = await demoteMember("TEST", "player-3");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await demoteMember("TEST", "player-3");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("transferLeadership", () => {
  it("returns true on success and POSTs to /transfer with the target", async () => {
    const fetchMock = vi.fn(() => okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await transferLeadership("TEST", "player-4");
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain("/clans/TEST/transfer");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ targetPublicId: "player-4" });
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(403, { message: "not the leader" }));
    const result = await transferLeadership("TEST", "player-4");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await transferLeadership("TEST", "player-4");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("disbandClan", () => {
  it("returns true on success and uses DELETE", async () => {
    const fetchMock = vi.fn(() => okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await disbandClan("TEST");
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string },
    ];
    expect(url).toContain("/clans/TEST");
    expect(init.method).toBe("DELETE");
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(403, { message: "not the leader" }));
    const result = await disbandClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await disbandClan("TEST");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });

  it("encodes the tag in the URL path", async () => {
    const fetchMock = vi.fn(() => okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    await disbandClan("A B");
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("/clans/A%20B");
  });
});

describe("withdrawClanRequest", () => {
  it("returns true on success and POSTs to /requests/withdraw", async () => {
    const fetchMock = vi.fn(() => okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await withdrawClanRequest("TEST");
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string },
    ];
    expect(url).toContain("/clans/TEST/requests/withdraw");
    expect(init.method).toBe("POST");
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(404, { message: "no pending request" }));
    const result = await withdrawClanRequest("TEST");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await withdrawClanRequest("TEST");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("approveClanRequest", () => {
  it("returns true on success and POSTs to /requests/approve with the target", async () => {
    const fetchMock = vi.fn(() => okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await approveClanRequest("TEST", "applicant-1");
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain("/clans/TEST/requests/approve");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ targetPublicId: "applicant-1" });
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(403, { message: "insufficient role" }));
    const result = await approveClanRequest("TEST", "applicant-1");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await approveClanRequest("TEST", "applicant-1");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("denyClanRequest", () => {
  it("returns true on success and POSTs to /requests/deny with the target", async () => {
    const fetchMock = vi.fn(() => okJson({}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await denyClanRequest("TEST", "applicant-2");
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain("/clans/TEST/requests/deny");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ targetPublicId: "applicant-2" });
  });

  it("returns error object on failure", async () => {
    mockFetch(() => failRes(404, { message: "no such request" }));
    const result = await denyClanRequest("TEST", "applicant-2");
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await denyClanRequest("TEST", "applicant-2");
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });
});

describe("updateClan", () => {
  const validClan = {
    name: "Updated Clan",
    tag: "TEST",
    description: "New description",
    isOpen: false,
    createdAt: "2024-01-01T00:00:00.000Z",
    memberCount: 10,
  };

  it("returns parsed ClanInfo on success and uses PATCH", async () => {
    const fetchMock = vi.fn(() => okJson(validClan));
    vi.stubGlobal("fetch", fetchMock);
    const result = await updateClan("TEST", { name: "Updated Clan" });
    expect(result).toEqual(validClan);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; body: string },
    ];
    expect(url).toContain("/clans/TEST");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Updated Clan" });
  });

  it("returns error object on non-ok response", async () => {
    mockFetch(() => failRes(403, { message: "not authorized" }));
    const result = await updateClan("TEST", { isOpen: true });
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns error object when Zod validation fails on 200 body", async () => {
    mockFetch(() => okJson({ tag: 123, name: null }));
    const result = await updateClan("TEST", { description: "x" });
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("returns network error on fetch failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    const result = await updateClan("TEST", { name: "x" });
    expect(result).toEqual({ error: "clan_modal.error_network" });
  });

  it("maps 400 DISCORD_INVALID to the discord invalid error", async () => {
    mockFetch(() => failRes(400, { code: "DISCORD_INVALID" }));
    const result = await updateClan("TEST", { discordUrl: "not-a-link" });
    expect(result).toEqual({ error: "clan_modal.discord_invalid" });
  });

  it("maps 400 DISCORD_EXPIRES to the discord expires error", async () => {
    mockFetch(() => failRes(400, { code: "DISCORD_EXPIRES" }));
    const result = await updateClan("TEST", {
      discordUrl: "https://discord.gg/temp",
    });
    expect(result).toEqual({ error: "clan_modal.discord_expires" });
  });

  it("returns generic error on 400 with an unrecognised code", async () => {
    mockFetch(() => failRes(400, { code: "SOMETHING_ELSE" }));
    const result = await updateClan("TEST", { name: "x" });
    expect(result).toEqual({ error: "clan_modal.error_failed" });
  });

  it("maps 429 to the discord rate limited error", async () => {
    mockFetch(() => failRes(429));
    const result = await updateClan("TEST", {
      discordUrl: "https://discord.gg/abc",
    });
    expect(result).toEqual({ error: "clan_modal.discord_rate_limited" });
  });
});

describe("fetchDiscordInvite", () => {
  const inviteBody = {
    guild: {
      id: "123",
      name: "Test Server",
      icon: "abc",
      banner: "a_def",
      description: "A server",
    },
    approximate_member_count: 100,
    approximate_presence_count: 42,
  };

  it("returns metadata with CDN asset URLs on success", async () => {
    mockFetch(() => okJson(inviteBody));
    const result = await fetchDiscordInvite("https://discord.gg/abc123");
    expect(result).toMatchObject({
      url: "https://discord.gg/abc123",
      valid: true,
      serverName: "Test Server",
      description: "A server",
      onlineCount: 42,
      memberCount: 100,
    });
    expect(result.iconUrl).toBe("https://cdn.discordapp.com/icons/123/abc.png");
    // Animated banner (a_ prefix) is served as .gif.
    expect(result.bannerUrl).toBe(
      "https://cdn.discordapp.com/banners/123/a_def.gif?size=1024",
    );
  });

  it("parses the code from the stored discord.gg/{code} URL", async () => {
    const fetchMock = vi.fn(() => okJson(inviteBody));
    vi.stubGlobal("fetch", fetchMock);
    await fetchDiscordInvite("https://discord.gg/xyz789");
    const [requestUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(requestUrl).toContain("/invites/xyz789");
  });

  it("marks the invite invalid on a Discord 404", async () => {
    mockFetch(() => failRes(404));
    const result = await fetchDiscordInvite("https://discord.gg/gone");
    expect(result).toEqual({ url: "https://discord.gg/gone", valid: false });
  });

  it("degrades to the plain link when Discord is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network"))),
    );
    const result = await fetchDiscordInvite("https://discord.gg/x");
    expect(result).toEqual({ url: "https://discord.gg/x", valid: true });
  });

  it("degrades to the plain link on a non-404 error status", async () => {
    mockFetch(() => failRes(500));
    const result = await fetchDiscordInvite("https://discord.gg/x");
    expect(result).toEqual({ url: "https://discord.gg/x", valid: true });
  });

  it("returns valid with no metadata when the response lacks a guild", async () => {
    mockFetch(() => okJson({ approximate_member_count: 5 }));
    const result = await fetchDiscordInvite("https://discord.gg/x");
    expect(result).toEqual({ url: "https://discord.gg/x", valid: true });
  });

  it("returns the plain link for an unparseable URL without fetching", async () => {
    const fetchMock = vi.fn(() => okJson(inviteBody));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchDiscordInvite("not a url");
    expect(result).toEqual({ url: "not a url", valid: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes an AbortSignal to fetch so the request can time out", async () => {
    const fetchMock = vi.fn(() => okJson(inviteBody));
    vi.stubGlobal("fetch", fetchMock);
    await fetchDiscordInvite("https://discord.gg/abc123");
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { signal: AbortSignal },
    ];
    // Pins the AbortSignal.timeout(5000) guard; without it the card could hang
    // indefinitely on a stalled connection.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("degrades to the plain link when the request times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.reject(
          new DOMException("The operation timed out", "TimeoutError"),
        ),
      ),
    );
    const result = await fetchDiscordInvite("https://discord.gg/slow");
    expect(result).toEqual({ url: "https://discord.gg/slow", valid: true });
  });
});
