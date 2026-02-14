import { afterEach, describe, expect, test, vi } from "vitest";
import {
  readLanguageBundle,
  renderChangelogAssetHtml,
  readTextAsset,
} from "../../../src/client/runtime/UiContentReadRuntime";

describe("UiContentReadRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("returns parsed language bundle when fetch succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ hello: "world" }),
      })),
    );

    await expect(readLanguageBundle("en")).resolves.toEqual({
      hello: "world",
    });
  });

  test("returns null when language bundle fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
      })),
    );

    await expect(readLanguageBundle("en")).resolves.toBeNull();
  });

  test("returns null for empty text asset url", async () => {
    await expect(readTextAsset("")).resolves.toBeNull();
  });

  test("renders changelog markdown into html", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          "Release **v1.2.3**\\n\\nhttps://github.com/openfrontio/OpenFrontIO/pull/123",
      })),
    );

    const rendered = await renderChangelogAssetHtml("/changelog.md");
    expect(rendered).toContain("Release");
    expect(rendered).toContain("v1.2.3");
    expect(rendered).toContain("pull/123");
  });
});
