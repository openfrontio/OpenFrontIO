import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/client/Api", () => ({
  getApiBase: vi.fn(() => "http://localhost:3000"),
  getUserMe: vi.fn(),
}));

vi.mock("../../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer test-token"),
}));

import {
  fetchClanMapActivity,
  fetchClanMapActivityMembers,
} from "../../../src/client/ClanApi";

const res = (status: number, data: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
});

function stubFetch(status: number, data: unknown) {
  const spy = vi.fn((_input: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(res(status, data)),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const player = { id: "p1", username: "alice" };
const page = {
  summary: {
    gained: 412,
    lost: 47,
    shipsAtSea: 1,
    nextLandingAt: "2026-11-11T15:06:00.000Z",
  },
  atSea: [
    {
      kind: "ship_sailing",
      at: "2026-11-11T14:50:00.000Z",
      player,
      troops: 3000,
      toX: 1012,
      toY: 620,
      arrivesAt: "2026-11-11T15:06:00.000Z",
    },
  ],
  events: [
    {
      kind: "claimed",
      at: "2026-11-11T14:48:00.000Z",
      player,
      pixels: 12,
      neutral: 8,
      takenFrom: [{ clan: { tag: "LUX", color: 0x5b4be0 }, pixels: 4 }],
      x: 2380,
      y: 1150,
    },
    {
      kind: "unclaimed",
      at: "2026-11-11T14:40:00.000Z",
      player,
      pixels: 4,
      refundTroops: 2000,
      x: 1,
      y: 2,
    },
    {
      kind: "bought_troops",
      at: "2026-11-11T14:20:00.000Z",
      player: { id: null, username: null },
      troops: 50000,
      caps: "500",
    },
    {
      kind: "ship_landed",
      at: "2026-11-11T11:52:00.000Z",
      player,
      troops: 3000,
      toX: 2401,
      toY: 1166,
      outcome: "captured",
    },
    {
      kind: "lost",
      at: "2026-11-11T09:30:00.000Z",
      clan: { tag: "LUX", color: null },
      player: { id: "p9", username: "Velyx" },
      pixels: 15,
      x: 2378,
      y: 1148,
    },
    {
      kind: "siege",
      at: "2026-11-10T22:10:00.000Z",
      clan: { tag: null, color: null },
      pixels: 32,
      x: 3,
      y: 4,
    },
  ],
  nextBefore: "2026-11-10T22:10:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("fetchClanMapActivity", () => {
  it("parses every event kind", async () => {
    stubFetch(200, page);
    expect(await fetchClanMapActivity("OF")).toEqual(page);
  });

  it("asks for the filter, and the cursor only when given", async () => {
    const spy = stubFetch(200, page);
    await fetchClanMapActivity("a/b");
    let url = new URL(spy.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/clans/a%2Fb/map-activity");
    expect(url.searchParams.get("filter")).toBe("all");
    expect(url.searchParams.has("before")).toBe(false);

    await fetchClanMapActivity("OF", {
      filter: "lost",
      before: "2026-11-10T22:10:00.000Z",
    });
    url = new URL(spy.mock.calls[1]![0] as string);
    expect(url.searchParams.get("filter")).toBe("lost");
    expect(url.searchParams.get("before")).toBe("2026-11-10T22:10:00.000Z");
  });

  it("is forbidden on 403, failed on other errors or a bad body", async () => {
    stubFetch(403, {});
    expect(await fetchClanMapActivity("OF")).toEqual({ error: "forbidden" });
    stubFetch(500, {});
    expect(await fetchClanMapActivity("OF")).toEqual({ error: "failed" });
    stubFetch(200, { ...page, events: [{ kind: "nonsense" }] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchClanMapActivity("OF")).toEqual({ error: "failed" });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await fetchClanMapActivity("OF")).toEqual({ error: "failed" });
  });
});

describe("fetchClanMapActivityMembers", () => {
  const members = {
    period: "7d",
    members: [
      {
        player,
        role: "leader",
        claimed: 412,
        caps: "2400",
        shipsSent: 5,
        shipsLanded: 4,
        lastActiveAt: "2026-11-11T14:48:00.000Z",
      },
      {
        player: { id: "p2", username: "rook" },
        role: null,
        claimed: 0,
        caps: "0",
        shipsSent: 0,
        shipsLanded: 0,
        lastActiveAt: null,
      },
    ],
  };

  it("parses members and asks for the period (7 days by default)", async () => {
    const spy = stubFetch(200, members);
    expect(await fetchClanMapActivityMembers("OF")).toEqual(members);
    const url = new URL(spy.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/clans/OF/map-activity/members");
    expect(url.searchParams.get("period")).toBe("7d");
    await fetchClanMapActivityMembers("OF", "30d");
    expect(
      new URL(spy.mock.calls[1]![0] as string).searchParams.get("period"),
    ).toBe("30d");
  });

  it("is forbidden on 403 and failed otherwise", async () => {
    stubFetch(403, {});
    expect(await fetchClanMapActivityMembers("OF")).toEqual({
      error: "forbidden",
    });
    stubFetch(502, {});
    expect(await fetchClanMapActivityMembers("OF")).toEqual({
      error: "failed",
    });
  });
});
