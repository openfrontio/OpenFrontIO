import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  getAuthHeader: vi.fn(async () => "Bearer test"),
  logOut: vi.fn(async () => true),
}));

import { boostTribeName } from "../../src/client/Api";
import { ClientEnv } from "../../src/client/ClientEnv";

let fetchMock: ReturnType<typeof vi.fn>;

// Planted in the server body so the assertions test the actual rule — that no
// part of a server body reaches a log line — rather than the current wording
// of any one warning.
const CANARY = "CANARY-7f3a";

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function expectNoConsoleCallContains(needle: string) {
  for (const spy of [console.error, console.warn]) {
    for (const call of vi.mocked(spy).mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain(needle);
        expect(String(JSON.stringify(arg))).not.toContain(needle);
      }
    }
  }
}

beforeEach(() => {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.io",
    instanceId: "test",
    gitCommit: "test",
    serverHost: "main.openfront.dev",
  };
  ClientEnv.reset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
});

describe("boostTribeName 400 handling", () => {
  // Guards the warn against becoming over-broad: a recognised player-facing
  // refusal is an expected outcome, not something to log about.
  it("maps a player-facing reason without logging anything", async () => {
    respond(400, { reason: "Insufficient balance", canary: CANARY });
    expect(await boostTribeName("7", "key")).toEqual({
      ok: false,
      code: "insufficient_balance",
    });
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns without the body on an unrecognised 400", async () => {
    respond(400, { resource: "id", canary: CANARY });
    expect(await boostTribeName("nope", "key")).toEqual({
      ok: false,
      code: "failed",
    });
    expectNoConsoleCallContains(CANARY);
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]).toHaveLength(1);
  });

  it("warns without the body when the 400 body is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(`not json ${CANARY}`, {
        status: 400,
        headers: { "content-type": "text/plain" },
      }),
    );
    expect(await boostTribeName("7", "key")).toEqual({
      ok: false,
      code: "failed",
    });
    expectNoConsoleCallContains(CANARY);
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]).toHaveLength(1);
  });
});
