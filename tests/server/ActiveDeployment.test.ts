import { describe, expect, test, vi } from "vitest";
import {
  fetchSiteColor,
  shouldPollApex,
} from "../../src/server/ActiveDeployment";

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

// The drain decision is `siteColor === own color` with null meaning "no
// change" (Master.ts). Colors are deployment-wide, so a poll answered by a
// SIBLING — same color, different instanceId — reads as "still active",
// which is exactly the multi-machine case the old instanceId compare got
// wrong.
describe("fetchSiteColor", () => {
  test("reads the color the site's /api/health reports, whoever answers", async () => {
    const fetchFn = fetchReturning({
      status: "ok",
      instanceId: "some-sibling",
      color: "blue",
    });
    await expect(fetchSiteColor("openfront.io", fetchFn)).resolves.toBe("blue");
    expect(fetchFn).toHaveBeenCalledWith(
      "https://openfront.io/api/health",
      expect.anything(),
    );
  });

  test("still reads the color from an unhealthy (503) answer", async () => {
    // The other deployment being mid-restart is still an answer to "which
    // color is the balancer routing to?".
    const fetchFn = fetchReturning(
      { status: "unavailable", instanceId: "x", color: "green" },
      503,
    );
    await expect(fetchSiteColor("openfront.io", fetchFn)).resolves.toBe(
      "green",
    );
  });

  test("returns null when the site runs a build without a color", async () => {
    const fetchFn = fetchReturning({ status: "ok", instanceId: "abcd1234" });
    await expect(fetchSiteColor("openfront.io", fetchFn)).resolves.toBeNull();
  });

  test("returns null on a color outside the enum", async () => {
    const fetchFn = fetchReturning({ status: "ok", color: "purple" });
    await expect(fetchSiteColor("openfront.io", fetchFn)).resolves.toBeNull();
  });

  test("returns null on a non-JSON body (bot challenge page)", async () => {
    const fetchFn = vi.fn(
      async () => new Response("<html>challenge</html>", { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(fetchSiteColor("openfront.io", fetchFn)).resolves.toBeNull();
  });

  test("returns null on a network error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(fetchSiteColor("openfront.io", fetchFn)).resolves.toBeNull();
  });
});

// Whether to run the apex colour poll at all (Master.ts). The cluster-size
// condition is what keeps a standalone deployment from polling its own page
// host once GAME_DOMAIN gives every dev deploy a SITE_HOST — that host is
// the static Worker, which serves no /api/health.
describe("shouldPollApex", () => {
  const APEX = "openfront.io";
  const SELF = "blue.openfront.io";

  test("polls a multi-entry fleet whose page host is someone else", () => {
    expect(shouldPollApex("apex", APEX, SELF, 2)).toBe(true);
  });

  test("does not poll when the API owns the drain decision", () => {
    // Two deciders would fight over setActive.
    expect(shouldPollApex("api", APEX, SELF, 2)).toBe(false);
  });

  test("does not poll without a page host", () => {
    expect(shouldPollApex("apex", undefined, SELF, 2)).toBe(false);
  });

  test("does not poll when the page host is our own host", () => {
    expect(shouldPollApex("apex", SELF, SELF, 2)).toBe(false);
  });

  test("does not poll a single-entry map, however the hosts differ", () => {
    // A dev deployment with GAME_DOMAIN set: page host main.openfront.dev,
    // game host main.server.openfront.dev, one entry, nothing to flip to.
    expect(
      shouldPollApex(
        "apex",
        "main.openfront.dev",
        "main.server.openfront.dev",
        1,
      ),
    ).toBe(false);
  });
});
