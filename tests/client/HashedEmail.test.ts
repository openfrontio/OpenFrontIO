import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HEM_STORAGE_KEY,
  hashEmail,
  syncHashedEmail,
} from "../../src/client/HashedEmail";

// sha256("user@example.com")
const USER_HASH =
  "b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514";

function me(user: UserMeResponse["user"]): UserMeResponse {
  return { user } as UserMeResponse;
}

let que: Array<() => void>;
let profiles: unknown[];

beforeEach(() => {
  localStorage.clear();
  que = [];
  profiles = [];
  (window as unknown as { ramp: unknown }).ramp = {
    que,
    setUserProfile: (p: unknown) => profiles.push(p),
  };
});

afterEach(() => {
  delete (window as unknown as { ramp?: unknown }).ramp;
});

const drain = () => que.splice(0).forEach((fn) => fn());

describe("hashEmail", () => {
  it("trims and lowercases before hashing", async () => {
    expect(await hashEmail("  User@Example.COM ")).toBe(USER_HASH);
  });
});

describe("syncHashedEmail", () => {
  it("stores the hash and hands it to RAMP on first sign-in", async () => {
    await syncHashedEmail(me({ email: "user@example.com" }), true);
    drain();

    expect(localStorage.getItem(HEM_STORAGE_KEY)).toBe(USER_HASH);
    expect(profiles).toEqual([{ format: "UUP1", heid: { sha256: USER_HASH } }]);
  });

  it("uses the Google email when there is no email login", async () => {
    await syncHashedEmail(me({ google: { email: "user@example.com" } }), true);

    expect(localStorage.getItem(HEM_STORAGE_KEY)).toBe(USER_HASH);
  });

  it("doesn't call setUserProfile again for a hash index.html already passed", async () => {
    localStorage.setItem(HEM_STORAGE_KEY, USER_HASH);

    await syncHashedEmail(me({ email: "user@example.com" }), true);
    drain();

    expect(profiles).toEqual([]);
  });

  it("drops the hash on logout", async () => {
    localStorage.setItem(HEM_STORAGE_KEY, USER_HASH);

    await syncHashedEmail(false, true);

    expect(localStorage.getItem(HEM_STORAGE_KEY)).toBeNull();
  });

  it("drops the hash for an account with no email", async () => {
    localStorage.setItem(HEM_STORAGE_KEY, USER_HASH);

    await syncHashedEmail(
      me({ steam: { steamId: "1", personaName: null, avatarUrl: null } }),
      true,
    );

    expect(localStorage.getItem(HEM_STORAGE_KEY)).toBeNull();
  });

  it("drops the hash and sends nothing when ads are off", async () => {
    localStorage.setItem(HEM_STORAGE_KEY, USER_HASH);

    await syncHashedEmail(me({ email: "user@example.com" }), false);
    drain();

    expect(localStorage.getItem(HEM_STORAGE_KEY)).toBeNull();
    expect(profiles).toEqual([]);
  });

  it("doesn't send a hash queued before a logout once ramp.js loads", async () => {
    await syncHashedEmail(me({ email: "user@example.com" }), true);
    await syncHashedEmail(false, true);
    drain();

    expect(profiles).toEqual([]);
  });

  it("still sends a queued hash when the same account syncs again", async () => {
    await syncHashedEmail(me({ email: "user@example.com" }), true);
    await syncHashedEmail(me({ email: "user@example.com" }), true);
    drain();

    expect(profiles).toEqual([{ format: "UUP1", heid: { sha256: USER_HASH } }]);
  });

  it("doesn't write an account back after a logout that overtook its hash", async () => {
    const signIn = syncHashedEmail(me({ email: "user@example.com" }), true);
    await syncHashedEmail(false, true);
    await signIn;
    drain();

    expect(localStorage.getItem(HEM_STORAGE_KEY)).toBeNull();
    expect(profiles).toEqual([]);
  });
});
