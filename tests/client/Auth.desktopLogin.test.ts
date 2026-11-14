import { UnsecuredJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discordLogin,
  googleLogin,
  linkGoogle,
  logOut,
} from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { showInGameAlert } from "../../src/client/InGameModal";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => undefined),
}));

// The three provider call sites in Auth.ts, in both directions (OPE-343).
//
// On the desktop shell `window.location.href` is `app://openfront/...`, so
// the OAuth redirect_uri the web path builds is one the API's allowlist
// refuses -- the player got a browser tab showing a bare JSON 400. There the
// call sites must go through the shell's browser link flow (the bridge's
// showLinkGate) or the website, and must never navigate to
// `/auth/login/*?redirect_uri=app://...`. On the web nothing changes, and
// that half is pinned here too so the desktop branch cannot leak.

// serverHost is what the desktop shell injects (absent on the web): the game
// server AND website host, which is the bare audience only in production and
// a branch subdomain on dev/staging -- see resolveServerOrigin in ClientEnv.ts.
function setBootstrapConfig(
  overrides: { jwtAudience?: string; serverHost?: string } = {},
) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.dev",
    instanceId: "d",
    gitCommit: "t",
    ...overrides,
  };
  ClientEnv.reset();
}

function sessionJwt(): string {
  return new UnsecuredJWT({
    jti: "some-id",
    sub: "AAAAAAAAAAAAAAAAAAAAAA",
    iat: Math.floor(Date.now() / 1000),
    iss: "https://api.openfront.dev",
    aud: "openfront.dev",
    exp: Math.floor(Date.now() / 1000) + 3600,
  }).encode();
}

// jsdom's location is not assignable (a cross-document navigation is "not
// implemented"), and the whole point here is to observe what href gets set
// to -- so replace the object, the same way CreatorCodePanel.test.ts and
// UsernameBareClaim.test.ts do.
const realLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
)!;

// What a real desktop launch reports. Only href matters to the code under
// test, but it must be the shell's own origin: that is the value that used to
// leak into redirect_uri.
const DESKTOP_HREF = "app://openfront/index.html#modal=account";
const WEB_HREF = "https://openfront.dev/#modal=account";

function stubLocation(href: string): { href: string } {
  const stub = { href, hash: new URL(href).hash };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: stub,
  });
  return stub;
}

beforeEach(async () => {
  setBootstrapConfig();
  // logOut() POSTs /auth/logout; keep the harness off the network.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  await logOut();
  vi.restoreAllMocks();
  // restoreAllMocks restores spies; it does not clear a module-mock vi.fn.
  vi.mocked(showInGameAlert).mockClear();
});

afterEach(() => {
  Object.defineProperty(window, "location", realLocationDescriptor);
  delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
});

describe("provider login on the desktop shell", () => {
  let showLinkGate: ReturnType<typeof vi.fn>;
  let location: { href: string };
  let fetchMock: ReturnType<typeof vi.spyOn>;
  let openMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    showLinkGate = vi.fn(async () => undefined);
    (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
      steam: {},
      showLinkGate,
    };
    location = stubLocation(DESKTOP_HREF);
    fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not be called"));
    openMock = vi
      .spyOn(window, "open")
      .mockReturnValue(null as unknown as Window);
  });

  it("discordLogin opens the shell's link flow and never builds an app:// redirect", () => {
    discordLogin();

    expect(showLinkGate).toHaveBeenCalledTimes(1);
    expect(location.href).toBe(DESKTOP_HREF);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("googleLogin opens the shell's link flow and never builds an app:// redirect", () => {
    void googleLogin();

    expect(showLinkGate).toHaveBeenCalledTimes(1);
    expect(location.href).toBe(DESKTOP_HREF);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The link flow cannot attach Google to an account that already holds this
  // Steam identity (redeeming the ticket there is an idempotent no-op), and
  // that is the only account the button is ever shown to. So this one goes
  // to the website's account settings instead, where the real OAuth flow
  // runs -- and, crucially, never to /auth/link/google with an app:// URL.
  it("linkGoogle opens the website's account settings in the browser", async () => {
    setBootstrapConfig({
      serverHost: "openfront.io",
      jwtAudience: "openfront.io",
    });

    await expect(linkGoogle()).resolves.toBe(true);

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock.mock.calls[0][0]).toBe(
      "https://openfront.io/#modal=account-settings",
    );
    expect(showLinkGate).not.toHaveBeenCalled();
    expect(location.href).toBe(DESKTOP_HREF);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The website host is the injected serverHost, not the JWT audience: on a
  // dev/staging build the audience is the apex (openfront.dev), where nothing
  // is deployed, and the site lives on a branch subdomain.
  it("linkGoogle targets the injected branch host, not the audience apex", async () => {
    setBootstrapConfig({ serverHost: "my-feature.openfront.dev" });

    await expect(linkGoogle()).resolves.toBe(true);

    expect(openMock.mock.calls[0][0]).toBe(
      "https://my-feature.openfront.dev/#modal=account-settings",
    );
  });

  // The API's server list (multi-server v2) picks a GAME server, and once
  // it is applied serverHttpBase() answers with that deployment host --
  // falk2-b.openfront.io, which serves no website. The account-settings
  // link reads the site the shell was launched against, not the game
  // server, so it must be unmoved by the list.
  it("linkGoogle still targets the website after a server list is applied", async () => {
    setBootstrapConfig({
      serverHost: "openfront.io",
      jwtAudience: "openfront.io",
    });
    ClientEnv.applyServerList(
      {
        latest: "bfd5563a",
        servers: {
          d: {
            host: "falk2-b.openfront.io",
            numWorkers: 16,
            version: "bfd5563a",
            state: "open" as const,
          },
        },
      },
      "d",
    );
    expect(ClientEnv.serverHttpBase()).toBe("https://falk2-b.openfront.io");

    await expect(linkGoogle()).resolves.toBe(true);

    expect(openMock.mock.calls[0][0]).toBe(
      "https://openfront.io/#modal=account-settings",
    );
  });

  // A shell that injects no serverHost falls back to the audience-derived
  // origin, keeping the shell's own localhost:9000 dev case.
  it("linkGoogle falls back to the audience origin without a serverHost", async () => {
    setBootstrapConfig({ jwtAudience: "localhost" });

    await expect(linkGoogle()).resolves.toBe(true);

    expect(openMock.mock.calls[0][0]).toBe(
      "http://localhost:9000/#modal=account-settings",
    );
  });

  // The failure mode this exists to log is an IPC rejection; it must not
  // become an unhandled rejection out of a click handler.
  it("discordLogin survives the bridge rejecting", async () => {
    showLinkGate.mockRejectedValue(new Error("no window"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => discordLogin()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalled();
    expect(location.href).toBe(DESKTOP_HREF);
  });

  // A shell too old to expose the bridge is not "the web": the redirect
  // cannot work there either, and this client updates at runtime while the
  // shell updates on Steam's schedule, so a newer client on an older shell
  // is an ordinary deployment. It must get an update prompt, never the
  // app:// redirect that was the original bug.
  describe("on a shell without showLinkGate", () => {
    beforeEach(() => {
      (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
        steam: {},
        linkGate: {},
      };
    });

    it("discordLogin shows the update prompt and never navigates", () => {
      discordLogin();

      expect(showInGameAlert).toHaveBeenCalledTimes(1);
      expect(vi.mocked(showInGameAlert).mock.calls[0][0]).toContain(
        "desktop_login_needs_update",
      );
      expect(location.href).toBe(DESKTOP_HREF);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("googleLogin shows the update prompt and never navigates", () => {
      void googleLogin();

      expect(showInGameAlert).toHaveBeenCalledTimes(1);
      expect(location.href).toBe(DESKTOP_HREF);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

// The Android shell serves the game at the site's own origin, so the web
// redirect works there for Discord; its bridge has no Steam and no link gate.
// Google refuses its redirect inside a WebView, though, so a shell too old to
// have the native Google sheet (this one) is told to update instead.
describe("provider login on a shell without Steam (Android)", () => {
  let location: { href: string };

  beforeEach(() => {
    (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
      shell: { version: "1.0.0", api: 7, platform: "android" },
      update: {},
    };
    location = stubLocation(WEB_HREF);
  });

  it("discordLogin navigates to the API's Discord login, with no update prompt", () => {
    discordLogin();

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(location.href).toBe(
      `https://api.openfront.dev/auth/login/discord?redirect_uri=${encodeURIComponent(WEB_HREF)}`,
    );
  });

  it("googleLogin without the native sheet shows the update prompt and never navigates", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not be called"));

    await googleLogin();

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showInGameAlert).mock.calls[0][0]).toContain(
      "google_sign_in_needs_update",
    );
    expect(location.href).toBe(WEB_HREF);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("linkGoogle without the native sheet shows the update prompt and never navigates", async () => {
    const jwt = sessionJwt();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith("/auth/refresh")) {
          return new Response(JSON.stringify({ jwt, expiresIn: 900 }), {
            status: 200,
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      });

    await expect(linkGoogle()).resolves.toBe(true);

    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showInGameAlert).mock.calls[0][0]).toContain(
      "google_sign_in_needs_update",
    );
    expect(location.href).toBe(WEB_HREF);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/auth/link/google"),
      ),
    ).toBe(false);
  });
});

describe("provider login on the web", () => {
  let location: { href: string };

  beforeEach(() => {
    location = stubLocation(WEB_HREF);
  });

  it("discordLogin navigates to the API's Discord login with the page as redirect_uri", () => {
    discordLogin();

    expect(location.href).toBe(
      `https://api.openfront.dev/auth/login/discord?redirect_uri=${encodeURIComponent(WEB_HREF)}`,
    );
  });

  it("googleLogin navigates to the API's Google login with the page as redirect_uri", () => {
    void googleLogin();

    expect(location.href).toBe(
      `https://api.openfront.dev/auth/login/google?redirect_uri=${encodeURIComponent(WEB_HREF)}`,
    );
  });

  it("linkGoogle fetches the authorize URL with the Bearer token and navigates to it", async () => {
    const jwt = sessionJwt();
    const authorizeUrl = "https://accounts.google.com/o/oauth2/auth?state=x";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/auth/refresh")) {
          return new Response(JSON.stringify({ jwt, expiresIn: 900 }), {
            status: 200,
          });
        }
        if (url.startsWith("https://api.openfront.dev/auth/link/google")) {
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            `Bearer ${jwt}`,
          );
          return new Response(JSON.stringify({ url: authorizeUrl }), {
            status: 200,
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      });
    const openMock = vi
      .spyOn(window, "open")
      .mockReturnValue(null as unknown as Window);

    await expect(linkGoogle()).resolves.toBe(true);

    const linkCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/auth/link/google"),
    );
    expect(linkCall).toBeDefined();
    expect(String(linkCall![0])).toBe(
      `https://api.openfront.dev/auth/link/google?redirect_uri=${encodeURIComponent(WEB_HREF)}`,
    );
    expect(location.href).toBe(authorizeUrl);
    expect(openMock).not.toHaveBeenCalled();
  });

  it("linkGoogle returns false without navigating when logged out", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(linkGoogle()).resolves.toBe(false);

    expect(location.href).toBe(WEB_HREF);
  });
});

// Google in the Android app on a shell that has the native sheet
// (window.openfrontDesktop.google.signIn). Both buttons take an ID token from
// it and post that to the API instead of the redirect Google refuses inside a
// WebView.
describe("Google with the Android shell's native sheet", () => {
  const API = "https://api.openfront.dev";
  let location: {
    href: string;
    hash: string;
    reload: ReturnType<typeof vi.fn>;
  };
  let signIn: ReturnType<typeof vi.fn>;

  function alertKey(): string {
    expect(showInGameAlert).toHaveBeenCalledTimes(1);
    return vi.mocked(showInGameAlert).mock.calls[0][0];
  }

  // Answers /auth/refresh with a session (linking needs one) and `endpoint`
  // with `response`; anything else fails the test.
  function mockApi(endpoint: string, response: () => Response) {
    const jwt = sessionJwt();
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === `${API}/auth/refresh`) {
        return new Response(JSON.stringify({ jwt, expiresIn: 900 }), {
          status: 200,
        });
      }
      if (url === `${API}${endpoint}`) return response();
      throw new Error(`unexpected fetch ${url}`);
    });
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status });
  }

  beforeEach(() => {
    // stubLocation's, plus the reload both successes end in.
    location = { href: WEB_HREF, hash: "#modal=account", reload: vi.fn() };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: location,
    });
    signIn = vi.fn();
    (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
      shell: { version: "1.0.0", api: 7, platform: "android" },
      update: {},
      google: { signIn },
    };
  });

  describe("googleLogin", () => {
    it("posts the sheet's ID token to /auth/google and reloads into the session", async () => {
      signIn.mockResolvedValue({ status: "ok", idToken: "id-token" });
      const fetchMock = mockApi("/auth/google", () =>
        json(200, { jwt: sessionJwt(), expiresIn: 900 }),
      );

      await googleLogin();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API}/auth/google`);
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ idToken: "id-token" });
      // The refresh cookie it sets is what the reloaded page signs in with.
      expect(init?.credentials).toBe("include");
      expect(location.reload).toHaveBeenCalledTimes(1);
      expect(location.href).toBe(WEB_HREF);
      expect(showInGameAlert).not.toHaveBeenCalled();
    });

    it("says nothing when the player dismisses the sheet", async () => {
      signIn.mockResolvedValue({ status: "cancelled" });
      const fetchMock = vi.spyOn(globalThis, "fetch");

      await googleLogin();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(showInGameAlert).not.toHaveBeenCalled();
      expect(location.reload).not.toHaveBeenCalled();
    });

    it.each([
      ["no_account", "google_sign_in_no_account"],
      ["unavailable", "google_sign_in_unavailable"],
      ["failed", "google_sign_in_failed"],
    ])("explains the sheet's %s error", async (code, key) => {
      signIn.mockResolvedValue({ status: "error", code });
      const fetchMock = vi.spyOn(globalThis, "fetch");

      await googleLogin();

      expect(alertKey()).toContain(key);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(location.reload).not.toHaveBeenCalled();
    });

    it("tells the player to sign in their usual way and link Google on email_exists", async () => {
      signIn.mockResolvedValue({ status: "ok", idToken: "id-token" });
      mockApi("/auth/google", () => json(409, { reason: "email_exists" }));
      vi.spyOn(console, "error").mockImplementation(() => {});

      await googleLogin();

      expect(alertKey()).toContain("login_email_exists");
      expect(location.reload).not.toHaveBeenCalled();
    });

    it.each([
      ["a 400", () => json(400, { error: "Bad Request" })],
      ["a 401", () => json(401, { error: "Unauthorized" })],
      ["a 500", () => json(500, { error: "Internal" })],
      ["a 409 with another reason", () => json(409, { reason: "other" })],
    ])("shows the generic failure for %s", async (_label, response) => {
      signIn.mockResolvedValue({ status: "ok", idToken: "id-token" });
      mockApi("/auth/google", response);
      vi.spyOn(console, "error").mockImplementation(() => {});

      await googleLogin();

      expect(alertKey()).toContain("google_sign_in_failed");
      expect(location.reload).not.toHaveBeenCalled();
    });

    it("shows the generic failure when the request never completes", async () => {
      signIn.mockResolvedValue({ status: "ok", idToken: "id-token" });
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
      vi.spyOn(console, "warn").mockImplementation(() => {});

      await googleLogin();

      expect(alertKey()).toContain("google_sign_in_failed");
      expect(location.reload).not.toHaveBeenCalled();
    });
  });

  describe("linkGoogle", () => {
    it("posts the sheet's ID token with the session and returns through link=google", async () => {
      signIn.mockResolvedValue({ status: "ok", idToken: "id-token" });
      const fetchMock = mockApi("/auth/google/link", () =>
        json(200, { linked: true }),
      );
      const replaceState = vi
        .spyOn(history, "replaceState")
        .mockImplementation(() => {});

      await expect(linkGoogle()).resolves.toBe(true);

      const linkCall = fetchMock.mock.calls.find(
        ([input]) => String(input) === `${API}/auth/google/link`,
      );
      expect(linkCall).toBeDefined();
      const init = linkCall![1];
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Authorization")).toMatch(
        /^Bearer /,
      );
      expect(JSON.parse(String(init?.body))).toEqual({ idToken: "id-token" });
      // The same `link=google` the web flow's callback returns with, which
      // consumeLinkResult announces once the page is back.
      expect(replaceState).toHaveBeenCalledWith(
        null,
        "",
        "#modal=account&link=google",
      );
      expect(location.reload).toHaveBeenCalledTimes(1);
      expect(location.href).toBe(WEB_HREF);
      expect(showInGameAlert).not.toHaveBeenCalled();
    });

    it("says the Google account belongs to another player on already_linked", async () => {
      signIn.mockResolvedValue({ status: "ok", idToken: "id-token" });
      mockApi("/auth/google/link", () =>
        json(409, { reason: "already_linked" }),
      );
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(linkGoogle()).resolves.toBe(true);

      expect(alertKey()).toContain("link_google_already_linked");
      expect(location.reload).not.toHaveBeenCalled();
    });

    it("shows the generic link failure for any other refusal", async () => {
      signIn.mockResolvedValue({ status: "ok", idToken: "id-token" });
      mockApi("/auth/google/link", () => json(401, { error: "Unauthorized" }));
      vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(linkGoogle()).resolves.toBe(true);

      expect(alertKey()).toContain("link_google_error");
      expect(location.reload).not.toHaveBeenCalled();
    });

    it("says nothing when the player dismisses the sheet", async () => {
      signIn.mockResolvedValue({ status: "cancelled" });
      const fetchMock = mockApi("/auth/google/link", () =>
        json(200, { linked: true }),
      );

      await expect(linkGoogle()).resolves.toBe(true);

      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("/auth/google/link"),
        ),
      ).toBe(false);
      expect(showInGameAlert).not.toHaveBeenCalled();
    });

    // The caller answers false with "couldn't start Google linking"; the
    // sheet must not open for a player with no account to link it to.
    it("returns false without opening the sheet when logged out", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

      await expect(linkGoogle()).resolves.toBe(false);

      expect(signIn).not.toHaveBeenCalled();
    });
  });
});
