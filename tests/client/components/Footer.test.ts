import version from "resources/version.txt?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../../src/client/ClientEnv";
import { composeGameVersion } from "../../../src/client/GameVersion";
import { Footer } from "../../../src/client/components/Footer";

const SHA = "bf739f86c4e1d2a3b5c6d7e8f90123456789abcd";

// version.txt is a build-time placeholder in the repo, so derive the expected
// label from the same source the component reads rather than hardcoding it.
// These mount tests set no BOOTSTRAP_CONFIG, so composeGameVersion has no
// commit to fall back to and returns the file's value -- which keeps this
// the right expectation for the mounted component below. The choice itself is
// covered in tests/client/GameVersion.test.ts.
const gameVersion = `v${version.trim().replace(/^v/, "")}`;

describe("page-footer version line", () => {
  let footer: Footer;

  beforeEach(() => {
    if (!customElements.get("page-footer")) {
      customElements.define("page-footer", Footer);
    }
    ClientEnv.reset();
  });

  afterEach(() => {
    footer?.remove();
    window.openfrontDesktop = undefined;
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  async function mount(): Promise<Footer> {
    footer = document.createElement("page-footer") as Footer;
    document.body.appendChild(footer);
    await footer.updateComplete;
    return footer;
  }

  it("renders the game version on the web, with no Steam subtext", async () => {
    window.openfrontDesktop = undefined;
    await mount();

    const line = footer.querySelector(".footer-version");
    expect(line?.textContent?.trim()).toBe(gameVersion);
  });

  it("appends the shell version inside the desktop shell", async () => {
    window.openfrontDesktop = {
      version: () => Promise.resolve("0.2.0"),
    };
    await mount();

    await vi.waitFor(async () => {
      await footer.updateComplete;
      const line = footer.querySelector(".footer-version");
      expect(line?.textContent?.trim()).toBe(`${gameVersion} (Steam v0.2.0)`);
    });
  });

  // End to end through the component: with a real BOOTSTRAP_CONFIG in the
  // page and the placeholder still in version.txt, the line must name the
  // commit rather than "vx.xx.xx". Expectation derived from the same helper
  // so committing a real version.txt does not turn this red.
  it("shows the commit rather than the placeholder on an untagged build", async () => {
    (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "1x00000000000000000000AA",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: SHA,
    };
    window.openfrontDesktop = undefined;
    await mount();

    const line = footer.querySelector(".footer-version");
    expect(line?.textContent?.trim()).toBe(composeGameVersion(version, SHA));
  });

  // The bridge lives in a separate private repo, so the footer must degrade to
  // the game version alone rather than render a broken label.
  it("falls back to the game version when the bridge rejects", async () => {
    window.openfrontDesktop = {
      version: () => Promise.reject(new Error("boom")),
    };
    await mount();

    await vi.waitFor(async () => {
      await footer.updateComplete;
      const line = footer.querySelector(".footer-version");
      expect(line?.textContent?.trim()).toBe(gameVersion);
    });
  });
});
