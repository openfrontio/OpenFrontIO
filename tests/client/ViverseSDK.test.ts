import { MAX_USERNAME_LENGTH } from "@openfront/engine-api/Schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViverseSDK } from "../../src/client/ViverseSDK";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

const WRAPPER = "https://ceen82ugqx.world.viverse.app";

// Frames the page as the VIVERSE wrapper does. `ancestors` stands in for
// location.ancestorOrigins (absent in Firefox, and in jsdom). window.top
// can't be redefined in this pool (vmThreads), so self is moved instead.
function framedBy(referrer: string, ancestors?: string[]): void {
  vi.spyOn(window, "self", "get").mockReturnValue(
    {} as Window & typeof globalThis,
  );
  vi.spyOn(document, "referrer", "get").mockReturnValue(referrer);
  Object.defineProperty(window.location, "ancestorOrigins", {
    value: ancestors,
    configurable: true,
  });
}

// jsdom's window.parent is the window itself; capture what the game posts
// to it instead of delivering it.
function capturePosts() {
  return vi.spyOn(window, "postMessage").mockImplementation(() => {});
}

function reply(
  data: unknown,
  { origin = WRAPPER, source = window as Window | null } = {},
): void {
  window.dispatchEvent(new MessageEvent("message", { data, origin, source }));
}

describe("ViverseSDK", () => {
  let sdk: ViverseSDK;

  beforeEach(() => {
    sdk = new ViverseSDK();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window.location as { ancestorOrigins?: unknown }).ancestorOrigins;
    sessionStorage.clear();
  });

  describe("isOnViverse", () => {
    it("is false when not framed", () => {
      vi.spyOn(document, "referrer", "get").mockReturnValue(`${WRAPPER}/`);
      expect(sdk.isOnViverse()).toBe(false);
    });

    it("is true when the ancestors include VIVERSE", () => {
      framedBy("", [WRAPPER, "https://www.viverse.com"]);
      expect(sdk.isOnViverse()).toBe(true);
    });

    it("is true for a page VIVERSE frames directly", () => {
      framedBy("", ["https://www.viverse.com"]);
      expect(sdk.isOnViverse()).toBe(true);
    });

    it("falls back to the referrer without ancestorOrigins (Firefox)", () => {
      framedBy(`${WRAPPER}/index.html`);
      expect(sdk.isOnViverse()).toBe(true);
    });

    it.each([
      [["https://www.crazygames.com"], "https://www.crazygames.com/"],
      [["https://games.poki.com"], ""],
      [["https://viverse.app.example.net"], ""],
      [undefined, "https://notviverse.app/"],
      [undefined, ""],
    ])("is false framed by an unrelated parent (%s, %s)", (anc, ref) => {
      framedBy(ref, anc);
      expect(sdk.isOnViverse()).toBe(false);
    });

    // The referrer becomes our own URL once the frame navigates.
    it("stays true after an in-frame navigation drops the referrer", () => {
      framedBy(`${WRAPPER}/`);
      expect(sdk.isOnViverse()).toBe(true);
      vi.spyOn(document, "referrer", "get").mockReturnValue(
        "http://localhost/game/abcd1234",
      );
      expect(new ViverseSDK().isOnViverse()).toBe(true);
    });

    it("ignores a remembered detection when not framed", () => {
      framedBy(`${WRAPPER}/`);
      expect(sdk.isOnViverse()).toBe(true);
      vi.restoreAllMocks();
      expect(sdk.isOnViverse()).toBe(false);
    });
  });

  describe("off VIVERSE", () => {
    it("asks for nothing", async () => {
      const posts = capturePosts();
      expect(await sdk.getUserToken()).toBeNull();
      expect(await sdk.getUserProfile()).toBeNull();
      await sdk.showAuthPrompt();
      expect(posts).not.toHaveBeenCalled();
    });
  });

  describe("on VIVERSE", () => {
    let posts: ReturnType<typeof capturePosts>;

    beforeEach(() => {
      framedBy("", [WRAPPER, "https://www.viverse.com"]);
      posts = capturePosts();
    });

    function lastRequestId(): string {
      const calls = posts.mock.calls as unknown[][];
      const [message, target] = calls[calls.length - 1];
      expect(target).toBe("*");
      expect(message).toMatchObject({ type: "openfront:viverse:get-token" });
      return (message as { id: string }).id;
    }

    it("resolves the token from the reply matching its request id", async () => {
      const first = sdk.getUserToken();
      const firstId = lastRequestId();
      const second = sdk.getUserToken();
      const secondId = lastRequestId();
      expect(secondId).not.toBe(firstId);

      reply({
        type: "openfront:viverse:token",
        id: secondId,
        token: "tok-2",
        accountId: "acc",
      });
      reply({
        type: "openfront:viverse:token",
        id: firstId,
        token: "tok-1",
        accountId: "acc",
      });
      expect(await first).toBe("tok-1");
      expect(await second).toBe("tok-2");
    });

    it("resolves null when the player isn't signed in to VIVERSE", async () => {
      const token = sdk.getUserToken();
      reply({
        type: "openfront:viverse:token",
        id: lastRequestId(),
        token: null,
        accountId: null,
      });
      expect(await token).toBeNull();
    });

    it("ignores replies from another source or origin", async () => {
      const token = sdk.getUserToken();
      const id = lastRequestId();
      const data = { type: "openfront:viverse:token", id, token: "stolen" };
      reply(data, { source: null });
      reply(data, { origin: "https://evil.example" });
      reply(data, { origin: "https://www.viverse.com" });
      reply(data, { origin: "https://viverse.app.evil.example" });
      reply({ ...data, type: "something-else" });
      reply({ ...data, id: "other" });

      reply({ ...data, token: "real" });
      expect(await token).toBe("real");
    });

    it("resolves null when the wrapper doesn't answer within 15s", async () => {
      vi.useFakeTimers();
      const token = sdk.getUserToken();
      await vi.advanceTimersByTimeAsync(14_999);
      let settled = false;
      void token.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await token).toBeNull();
    });

    it("reuses the last token request for the profile", async () => {
      const token = sdk.getUserToken();
      reply({
        type: "openfront:viverse:token",
        id: lastRequestId(),
        token: "tok",
        accountId: "acc",
        username: " Evan ",
        avatarUrl: "https://cdn.viverse.example/head.png",
      });
      await token;
      expect(await sdk.getUserProfile()).toEqual({
        username: "Evan",
        profilePictureUrl: "https://cdn.viverse.example/head.png",
      });
      expect(await sdk.getUsername()).toBe("Evan");
      expect(posts).toHaveBeenCalledTimes(1);
    });

    it("caps a long VIVERSE name", async () => {
      const profile = sdk.getUserProfile();
      reply({
        type: "openfront:viverse:token",
        id: lastRequestId(),
        token: "tok",
        username: "x".repeat(MAX_USERNAME_LENGTH + 50),
      });
      expect((await profile)?.username).toBe("x".repeat(MAX_USERNAME_LENGTH));
    });

    it("shows the VIVERSE account when the wrapper has no name", async () => {
      const profile = sdk.getUserProfile();
      reply({
        type: "openfront:viverse:token",
        id: lastRequestId(),
        token: "tok",
        accountId: "acc",
        username: "",
        avatarUrl: null,
      });
      expect(await profile).toEqual({
        username: "account_modal.viverse_account",
        profilePictureUrl: null,
      });
      expect(await sdk.getUsername()).toBeNull();
    });

    it.each([
      "javascript:alert(1)",
      "http://cdn.viverse.example/head.png",
      "data:text/html,<script>alert(1)</script>",
      42,
    ])("drops an unsafe avatar URL (%s)", async (avatarUrl) => {
      const profile = sdk.getUserProfile();
      reply({
        type: "openfront:viverse:token",
        id: lastRequestId(),
        token: "tok",
        username: "Evan",
        avatarUrl,
      });
      expect((await profile)?.profilePictureUrl).toBeNull();
    });

    it("keeps a data: image avatar", async () => {
      const profile = sdk.getUserProfile();
      reply({
        type: "openfront:viverse:token",
        id: lastRequestId(),
        token: "tok",
        username: "Evan",
        avatarUrl: "data:image/png;base64,AAAA",
      });
      expect((await profile)?.profilePictureUrl).toBe(
        "data:image/png;base64,AAAA",
      );
    });

    it("has no profile when signed out", async () => {
      const profile = sdk.getUserProfile();
      reply({
        type: "openfront:viverse:token",
        id: lastRequestId(),
        token: null,
        accountId: null,
      });
      expect(await profile).toBeNull();
    });

    it("asks the wrapper to log in", async () => {
      await sdk.showAuthPrompt();
      expect(posts).toHaveBeenCalledWith(
        { type: "openfront:viverse:login" },
        "*",
      );
    });
  });
});
