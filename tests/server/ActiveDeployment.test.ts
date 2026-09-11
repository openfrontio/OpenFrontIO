import { describe, expect, test, vi } from "vitest";
import { fetchSiteColor } from "../../src/server/ActiveDeployment";

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
