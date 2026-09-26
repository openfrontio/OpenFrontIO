import { base64url } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getApiBase } from "../../src/client/ApiBase";
import {
  clearLocalSession,
  rememberPublicId,
  userAuth,
} from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { uuidToBase64url } from "../../src/core/Base64";
import { UserSettings } from "../../src/core/game/UserSettings";

// The real Auth module, for the same reason AuthSessionActive.test.ts uses it:
// the cosmetic scope is derived from the JWT held in Auth's own state, so a
// mocked Auth can only echo back whatever the mock was told. What is under test
// is which id Auth hands UserSettings for a given token -- the /users/@me
// round trip it was there to get ahead of (#5660).

const ME = "123e4567-e89b-12d3-a456-426614174000";
const SOMEONE_ELSE = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
const MY_PUBLIC_ID = "HabCsQYR";
const PUBLIC_ID_CACHE_PREFIX = "cached_public_id_";

function payloadFor(uuid: string, publicId?: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    jti: `jti-${uuid}`,
    sub: uuidToBase64url(uuid),
    iat: now,
    iss: getApiBase(),
    aud: "localhost",
    exp: now + 3600,
    ...(publicId === undefined ? {} : { publicId }),
  };
}

// Unsigned on purpose: nothing in this path verifies a signature (see the
// commented-out jwtVerify in userAuth), and decodeJwt only needs the payload.
function jwtFor(payload: object): string {
  return [
    base64url.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url.encode(JSON.stringify(payload)),
    base64url.encode("signature"),
  ].join(".");
}

// Establish a real in-memory session the way production does: userAuth() with
// no JWT refreshes, and /auth/refresh's body is what lands in Auth's __jwt.
async function signInWith(payload: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 200,
      json: async () => ({ jwt: jwtFor(payload), expiresIn: 3600 }),
    })),
  );
  await userAuth();
}

/** The id each setPlayerId call was given, in order. */
function scopeSpy() {
  return vi.spyOn(UserSettings, "setPlayerId");
}

describe("cosmetic scope derived from the session JWT", () => {
  let setPlayerId: ReturnType<typeof scopeSpy>;

  beforeEach(() => {
    localStorage.clear();
    const statics = UserSettings as unknown as {
      cache: Map<string, string | null>;
      playerId: string | null;
    };
    statics.cache.clear();
    statics.playerId = null;
    setPlayerId = scopeSpy();
    // getApiBase() reads this. "localhost" is the one audience userAuth does
    // not hold the token to, so the token only has to name this API base.
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
    vi.restoreAllMocks();
    delete (window as unknown as { BOOTSTRAP_CONFIG?: unknown })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    localStorage.clear();
  });

  it("uses the publicId claim when the token carries one", async () => {
    await signInWith(payloadFor(ME, MY_PUBLIC_ID));

    expect(setPlayerId).toHaveBeenLastCalledWith(MY_PUBLIC_ID);
  });

  // The shape a session token has today: no publicId claim, so the scope has to
  // come from what /users/@me reported last time. Without this the returning
  // player reads the logged-out keys until that request lands.
  it("falls back to the publicId cached for this persistent id", async () => {
    localStorage.setItem(PUBLIC_ID_CACHE_PREFIX + ME, MY_PUBLIC_ID);

    await signInWith(payloadFor(ME));

    expect(setPlayerId).toHaveBeenLastCalledWith(MY_PUBLIC_ID);
  });

  it("uses the in-memory publicId when the persistent cache write fails", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
      ) {
        if (key === PUBLIC_ID_CACHE_PREFIX + ME) {
          throw new DOMException("storage unavailable");
        }
        return originalSetItem.call(this, key, value);
      });

    // This mirrors the /users/@me success path: the server has already
    // supplied the publicId, but persistence of that known ID fails.
    rememberPublicId(ME, MY_PUBLIC_ID);
    expect(setItemSpy).toHaveBeenCalledWith(
      PUBLIC_ID_CACHE_PREFIX + ME,
      MY_PUBLIC_ID,
    );

    await signInWith(payloadFor(ME));

    expect(setPlayerId).toHaveBeenLastCalledWith(MY_PUBLIC_ID);
  });

  it("replaces the in-memory publicId when the authenticated account changes", async () => {
    rememberPublicId(ME, MY_PUBLIC_ID);

    await signInWith(payloadFor(SOMEONE_ELSE));

    expect(setPlayerId).toHaveBeenLastCalledWith(null);
  });

  it("never reuses another account's cached publicId", async () => {
    localStorage.setItem(PUBLIC_ID_CACHE_PREFIX + SOMEONE_ELSE, MY_PUBLIC_ID);

    await signInWith(payloadFor(ME));

    expect(setPlayerId).toHaveBeenLastCalledWith(null);
  });

  it("stays on the logged-out scope when nothing is cached", async () => {
    await signInWith(payloadFor(ME));

    expect(setPlayerId).toHaveBeenLastCalledWith(null);
  });

  // A decodable but unvalidatable token must not be allowed to claim anyone's
  // cosmetic scope: the id decides which player's stored selections load.
  it("clears the scope when the claims do not validate", async () => {
    localStorage.setItem(PUBLIC_ID_CACHE_PREFIX + ME, MY_PUBLIC_ID);

    await signInWith({ ...payloadFor(ME), publicId: "" });

    expect(setPlayerId).toHaveBeenLastCalledWith(null);
  });

  it("clears the scope when the session ends", async () => {
    await signInWith(payloadFor(ME, MY_PUBLIC_ID));
    setPlayerId.mockClear();

    clearLocalSession();

    expect(setPlayerId).toHaveBeenLastCalledWith(null);
  });
});
