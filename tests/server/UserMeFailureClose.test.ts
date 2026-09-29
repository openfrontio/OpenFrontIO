import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloseCode,
  CloseReason,
  isTerminalClose,
} from "../../src/core/CloseCodes";
import { getUserMe, userMeFailureClose } from "../../src/server/jwt";

// getUserMe resolves its endpoint from ServerEnv.jwtIssuer(), which throws
// if DOMAIN is unset.
process.env.DOMAIN ??= "localhost";

function statusResponse(status: number, statusText: string) {
  return { status, statusText, json: async () => ({}) };
}

async function closeFor(fetchImpl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const result = await getUserMe("tok");
  if (result.type !== "error") throw new Error("expected an error");
  return userMeFailureClose(result);
}

describe("join close on a failed /users/@me", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    [401, "Unauthorized"],
    [403, "Forbidden"],
  ])(
    "closes terminally on %i so the client stops reconnecting",
    async (status, text) => {
      const close = await closeFor(async () => statusResponse(status, text));
      expect(close).toEqual({
        code: CloseCode.Unauthorized,
        reason: CloseReason.InvalidToken,
      });
      expect(isTerminalClose(close.code)).toBe(true);
    },
  );

  it("stays retryable on a 5xx", async () => {
    const close = await closeFor(async () =>
      statusResponse(503, "Service Unavailable"),
    );
    expect(close).toEqual({
      code: CloseCode.InternalError,
      reason: CloseReason.AccountLookupFailed,
    });
    expect(isTerminalClose(close.code)).toBe(false);
  });

  it("stays retryable on a network failure", async () => {
    const close = await closeFor(async () => {
      throw new Error("ECONNRESET");
    });
    expect(close.code).toBe(CloseCode.InternalError);
    expect(isTerminalClose(close.code)).toBe(false);
  });

  it("stays retryable on an unparseable body", async () => {
    const close = await closeFor(async () => ({
      status: 200,
      statusText: "OK",
      json: async () => ({ not: "a user" }),
    }));
    expect(close.code).toBe(CloseCode.InternalError);
  });
});
