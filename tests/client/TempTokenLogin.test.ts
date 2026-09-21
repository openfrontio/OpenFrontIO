import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempTokenLogin } from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";

function response(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("tempTokenLogin", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
    // Same BOOTSTRAP_CONFIG stub as UpdateUsername.test.ts — getApiBase()
    // reads it via ClientEnv and throws without it.
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as any).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("returns success with the email on 200", async () => {
    fetchSpy.mockResolvedValue(response(200, { email: "a@b.c" }));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "success", email: "a@b.c" });
  });

  it("returns failed with code=consumed on a 400 carrying that code", async () => {
    fetchSpy.mockResolvedValue(
      response(400, { error: "Bad request", code: "consumed" }),
    );
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "failed", code: "consumed" });
  });

  it("returns failed with code=expired on a 400 carrying that code", async () => {
    fetchSpy.mockResolvedValue(
      response(400, { error: "Bad request", code: "expired" }),
    );
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "failed", code: "expired" });
  });

  it("defaults to code=invalid on a 400 with an unrecognized or missing code", async () => {
    fetchSpy.mockResolvedValue(response(400, { error: "Bad request" }));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "failed", code: "invalid" });
  });

  it("returns retry on a transient server error", async () => {
    fetchSpy.mockResolvedValue(response(500, { error: "oops" }));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });

  it("returns retry on a 429 (rate limited — worth trying again)", async () => {
    fetchSpy.mockResolvedValue(response(429, { error: "slow down" }));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });

  // A permanent client error can't be fixed by retrying the same token, so
  // it must fail immediately rather than burn through the retry budget.
  it.each([401, 403, 404, 413])(
    "returns failed with code=invalid on a permanent client error (%i)",
    async (status) => {
      fetchSpy.mockResolvedValue(response(status, { error: "nope" }));
      const result = await tempTokenLogin("tok");
      expect(result).toEqual({ status: "failed", code: "invalid" });
    },
  );

  it("returns retry when the request itself throws", async () => {
    fetchSpy.mockRejectedValue(new TypeError("network error"));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });

  it("returns retry on a 200 whose body has no email", async () => {
    fetchSpy.mockResolvedValue(response(200, {}));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });

  it("returns retry on a 200 whose email field is not a string", async () => {
    fetchSpy.mockResolvedValue(response(200, { email: 12345 }));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });

  it("returns retry on a 200 with a malformed (non-JSON) body", async () => {
    fetchSpy.mockResolvedValue(
      new Response("not json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });
});
