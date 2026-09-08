import { UnsecuredJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkSteam, logOut, steamLogin } from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => undefined),
}));

// "Sign in through Steam" and web-initiated Steam linking (OPE-115).
//
// Both are web-only surfaces: inside the desktop shell the player already
// holds the Steam identity through the native ticket, so the caller hides
// them rather than routing them anywhere. What matters here is that each one
// builds the right authenticated request against the right route.

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

// jsdom's location is not assignable, and observing what href gets set to is
// the whole point — so replace the object, as the sibling auth tests do.
const realLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
)!;
const WEB_HREF = "https://openfront.dev/#modal=account";

function stubLocation(href: string): { href: string } {
  const stub = { href, hash: new URL(href).hash };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: stub,
  });
  return stub;
}

let location: { href: string };

beforeEach(async () => {
  setBootstrapConfig();
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  await logOut();
  vi.restoreAllMocks();
  location = stubLocation(WEB_HREF);
});

afterEach(() => {
  Object.defineProperty(window, "location", realLocationDescriptor);
  delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
});

describe("steamLogin", () => {
  it("navigates to the API's Steam login with the page as redirect_uri", () => {
    steamLogin();

    expect(location.href).toBe(
      `https://api.openfront.dev/auth/login/steam?redirect_uri=${encodeURIComponent(WEB_HREF)}`,
    );
  });

  // Unlike discordLogin/googleLogin this must NOT consult the shell's link
  // gate. It is hidden on the desktop rather than redirected, so a gate call
  // here would be a bug that only shows up inside the shell.
  it("never opens the desktop link gate", () => {
    const showLinkGate = vi.fn(async () => undefined);
    (window as unknown as { openfrontDesktop: unknown }).openfrontDesktop = {
      showLinkGate,
    };

    steamLogin();

    expect(showLinkGate).not.toHaveBeenCalled();
  });
});

describe("linkSteam", () => {
  it("fetches the authorize URL with the Bearer token and navigates to it", async () => {
    const jwt = sessionJwt();
    const authorizeUrl =
      "https://steamcommunity.com/openid/login?openid.mode=checkid_setup";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.endsWith("/auth/refresh")) {
          return new Response(JSON.stringify({ jwt, expiresIn: 900 }), {
            status: 200,
          });
        }
        if (url.startsWith("https://api.openfront.dev/auth/link/steam")) {
          // A top-level navigation cannot carry this, which is why the route
          // returns JSON rather than a 302.
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            `Bearer ${jwt}`,
          );
          return new Response(JSON.stringify({ url: authorizeUrl }), {
            status: 200,
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      });

    await expect(linkSteam()).resolves.toBe(true);

    const linkCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/auth/link/steam"),
    );
    expect(linkCall).toBeDefined();
    expect(String(linkCall![0])).toBe(
      `https://api.openfront.dev/auth/link/steam?redirect_uri=${encodeURIComponent(WEB_HREF)}`,
    );
    expect(location.href).toBe(authorizeUrl);
  });

  it("returns false without navigating when logged out", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));

    await expect(linkSteam()).resolves.toBe(false);

    expect(location.href).toBe(WEB_HREF);
  });

  it("returns false without navigating when the API refuses", async () => {
    const jwt = sessionJwt();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        return new Response(JSON.stringify({ jwt, expiresIn: 900 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ reason: "Invalid redirect_uri" }), {
        status: 400,
      });
    });

    await expect(linkSteam()).resolves.toBe(false);

    expect(location.href).toBe(WEB_HREF);
  });
});
