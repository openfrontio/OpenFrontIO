import version from "resources/version.txt?raw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  composeGameVersion,
  currentGameVersion,
  renderNavVersion,
} from "../../src/client/GameVersion";

const SHA = "bf739f86c4e1d2a3b5c6d7e8f90123456789abcd";

// The rule this exists for: only a TAGGED deploy overwrites version.txt, so on
// every nightly, staging deploy and Steam depot build the version label read
// "vx.xx.xx" -- naming no build at all, and it is the one string a player is
// asked to quote in a bug report. See OPE-358.
describe("composeGameVersion", () => {
  it("shows the version when the build was tagged", () => {
    expect(composeGameVersion("v0.33.18", SHA)).toBe("v0.33.18");
  });

  it("adds the v when the tag was written without one", () => {
    expect(composeGameVersion("0.33.18", SHA)).toBe("v0.33.18");
  });

  it("tolerates surrounding whitespace, as the raw file import carries", () => {
    expect(composeGameVersion("  v0.33.18\n", SHA)).toBe("v0.33.18");
  });

  it("accepts a version carrying a suffix", () => {
    expect(composeGameVersion("v0.33.18-rc1", SHA)).toBe("v0.33.18-rc1");
  });

  // The placeholder an untagged deploy leaves in the tree. This is the case
  // the whole change exists for.
  it("shows the 7-char commit instead of the placeholder", () => {
    expect(composeGameVersion("x.xx.xx", SHA)).toBe("bf739f8");
  });

  it("lowercases an upper-cased commit", () => {
    expect(composeGameVersion("x.xx.xx", SHA.toUpperCase())).toBe("bf739f8");
  });

  it("accepts a commit already abbreviated by the deploy pipeline", () => {
    expect(composeGameVersion("x.xx.xx", "bf739f86c4e1")).toBe("bf739f8");
  });

  // "DEV" is what the local dev server injects, and "desktop" is what an
  // Electron shell predating OPE-358 injects. Neither is a sha, and both say
  // strictly more than the placeholder.
  it.each(["DEV", "desktop"])("passes through a non-sha commit (%s)", (c) => {
    expect(composeGameVersion("x.xx.xx", c)).toBe(c);
  });

  // Unreachable in a live client, but the label must never come back blank.
  it("falls back to the file when there is no commit at all", () => {
    expect(composeGameVersion("x.xx.xx", "")).toBe("vx.xx.xx");
  });
});

describe("currentGameVersion", () => {
  beforeEach(() => {
    ClientEnv.reset();
  });

  afterEach(() => {
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  it("reads the commit out of BOOTSTRAP_CONFIG", () => {
    (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "1x00000000000000000000AA",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: SHA,
    };

    expect(currentGameVersion()).toBe(composeGameVersion(version, SHA));
  });

  // A cosmetic label must never be what takes the page down: ClientEnv.get()
  // throws outright when BOOTSTRAP_CONFIG is absent.
  it("does not throw when BOOTSTRAP_CONFIG is absent", () => {
    expect(() => currentGameVersion()).not.toThrow();
    expect(currentGameVersion()).toBe(composeGameVersion(version, ""));
  });
});

describe("renderNavVersion", () => {
  beforeEach(() => {
    ClientEnv.reset();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    document.body.innerHTML = "";
  });

  const setBootstrap = () => {
    (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "1x00000000000000000000AA",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: SHA,
    };
  };

  // The nav bar must not read "vx.xx.xx" while the footer reads the commit.
  it("stamps the same label the footer uses onto both nav bars", () => {
    setBootstrap();
    document.body.innerHTML = `
      <span id="game-version"></span>
      <span class="game-version-display"></span>
    `;

    expect(renderNavVersion()).toBe(2);
    const expected = composeGameVersion(version, SHA);
    for (const el of document.querySelectorAll(
      "#game-version, .game-version-display",
    )) {
      expect(el.textContent).toBe(expected);
      expect(el.textContent).not.toContain("x.xx.xx");
    }
  });

  it("reports zero when the markup carries no version element", () => {
    setBootstrap();
    document.body.innerHTML = '<span id="something-else"></span>';

    expect(renderNavVersion()).toBe(0);
  });
});
