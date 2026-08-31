import { describe, expect, test, vi } from "vitest";
import { fetchSiteInstanceId } from "../../src/server/ActiveDeployment";

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;
}

describe("fetchSiteInstanceId", () => {
  test("reads the instanceId the site's /api/health reports", async () => {
    const fetchFn = fetchReturning({ status: "ok", instanceId: "abcd1234" });
    await expect(fetchSiteInstanceId("openfront.io", fetchFn)).resolves.toBe(
      "abcd1234",
    );
    expect(fetchFn).toHaveBeenCalledWith(
      "https://openfront.io/api/health",
      expect.anything(),
    );
  });

  test("still reads the instanceId from an unhealthy (503) answer", async () => {
    // The other deployment being mid-restart is still an answer to "who is
    // the balancer routing to?".
    const fetchFn = fetchReturning(
      { status: "unavailable", instanceId: "abcd1234" },
      503,
    );
    await expect(fetchSiteInstanceId("openfront.io", fetchFn)).resolves.toBe(
      "abcd1234",
    );
  });

  test("returns null when the site runs a build without instanceId", async () => {
    const fetchFn = fetchReturning({ status: "ok" });
    await expect(
      fetchSiteInstanceId("openfront.io", fetchFn),
    ).resolves.toBeNull();
  });

  test("returns null on a non-JSON body (bot challenge page)", async () => {
    const fetchFn = vi.fn(
      async () => new Response("<html>challenge</html>", { status: 403 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchSiteInstanceId("openfront.io", fetchFn),
    ).resolves.toBeNull();
  });

  test("returns null on a network error", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    await expect(
      fetchSiteInstanceId("openfront.io", fetchFn),
    ).resolves.toBeNull();
  });
});
