import type { CosmeticPreviewRequest } from "../../src/client/cosmetic-preview/api";
import {
  configurePreviewAssets,
  PREVIEW_ASSET_PATHS,
} from "../../src/client/cosmetic-preview/assets";
import {
  parsePreviewRequest,
  toResolvedCosmetic,
  type PreviewRequest,
} from "../../src/client/cosmetic-preview/config";
import { assetUrl } from "../../src/core/AssetUrls";

// Compile-time: everything the runtime schema accepts is a request the
// published types (api.ts, shipped as index.d.ts) allow. If this stops
// compiling, the package's types have drifted from what it validates.
const asPublic = (request: PreviewRequest): CosmeticPreviewRequest => request;

// An 8x8 pattern at scale 1 with diagonal stripes.
const PATTERN = "ADEYB4PB4HA4HA4";

const ATOM = {
  name: "test_atom",
  product: null,
  rarity: "common",
  effectType: "nukeExplosion",
  attributes: {
    type: "shockwave",
    nukeType: "atom",
    colors: ["#ffffff"],
    size: 60,
    speed: 1,
    thickness: 4,
    transitionSpeed: 1,
  },
};

describe("parsePreviewRequest", () => {
  test("accepts a pattern, with or without colours", () => {
    expect(parsePreviewRequest({ type: "pattern", pattern: PATTERN })).toEqual({
      ok: true,
      request: { type: "pattern", pattern: PATTERN },
    });
    const coloured = parsePreviewRequest({
      type: "pattern",
      pattern: PATTERN,
      colors: ["#ff7f0e", "#06b6d4"],
    });
    expect(coloured.ok).toBe(true);
  });

  test("rejects pattern data the catalogue would reject", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Valid base64url, but a header claiming far more tiles than it carries.
    const result = parsePreviewRequest({ type: "pattern", pattern: "AP__" });
    expect(result.ok).toBe(false);
    errorSpy.mockRestore();
  });

  test("rejects colours that are not #rrggbb pairs", () => {
    for (const colors of [["#fff", "#000000"], ["#ff7f0e"], ["red", "blue"]]) {
      expect(
        parsePreviewRequest({ type: "pattern", pattern: PATTERN, colors }).ok,
      ).toBe(false);
    }
  });

  test("accepts only https skin URLs", () => {
    expect(
      parsePreviewRequest({ type: "skin", url: "https://cdn.example/s.png" })
        .ok,
    ).toBe(true);
    expect(
      parsePreviewRequest({ type: "skin", url: "http://cdn.example/s.png" }).ok,
    ).toBe(false);
    expect(
      parsePreviewRequest({ type: "skin", url: "javascript:alert(1)" }).ok,
    ).toBe(false);
  });

  test("validates effects against the catalogue schema", () => {
    expect(parsePreviewRequest({ type: "effect", effect: ATOM }).ok).toBe(true);
    const broken = { ...ATOM, attributes: { ...ATOM.attributes, size: "big" } };
    const result = parsePreviewRequest({ type: "effect", effect: broken });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("effect");
  });

  test("rejects unknown request types", () => {
    expect(
      parsePreviewRequest({ type: "flag", url: "https://x/y.svg" }).ok,
    ).toBe(false);
    expect(parsePreviewRequest(null).ok).toBe(false);
  });

  test("valid requests satisfy the published types", () => {
    const result = parsePreviewRequest({ type: "effect", effect: ATOM });
    if (!result.ok) throw new Error(result.error);
    expect(asPublic(result.request)).toBe(result.request);
  });
});

describe("toResolvedCosmetic", () => {
  test("a pattern carries its colours as the palette the store would use", () => {
    const resolved = toResolvedCosmetic({
      type: "pattern",
      pattern: PATTERN,
      colors: ["#ff7f0e", "#06b6d4"],
    });
    expect(resolved.type).toBe("pattern");
    expect(resolved.cosmetic).toMatchObject({ pattern: PATTERN });
    expect(resolved.colorPalette).toMatchObject({
      primaryColor: "#ff7f0e",
      secondaryColor: "#06b6d4",
    });
  });

  test("a pattern without colours leaves the store's default to apply", () => {
    const resolved = toResolvedCosmetic({ type: "pattern", pattern: PATTERN });
    expect(resolved.colorPalette).toBeNull();
  });

  test("a skin keeps its URL", () => {
    const resolved = toResolvedCosmetic({
      type: "skin",
      url: "https://cdn.example/s.png",
    });
    expect(resolved.type).toBe("skin");
    expect(resolved.cosmetic).toMatchObject({
      url: "https://cdn.example/s.png",
    });
  });

  test("an effect's key names it, as the store's keys do", () => {
    const result = parsePreviewRequest({
      type: "effect",
      effect: { ...ATOM, name: "big_mirv" },
    });
    if (!result.ok) throw new Error(result.error);
    const resolved = toResolvedCosmetic(result.request);
    expect(resolved.effectType).toBe("nukeExplosion");
    // CosmeticRenderCanvas tells a MIRV from a single nuke by its key.
    expect(resolved.key).toBe("effect:nukeExplosion:big_mirv");
  });
});

describe("configurePreviewAssets", () => {
  afterEach(() => {
    globalThis.__ASSET_MANIFEST__ = undefined;
    globalThis.__CDN_BASE__ = undefined;
  });

  test("resolves every shipped asset under the host's base", () => {
    configurePreviewAssets("/openfront-preview/");
    for (const path of PREVIEW_ASSET_PATHS) {
      expect(assetUrl(path)).toBe(`/openfront-preview/${path}`);
    }
  });

  test("resolves the preview map where loadPreviewMap asks for it", () => {
    configurePreviewAssets("/openfront-preview");
    expect(assetUrl("maps/australia/map4x.bin")).toBe(
      "/openfront-preview/maps/australia/map4x.bin",
    );
  });

  test("refuses to move assets once configured", () => {
    configurePreviewAssets("/a");
    expect(() => configurePreviewAssets("/a/")).not.toThrow();
    expect(() => configurePreviewAssets("/b")).toThrow(/already configured/);
  });
});
