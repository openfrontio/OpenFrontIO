import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import { apexPathFor, homeHref, reloadForUpdate } from "../../src/client/Utils";

// A document can sit on a deployment host (cross-host game visit, stale
// bookmark). There, a same-origin reload or a "/" exit re-enters the SAME
// deployment — possibly drained, with an empty lobby list and an outdated
// shell the drain prompt would reload in a loop. Both helpers answer with
// the apex instead, which always fronts the active deployment.
describe("apex-aware navigation", () => {
  const replace = vi.fn<(url: string) => void>();

  function stubPage(host: string, path: string, siteHost?: string) {
    ClientEnv.reset();
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      cluster: {
        c: { host: "blue.openfront.io", color: "blue", numWorkers: 2 },
        d: { host: "green.openfront.io", color: "green", numWorkers: 2 },
      },
      instanceLetter: "d",
      turnstileSiteKey: "k",
      jwtAudience: "openfront.io",
      instanceId: "i",
      gitCommit: "abc",
      ...(siteHost === undefined ? {} : { siteHost }),
    };
    Object.defineProperty(window, "location", {
      value: {
        href: `https://${host}${path}`,
        host,
        search: "",
        replace,
      },
      writable: true,
      configurable: true,
    });
  }

  beforeEach(() => {
    replace.mockClear();
  });

  afterEach(() => {
    ClientEnv.reset();
    delete window.BOOTSTRAP_CONFIG;
  });

  it("homeHref leaves a deployment host for the apex", () => {
    stubPage("green.openfront.io", "/", "openfront.io");
    expect(homeHref()).toBe("https://openfront.io/");
  });

  it("homeHref stays local on the apex and on standalone deployments", () => {
    stubPage("openfront.io", "/", "openfront.io");
    expect(homeHref()).toBe("/");
    stubPage("beta.openfront.io", "/");
    expect(homeHref()).toBe("/");
  });

  it("reloadForUpdate re-enters through the apex, keeping the game path", () => {
    stubPage("green.openfront.io", "/w1/game/dAbCd12345", "openfront.io");
    reloadForUpdate();
    expect(replace).toHaveBeenCalledTimes(1);
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.host).toBe("openfront.io");
    // Worker prefixes are origin-specific; letter routing re-resolves.
    expect(url.pathname).toBe("/game/dAbCd12345");
    expect(url.searchParams.has("v")).toBe(true);
  });

  it("reloadForUpdate stays same-origin on the apex and standalone hosts", () => {
    stubPage("openfront.io", "/", "openfront.io");
    reloadForUpdate();
    stubPage("beta.openfront.io", "/");
    reloadForUpdate();
    for (const call of replace.mock.calls) {
      const url = new URL(call[0]);
      expect(["openfront.io", "beta.openfront.io"]).toContain(url.host);
      expect(url.searchParams.has("v")).toBe(true);
    }
  });

  // Multi-server v2: every version's page is also served at /v/<commit>/,
  // immutably. Reloading such a page as-is re-serves the very bundle the
  // reload is meant to leave behind -- forever, since the version prefix
  // pins it. The update prompt has to ask for the version-free path, which
  // the site answers with `latest`.
  it("reloadForUpdate leaves a /v/<commit>/ page for the version-free path", () => {
    stubPage("openfront.io", "/v/5ccc50a7/game/dAbCd12345", "openfront.io");
    reloadForUpdate();
    expect(replace).toHaveBeenCalledTimes(1);
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.host).toBe("openfront.io");
    expect(url.pathname).toBe("/game/dAbCd12345");
    expect(url.searchParams.has("v")).toBe(true);
  });

  it("reloadForUpdate drops the version prefix on a standalone host too", () => {
    // No siteHost injected: the reload stays on this host, but still must
    // not ask for the pinned version again.
    stubPage("beta.openfront.io", "/v/5ccc50a7/");
    reloadForUpdate();
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.host).toBe("beta.openfront.io");
    expect(url.pathname).toBe("/");
  });

  it("reloadForUpdate drops both prefixes when re-entering through the apex", () => {
    stubPage(
      "green.openfront.io",
      "/v/5ccc50a7/w1/game/dAbCd12345",
      "openfront.io",
    );
    reloadForUpdate();
    const url = new URL(replace.mock.calls[0][0]);
    expect(url.host).toBe("openfront.io");
    expect(url.pathname).toBe("/game/dAbCd12345");
  });

  it("homeHref leaves a versioned page for the version-free root", () => {
    // "Leave to the menu" should land the player on `latest`, not back on
    // the build they were told to leave.
    stubPage("openfront.io", "/v/5ccc50a7/game/dAbCd12345", "openfront.io");
    expect(homeHref()).toBe("/");
  });

  // The unknown-letter bounce (Main.redirectUnknownLetterToApex) goes to the
  // apex precisely because this page's routing knowledge is stale. Both
  // prefixes encode that stale knowledge: the worker is one deployment's,
  // and /v/<commit>/ pins the very version being left behind -- keeping it
  // would land back on the same shell with the same unknown letter.
  it("apexPathFor drops the worker and version prefixes", () => {
    expect(apexPathFor("/w1/game/dAbCd12345")).toBe("/game/dAbCd12345");
    expect(apexPathFor("/v/bfd5563a/game/dAbCd12345")).toBe("/game/dAbCd12345");
    expect(apexPathFor("/v/bfd5563a/w1/game/dAbCd12345")).toBe(
      "/game/dAbCd12345",
    );
    expect(apexPathFor("/game/dAbCd12345")).toBe("/game/dAbCd12345");
    expect(apexPathFor("/")).toBe("/");
  });
});
