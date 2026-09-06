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

function setBootstrapConfig() {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.dev",
    instanceId: "d",
    gitCommit: "t",
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
    googleLogin();

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
    await expect(linkGoogle()).resolves.toBe(true);

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock.mock.calls[0][0]).toBe(
      "https://openfront.dev/#modal=account-settings",
    );
    expect(showLinkGate).not.toHaveBeenCalled();
    expect(location.href).toBe(DESKTOP_HREF);
    expect(fetchMock).not.toHaveBeenCalled();
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
      googleLogin();

      expect(showInGameAlert).toHaveBeenCalledTimes(1);
      expect(location.href).toBe(DESKTOP_HREF);
      expect(fetchMock).not.toHaveBeenCalled();
    });
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
    googleLogin();

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
