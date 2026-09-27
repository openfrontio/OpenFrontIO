import { base64url } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiBase } from "../../src/client/ApiBase";
import {
  clearLocalSession,
  isSessionActive,
  userAuth,
} from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { TokenPayloadSchema } from "../../src/core/ApiSchemas";
import { uuidToBase64url } from "../../src/core/Base64";

// The real Auth module, deliberately: isSessionActive reads the JWT held in
// that module's own state, so a mocked Auth can only ever return whatever the
// mock was told to return. The bug this pins -- the guard comparing the JWT's
// base64url subject against the dashed UUID every caller passes, and so never
// being true -- is invisible to a test that stubs the function out.

const ME = "123e4567-e89b-12d3-a456-426614174000";
const SOMEONE_ELSE = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

// The claims an API-issued token carries: `sub` is the base64url form, which
// TokenPayloadSchema transforms into a dashed UUID on the way out.
function payloadFor(uuid: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    jti: `jti-${uuid}`,
    sub: uuidToBase64url(uuid),
    iat: now,
    iss: getApiBase(),
    aud: "localhost",
    exp: now + 3600,
  };
}

// Unsigned on purpose: nothing in this path verifies a signature (see the
// commented-out jwtVerify in userAuth), and decodeJwt only needs the payload.
function jwtFor(uuid: string): string {
  return [
    base64url.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url.encode(JSON.stringify(payloadFor(uuid))),
    base64url.encode("signature"),
  ].join(".");
}

// What a caller of an authenticated endpoint holds, via userAuth().claims.
function transformedSub(uuid: string): string {
  return TokenPayloadSchema.parse(payloadFor(uuid)).sub;
}

// Establish a real in-memory session the way production does: userAuth() with
// no JWT refreshes, and /auth/refresh's body is what lands in Auth's __jwt.
async function signIn(uuid: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      json: async () => ({ jwt: jwtFor(uuid), expiresIn: 3600 }),
    })),
  );
  const auth = await userAuth();
  expect(auth).not.toBe(false);
  return auth as Exclude<typeof auth, false>;
}

describe("isSessionActive against a real in-memory JWT", () => {
  beforeEach(() => {
    localStorage.clear();
    // "localhost" is the one audience userAuth does not hold the token to, so
    // the token only has to name this API base as its issuer.
    (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
  });

  afterEach(() => {
    clearLocalSession();
    vi.unstubAllGlobals();
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    localStorage.clear();
  });

  it("recognises the session it is currently holding", async () => {
    const auth = await signIn(ME);

    // Exactly what Api.ts's requestUserMe passes: the transformed claim.
    expect(auth.claims.sub).toBe(ME);
    expect(isSessionActive(auth.claims.sub)).toBe(true);
  });

  it("rejects another account's subject", async () => {
    await signIn(ME);

    expect(isSessionActive(transformedSub(SOMEONE_ELSE))).toBe(false);
  });

  it("rejects the raw base64url subject, which no caller holds", async () => {
    await signIn(ME);

    // Pins the direction of the conversion: the guard answers the encoding
    // TokenPayloadSchema produces, not the one the JWT carries.
    expect(isSessionActive(uuidToBase64url(ME))).toBe(false);
  });

  it("is false with no session at all", () => {
    expect(isSessionActive(ME)).toBe(false);
  });
});
