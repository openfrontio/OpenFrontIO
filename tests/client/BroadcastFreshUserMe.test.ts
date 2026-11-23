import type { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const profile = (publicId: string) =>
  ({ user: {}, player: { publicId } }) as unknown as UserMeResponse;

describe("broadcastFreshUserMe", () => {
  const heard = vi.fn();
  document.addEventListener("userMeResponse", heard);
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

  it("one started after the change is broadcast", async () => {
    document.dispatchEvent(new CustomEvent("session-reauth"));
    const b = profile("account-b");
    vi.mocked(getUserMe).mockResolvedValueOnce(b);
    await broadcastFreshUserMe();
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
