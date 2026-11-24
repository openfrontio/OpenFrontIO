import { UnsecuredJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appleLogin,
  appleServicesId,
  linkApple,
} from "../../src/client/AppleSignIn";
import { getAuthHeader } from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import { showInGameAlert } from "../../src/client/InGameModal";

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => true),
}));

vi.mock("../../src/client/Auth", () => ({
  getAuthHeader: vi.fn(async () => "Bearer session"),
}));

function setBootstrapConfig(jwtAudience = "openfront.dev") {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "staging",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience,
    instanceId: "d",
    gitCommit: "t",
  };
  ClientEnv.reset();
}

const realLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
)!;

function stubLocation(href: string) {
  const url = new URL(href);
  const stub = {
    href,
    origin: url.origin,
    hostname: url.hostname,
    hash: url.hash,
    pathname: url.pathname,
    search: url.search,
    reload: vi.fn(),
  };
  Object.defineProperty(window, "location", {
    configurable: true,
    value: stub,
  });
  return stub;
}

function idToken(claims: Record<string, unknown>): string {
  return new UnsecuredJWT({ sub: "apple-sub", ...claims }).encode();
}

// Stands in for Apple's library, already on the page, so no script loads.
function stubAppleId(signIn: () => Promise<unknown>) {
  const init = vi.fn();
  (window as any).AppleID = { auth: { init, signIn: vi.fn(signIn) } };
  return init;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let location: ReturnType<typeof stubLocation>;
let fetchMock: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  setBootstrapConfig();
  location = stubLocation("https://openfront.dev/#modal=account");
  fetchMock = vi.spyOn(globalThis, "fetch");
  vi.mocked(showInGameAlert).mockClear();
  vi.mocked(getAuthHeader).mockResolvedValue("Bearer session");
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, "location", realLocationDescriptor);
  delete (window as any).AppleID;
  delete (window as { openfrontDesktop?: unknown }).openfrontDesktop;
});

describe("appleServicesId", () => {
  it("is the staging Services ID on the staging site", () => {
    expect(appleServicesId()).toBe("io.openfront.web.staging");
  });

  it("is the prod Services ID on the prod site", () => {
    setBootstrapConfig("openfront.io");
    stubLocation("https://openfront.io/");
    expect(appleServicesId()).toBe("io.openfront.web");
  });

  it("is null where no Services ID is configured", () => {
    setBootstrapConfig("localhost");
    stubLocation("https://localhost/");
    expect(appleServicesId()).toBeNull();
  });

  // Apple answers the popup only at the registered return URL's origin.
  it("is null on a branch preview", () => {
    stubLocation("https://my-feature.openfront.dev/");
    expect(appleServicesId()).toBeNull();
  });

  it("is null when the page and the audience disagree", () => {
    setBootstrapConfig("openfront.io");
    expect(appleServicesId()).toBeNull();
  });

  it("is null in a desktop or Android shell", () => {
    (window as any).openfrontDesktop = {};
    expect(appleServicesId()).toBeNull();
  });
});

describe("appleLogin", () => {
  it("sends only the code to /auth/apple and reloads signed in", async () => {
    const init = stubAppleId(async () => ({
      authorization: { code: "the-code", id_token: idToken({}) },
    }));
    fetchMock.mockResolvedValue(jsonResponse(200, { jwt: "j", expiresIn: 1 }));

    await appleLogin();

    expect(init).toHaveBeenCalledWith({
      clientId: "io.openfront.web.staging",
      scope: "email",
      redirectURI: "https://openfront.dev/",
      usePopup: true,
    });
    const [url, req] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/apple$/);
    expect(JSON.parse(String(req?.body))).toEqual({
      code: "the-code",
      client: "web",
    });
    expect(req?.credentials).toBe("include");
    expect(location.reload).toHaveBeenCalledTimes(1);
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  it("tells a first-time hidden-email player they got a new account", async () => {
    stubAppleId(async () => ({
      authorization: {
        code: "c",
        id_token: idToken({ is_private_email: "true" }),
      },
      user: { email: "x@privaterelay.appleid.com" },
    }));
    fetchMock.mockResolvedValue(jsonResponse(200, { jwt: "j", expiresIn: 1 }));

    await appleLogin();

    expect(showInGameAlert).toHaveBeenCalledWith(
      "account_modal.apple_hidden_email_new_account",
    );
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("says nothing extra to a returning hidden-email player", async () => {
    stubAppleId(async () => ({
      authorization: {
        code: "c",
        id_token: idToken({ is_private_email: true }),
      },
    }));
    fetchMock.mockResolvedValue(jsonResponse(200, { jwt: "j", expiresIn: 1 }));

    await appleLogin();

    expect(showInGameAlert).not.toHaveBeenCalled();
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("points an existing email's owner at linking", async () => {
    stubAppleId(async () => ({
      authorization: { code: "c", id_token: idToken({}) },
    }));
    fetchMock.mockResolvedValue(jsonResponse(409, { reason: "email_exists" }));

    await appleLogin();

    expect(showInGameAlert).toHaveBeenCalledWith(
      "account_modal.login_email_exists",
    );
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("does nothing when the player closes the popup", async () => {
    stubAppleId(async () => {
      throw { error: "popup_closed_by_user" };
    });

    await appleLogin();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(showInGameAlert).not.toHaveBeenCalled();
  });

  it("reports a popup failure", async () => {
    stubAppleId(async () => {
      throw { error: "invalid_request" };
    });

    await appleLogin();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(showInGameAlert).toHaveBeenCalledWith(
      "account_modal.apple_sign_in_failed",
    );
  });

  it("does not run where the button is hidden", async () => {
    stubLocation("https://my-feature.openfront.dev/");
    const init = stubAppleId(async () => ({}));

    await appleLogin();

    expect(init).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("linkApple", () => {
  it("links with the session and reloads with link=apple", async () => {
    stubAppleId(async () => ({
      authorization: { code: "link-code", id_token: idToken({}) },
    }));
    fetchMock.mockResolvedValue(jsonResponse(200, { linked: true }));
    const replaceState = vi.spyOn(history, "replaceState");

    await expect(linkApple()).resolves.toBe(true);

    const [url, req] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/auth\/apple\/link$/);
    expect((req!.headers as Record<string, string>).Authorization).toBe(
      "Bearer session",
    );
    expect(JSON.parse(String(req?.body))).toEqual({
      code: "link-code",
      client: "web",
    });
    expect(replaceState.mock.calls[0][2]).toBe("#modal=account&link=apple");
    expect(location.reload).toHaveBeenCalledTimes(1);
  });

  it("reports an Apple account that belongs to another player", async () => {
    stubAppleId(async () => ({
      authorization: { code: "c", id_token: idToken({}) },
    }));
    fetchMock.mockResolvedValue(
      jsonResponse(409, { reason: "already_linked" }),
    );

    await expect(linkApple()).resolves.toBe(true);

    expect(showInGameAlert).toHaveBeenCalledWith(
      "account_modal.link_apple_already_linked",
    );
    expect(location.reload).not.toHaveBeenCalled();
  });

  it("returns false without a session and opens no popup", async () => {
    vi.mocked(getAuthHeader).mockResolvedValue("");
    const init = stubAppleId(async () => ({}));

    await expect(linkApple()).resolves.toBe(false);

    expect(init).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
