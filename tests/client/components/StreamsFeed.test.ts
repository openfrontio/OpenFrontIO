import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import streamsFallback from "../../../resources/streams.json";
import { getStreams } from "../../../src/client/Api";
import {
  broadcastKey,
  isFeedFresh,
  streamsFeed,
} from "../../../src/client/StreamsFeed";
import {
  StreamsFeedSchema,
  StreamsFeed as StreamsFeedType,
} from "../../../src/core/ApiSchemas";

vi.mock("../../../src/client/Api", () => ({ getStreams: vi.fn() }));
const getStreamsMock = vi.mocked(getStreams);

const entry = {
  platform: "twitch" as const,
  channel: "openfrontmasters",
  displayName: "OFM",
  viewers: 100,
  url: "https://twitch.tv/openfrontmasters",
  startedAt: "2026-08-03T12:00:00Z",
};

describe("StreamsFeedSchema", () => {
  it("parses a verified feed", () => {
    const feed = StreamsFeedSchema.parse({
      verifiedAt: "2026-08-03T13:00:00Z",
      featured: [entry],
      live: [],
    });
    expect(feed.featured[0].startedAt).toBe("2026-08-03T12:00:00Z");
  });

  it("defaults both lists to empty", () => {
    const feed = StreamsFeedSchema.parse({
      verifiedAt: "2026-08-03T13:00:00Z",
    });
    expect(feed.featured).toEqual([]);
    expect(feed.live).toEqual([]);
  });

  // The bug this whole change exists to prevent. The old payload was a bare channel
  // list that could not express liveness, so a client could not tell a stale API from a
  // current one and embedded an offline channel on its word. It must now fail to parse,
  // which routes it to the bundled fallback and shows nothing.
  it("rejects the legacy {enabled, channels} payload", () => {
    const parsed = StreamsFeedSchema.safeParse({
      enabled: true,
      channels: ["openfrontmasters"],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an entry with no startedAt (no proof of liveness)", () => {
    const noProof = { ...entry, startedAt: undefined };
    const parsed = StreamsFeedSchema.safeParse({
      verifiedAt: "2026-08-03T13:00:00Z",
      featured: [noProof],
      live: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-ISO startedAt", () => {
    const parsed = StreamsFeedSchema.safeParse({
      verifiedAt: "2026-08-03T13:00:00Z",
      featured: [{ ...entry, startedAt: "yesterday" }],
      live: [],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a feed with no verifiedAt", () => {
    const parsed = StreamsFeedSchema.safeParse({ featured: [], live: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-https url (no javascript:/http:)", () => {
    for (const url of ["javascript:alert(1)", "http://example.com"]) {
      const parsed = StreamsFeedSchema.safeParse({
        verifiedAt: "2026-08-03T13:00:00Z",
        featured: [{ ...entry, url }],
        live: [],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects channels with URL delimiters or whitespace", () => {
    for (const channel of ["foo/bar", "x?y=1", "a b", "x#frag", ""]) {
      const parsed = StreamsFeedSchema.safeParse({
        verifiedAt: "2026-08-03T13:00:00Z",
        featured: [{ ...entry, channel }],
        live: [],
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("bundled fallback (resources/streams.json)", () => {
  it("is valid and ships empty", () => {
    const feed = StreamsFeedSchema.parse(streamsFallback);
    expect(feed.featured).toEqual([]);
    expect(feed.live).toEqual([]);
  });
});

describe("isFeedFresh", () => {
  const now = Date.parse("2026-08-03T13:00:00Z");

  it("accepts a feed built moments ago", () => {
    expect(isFeedFresh("2026-08-03T12:59:00Z", now)).toBe(true);
  });

  // The cron writes every 2 min and the snapshot TTL is 10 min, so anything older means
  // the cron is dead and the edge is serving a corpse. Show nothing.
  it("rejects a feed older than the 10 minute window", () => {
    expect(isFeedFresh("2026-08-03T12:49:00Z", now)).toBe(false);
  });

  it("rejects an unparseable timestamp", () => {
    expect(isFeedFresh("not a date", now)).toBe(false);
  });
});

describe("broadcastKey", () => {
  it("is stable for the same broadcast", () => {
    expect(broadcastKey(entry)).toBe(
      "twitch:openfrontmasters:2026-08-03T12:00:00Z",
    );
  });

  // A streamer going offline and starting a NEW broadcast must produce a new key, so a
  // genuine restart is embeddable again even though the previous one was suppressed.
  it("changes when the same channel starts a new broadcast", () => {
    expect(
      broadcastKey({ ...entry, startedAt: "2026-08-03T18:00:00Z" }),
    ).not.toBe(broadcastKey(entry));
  });
});

describe("streamsFeed polling lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getStreamsMock.mockReset();
    getStreamsMock.mockResolvedValue({
      verifiedAt: new Date().toISOString(),
      featured: [],
      live: [],
    });
  });

  afterEach(() => {
    // Module singleton: clear cached feed, listeners and lifecycle flags so these tests
    // stay order-independent.
    streamsFeed.reset();
    vi.useRealTimers();
  });

  // Two independent pollers for one answer is what made this spammy in the first place.
  it("serves both subscribers from a single fetch", async () => {
    const unsubA = streamsFeed.subscribe(() => {});
    const unsubB = streamsFeed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(getStreamsMock).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  // The whole reason StreamingNow leaked: it kept polling through an entire game,
  // because <play-page> is never removed from the DOM so disconnectedCallback never ran.
  it("stops polling once a game starts and resumes on leave", async () => {
    const unsub = streamsFeed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const before = getStreamsMock.mock.calls.length;

    document.dispatchEvent(new CustomEvent("game-starting"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(getStreamsMock.mock.calls.length).toBe(before);

    document.dispatchEvent(new CustomEvent("leave-lobby"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getStreamsMock.mock.calls.length).toBeGreaterThan(before);
    unsub();
  });

  it("stops polling when the last subscriber goes away", async () => {
    const unsub = streamsFeed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const before = getStreamsMock.mock.calls.length;
    unsub();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(getStreamsMock.mock.calls.length).toBe(before);
  });

  // A backgrounded tab must not keep fetching. Spec-listed alongside the in-game stop.
  it("stops polling while the tab is hidden and resumes when it returns", async () => {
    const unsub = streamsFeed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const before = getStreamsMock.mock.calls.length;

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(getStreamsMock.mock.calls.length).toBe(before);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(getStreamsMock.mock.calls.length).toBeGreaterThan(before);
    unsub();
  });

  // getStreams() normally swallows its own errors, but it can still throw if the bundled
  // fallback fails to parse. The next poll was scheduled only on the success path, so one
  // throw froze the feed for the rest of the session.
  it("keeps polling after a fetch rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getStreamsMock.mockRejectedValueOnce(new Error("fallback unparseable"));
    const unsub = streamsFeed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    const afterFailure = getStreamsMock.mock.calls.length;
    expect(afterFailure).toBe(1);

    await vi.advanceTimersByTimeAsync(61_000);
    expect(getStreamsMock.mock.calls.length).toBeGreaterThan(afterFailure);
    unsub();
  });

  it("recovers the feed after a transient fetch failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getStreamsMock.mockRejectedValueOnce(new Error("network down"));
    const seen: StreamsFeedType[] = [];
    const unsub = streamsFeed.subscribe((feed) => seen.push(feed));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(61_000);
    // The immediate empty hand-off on subscribe, then a real feed from the retry.
    expect(seen.length).toBeGreaterThan(1);
    unsub();
  });

  // reset() cleared the flags but could not stop a tick already awaiting getStreams().
  // That tick would then deliver the previous test's feed to the next test's subscribers
  // and clear a tickInFlight it no longer owned.
  it("orphans a tick that is still in flight when reset() runs", async () => {
    let settleFirst: (feed: StreamsFeedType) => void = () => {};
    getStreamsMock.mockImplementationOnce(
      () => new Promise<StreamsFeedType>((resolve) => (settleFirst = resolve)),
    );
    streamsFeed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0); // first tick is now awaiting the fetch

    streamsFeed.reset(); // what afterEach does between tests

    const seen: StreamsFeedType[] = [];
    const unsub = streamsFeed.subscribe((feed) => seen.push(feed));
    seen.length = 0; // discard the immediate empty hand-off on subscribe

    // The abandoned fetch settles with a feed full of live streams.
    settleFirst({
      verifiedAt: new Date().toISOString(),
      featured: [entry],
      live: [entry],
    });
    await vi.advanceTimersByTimeAsync(0);

    // The new subscriber must only ever see its own (empty) feed.
    expect(seen.every((feed) => feed.live.length === 0)).toBe(true);
    unsub();
  });

  // A module singleton feeding two components: one bad listener must not stop the feed
  // for the other. Previously a synchronous throw skipped the setTimeout entirely.
  it("keeps polling when one subscriber throws", async () => {
    const good = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const unsubBad = streamsFeed.subscribe(() => {
      throw new Error("listener blew up");
    });
    const unsubGood = streamsFeed.subscribe(good);
    await vi.advanceTimersByTimeAsync(0);
    const before = getStreamsMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(61_000);
    expect(getStreamsMock.mock.calls.length).toBeGreaterThan(before);
    expect(good).toHaveBeenCalled(); // and the healthy listener still got the feed
    unsubBad();
    unsubGood();
  });

  it("hands subscribers an empty feed when the served one is stale", async () => {
    getStreamsMock.mockResolvedValue({
      verifiedAt: "1970-01-01T00:00:00.000Z",
      featured: [entry],
      live: [entry],
    });
    let seen: unknown = null;
    const unsub = streamsFeed.subscribe((feed) => {
      seen = feed;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual({
      verifiedAt: "1970-01-01T00:00:00.000Z",
      featured: [],
      live: [],
    });
    unsub();
  });
});
