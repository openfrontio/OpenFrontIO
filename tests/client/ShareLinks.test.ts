import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyToClipboardMock = vi.hoisted(() =>
  vi.fn(async (_text: string) => {}),
);

vi.mock("../../src/client/Utils", () => ({
  copyToClipboard: copyToClipboardMock,
  showToast: vi.fn(),
  translateText: vi.fn((key: string) => key),
  generateCryptoRandomUUID: vi.fn(() => "uuid"),
}));

vi.mock("../../src/client/InGameModal", () => ({
  showInGameAlert: vi.fn(async () => undefined),
}));

import { sendMagicLink } from "../../src/client/Auth";
import { ClientEnv } from "../../src/client/ClientEnv";
import "../../src/client/components/CopyButton";
import type { CopyButton } from "../../src/client/components/CopyButton";

// Every link that LEAVES the client, checked from the desktop shell — the one
// place where the document's own origin (`app://openfront`) is not something
// anyone else can open. Each of these strings is copied to a clipboard or
// handed to a server that will send it on to a human.
//
// The pure resolution rules live in ShareBase.test.ts; this file pins the call
// sites to them, because the bug was never in the rule — it was in a call site
// reaching for window.location instead.

const realLocationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "location",
)!;

// What a real desktop launch reports: the shell serves the renderer from its
// own privileged scheme (openfront-desktop's protocol.ts).
const DESKTOP_HREF = "app://openfront/index.html";
const WEB_HREF = "https://openfront.io/";

function stubLocation(href: string) {
  const url = new URL(href);
  // Chromium registers app:// as a standard scheme (the shell's protocol.ts),
  // so the real renderer reports origin "app://openfront". jsdom's URL parser
  // has no such registration and yields "null" — spell the real value out, so
  // what leaks on a regression is what would leak in the shipped app.
  const origin =
    url.protocol === "app:" ? `${url.protocol}//${url.hostname}` : url.origin;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href,
      origin,
      protocol: url.protocol,
      pathname: url.pathname,
      hash: url.hash,
      search: url.search,
      host: url.host,
      hostname: url.hostname,
    },
  });
}

// serverHost is what the desktop shell injects and the web build never does.
function setBootstrapConfig(
  overrides: { jwtAudience?: string; serverHost?: string } = {},
) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv: "prod",
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience: "openfront.io",
    instanceId: "d",
    gitCommit: "t",
    ...overrides,
  };
  ClientEnv.reset();
}

beforeEach(() => {
  setBootstrapConfig({ serverHost: "openfront.io" });
  copyToClipboardMock.mockClear();
});

afterEach(() => {
  Object.defineProperty(window, "location", realLocationDescriptor);
  delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
  vi.restoreAllMocks();
});

describe("ClientEnv share helpers under a real desktop location", () => {
  it("resolves the injected website host, not app://openfront", () => {
    stubLocation(DESKTOP_HREF);
    expect(ClientEnv.shareOrigin()).toBe("https://openfront.io");
    expect(ClientEnv.shareBase()).toBe("https://openfront.io/");
  });

  it("leaves the web build on its own document", () => {
    stubLocation("https://openfront.io/c/abc");
    expect(ClientEnv.shareOrigin()).toBe("https://openfront.io");
    expect(ClientEnv.shareBase()).toBe("https://openfront.io/c/abc");
  });
});

describe("the lobby invite link (copy-button)", () => {
  async function copiedLobbyLink(href: string): Promise<string> {
    stubLocation(href);
    const el = document.createElement("copy-button") as CopyButton;
    el.lobbyId = "aBcDeFgHiJ";
    el.includeLobbyQuery = true;
    el.lobbySuffix = "xyz12";
    document.body.appendChild(el);
    try {
      await el.handleCopy();
      expect(copyToClipboardMock).toHaveBeenCalledTimes(1);
      return copyToClipboardMock.mock.calls[0][0];
    } finally {
      el.remove();
    }
  }

  it("is a link the recipient can actually open from the desktop shell", async () => {
    const link = await copiedLobbyLink(DESKTOP_HREF);
    expect(link).toBe(
      `https://openfront.io${ClientEnv.gamePath("aBcDeFgHiJ")}?lobby&s=xyz12`,
    );
    expect(link).not.toContain("app:");
  });

  it("is unchanged on the web", async () => {
    const link = await copiedLobbyLink(WEB_HREF);
    expect(link).toBe(
      `https://openfront.io${ClientEnv.gamePath("aBcDeFgHiJ")}?lobby&s=xyz12`,
    );
  });
});

describe("the magic-link email's return domain", () => {
  async function redirectDomainFor(href: string): Promise<string> {
    stubLocation(href);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    expect(await sendMagicLink("player@example.com")).toBe(true);
    const init = fetchMock.mock.calls[0][1]!;
    return JSON.parse(init.body as string).redirectDomain;
  }

  it("names the website, not the shell, so the emailed link opens", async () => {
    // The player reads this email in a browser, possibly on another device:
    // app://openfront would be a link nothing on earth can follow.
    expect(await redirectDomainFor(DESKTOP_HREF)).toBe("https://openfront.io");
  });

  it("is unchanged on the web", async () => {
    stubLocation(WEB_HREF);
    expect(await redirectDomainFor("https://openfront.dev/")).toBe(
      "https://openfront.dev",
    );
  });
});
