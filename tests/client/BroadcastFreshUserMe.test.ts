import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserMe } from "../../src/client/Api";
import { broadcastFreshUserMe } from "../../src/client/Cosmetics";

// A fresh /users/@me is broadcast to every surface holding a profile. One
// fetched under a session that has since gone (signed out, or another
// account) is the old account's, and must never reach them.

vi.mock("../../src/client/Api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Api")>()),
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

// The account the session is signed in as (Auth's currentPublicId).
// `sub` is the session's JWT subject (null: no token for now).
const session = vi.hoisted(() => ({
  id: "account-a" as string | null,
  sub: "sub-a" as string | null,
}));
vi.mock("../../src/client/Auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Auth")>()),
  currentPublicId: () => session.id,
  currentSessionSub: () => session.sub,
  isOtherSession: (sub: string) => session.sub !== null && session.sub !== sub,
}));

const profile = (publicId: string) =>
  ({ user: {}, player: { publicId } }) as unknown as UserMeResponse;

describe("broadcastFreshUserMe", () => {
  const heard = vi.fn();
  document.addEventListener("userMeResponse", heard);
  beforeEach(() => {
    session.id = "account-a";
    session.sub = "sub-a";
  });
  afterEach(() => heard.mockClear());

  it("broadcasts the fresh profile", async () => {
    const a = profile("account-a");
    vi.mocked(getUserMe).mockResolvedValueOnce(a);
    expect(await broadcastFreshUserMe()).toBe(a);
    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toBe(a);
  });

  for (const event of ["session-reauth", "session-cleared"]) {
    it(`a profile fetched before ${event} isn't broadcast`, async () => {
      let answer!: (v: UserMeResponse) => void;
      vi.mocked(getUserMe).mockReturnValueOnce(
        new Promise((r) => (answer = r)),
      );
      const fetching = broadcastFreshUserMe();
      document.dispatchEvent(new CustomEvent(event));
      const late = profile("account-a");
      answer(late);
      // The caller still gets what it fetched (its own purchase's result).
      expect(await fetching).toBe(late);
      expect(heard).not.toHaveBeenCalled();
    });
  }

  it("a profile fetched before a silent refresh into another account isn't broadcast", async () => {
    // No session event: an ordinary token refresh picked up another tab's
    // sign-in while A's profile was being read.
    let answer!: (v: UserMeResponse) => void;
    vi.mocked(getUserMe).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const fetching = broadcastFreshUserMe();
    session.id = "account-b";
    const late = profile("account-a");
    answer(late);
    expect(await fetching).toBe(late);
    expect(heard).not.toHaveBeenCalled();
  });

  it("a profile fetched before a refresh into an account whose id isn't known yet isn't broadcast", async () => {
    // B's publicId isn't stored yet (currentPublicId() is null): only the
    // session's subject says it's another account.
    let answer!: (v: UserMeResponse) => void;
    vi.mocked(getUserMe).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const fetching = broadcastFreshUserMe();
    session.id = null;
    session.sub = "sub-b";
    const late = profile("account-a");
    answer(late);
    expect(await fetching).toBe(late);
    expect(heard).not.toHaveBeenCalled();
  });

  it("a brief refresh outage still broadcasts this account's profile", async () => {
    let answer!: (v: UserMeResponse) => void;
    vi.mocked(getUserMe).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const fetching = broadcastFreshUserMe();
    session.id = null;
    session.sub = null;
    answer(profile("account-a"));
    await fetching;
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("one started after the change is broadcast", async () => {
    session.id = "account-b";
    document.dispatchEvent(new CustomEvent("session-reauth"));
    const b = profile("account-b");
    vi.mocked(getUserMe).mockResolvedValueOnce(b);
    await broadcastFreshUserMe();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
