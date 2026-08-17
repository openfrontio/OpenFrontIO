import version from "resources/version.txt?raw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Footer } from "../../../src/client/components/Footer";

// version.txt is a build-time placeholder in the repo, so derive the expected
// label from the same source the component reads rather than hardcoding it.
const gameVersion = `v${version.trim().replace(/^v/, "")}`;

describe("page-footer version line", () => {
  let footer: Footer;

  beforeEach(() => {
    if (!customElements.get("page-footer")) {
      customElements.define("page-footer", Footer);
    }
  });

  afterEach(() => {
    footer?.remove();
    window.openfrontDesktop = undefined;
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
