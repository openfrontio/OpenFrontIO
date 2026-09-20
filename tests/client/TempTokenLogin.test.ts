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

  it("returns retry on a non-400 error status", async () => {
    fetchSpy.mockResolvedValue(response(500, { error: "oops" }));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });

  it("returns retry when the request itself throws", async () => {
    fetchSpy.mockRejectedValue(new TypeError("network error"));
    const result = await tempTokenLogin("tok");
    expect(result).toEqual({ status: "retry" });
  });
});
