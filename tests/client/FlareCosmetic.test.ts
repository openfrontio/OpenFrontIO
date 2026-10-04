import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCosmetics, resolveCosmetics } = vi.hoisted(() => ({
  fetchCosmetics: vi.fn(),
  resolveCosmetics: vi.fn(),
}));

vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics,
  resolveCosmetics,
}));
vi.mock("../../src/client/components/CosmeticPresentation", () => ({
  cosmeticSelectionLabel: (r: { key: string }) => `label:${r.key}`,
  cosmeticTypeLabel: (r: { type: string }) => `type:${r.type}`,
}));
vi.mock("../../src/client/components/CosmeticPreview", () => ({}));

import {
  describeFlareCosmetic,
  findFlareCosmetic,
} from "../../src/client/components/FlareCosmetic";
import type { ResolvedCosmetic } from "../../src/client/Cosmetics";
import type { TrackFlare } from "../../src/core/ApiSchemas";

const item = (type: string, key: string): ResolvedCosmetic =>
  ({
    type,
    key,
    cosmetic: { name: key.split(":").pop() },
    colorPalette: null,
    relationship: "owned",
  }) as unknown as ResolvedCosmetic;

const CATALOG = [
  { ...item("pattern", "pattern:default"), cosmetic: null },
  item("pattern", "pattern:i_am_death"),
  item("pattern", "pattern:i_am_death:crimson"),
  item("flag", "flag:mito_nation"),
  item("crown", "crown:marbled"),
  item("effect", "effect:nukeExplosion:solar_corona"),
] as ResolvedCosmetic[];

const flare = (flareName: string, url: string | null = null): TrackFlare => {
  const [type, name] = flareName.split(":");
  return {
    kind: "prestige",
    level: null,
    prestige: 5,
    flareName,
    cosmetic: { type, name, url },
  };
};

describe("findFlareCosmetic", () => {
  it("finds a cosmetic by the flare that unlocks it", () => {
    expect(findFlareCosmetic(CATALOG, "flag:mito_nation")?.key).toBe(
      "flag:mito_nation",
    );
    expect(findFlareCosmetic(CATALOG, "crown:marbled")?.key).toBe(
      "crown:marbled",
    );
    // A coloured pattern is its own flare.
    expect(findFlareCosmetic(CATALOG, "pattern:i_am_death:crimson")?.key).toBe(
      "pattern:i_am_death:crimson",
    );
    expect(findFlareCosmetic(CATALOG, "pattern:i_am_death")?.key).toBe(
      "pattern:i_am_death",
    );
    // An effect's flare leaves out its effect type.
    expect(findFlareCosmetic(CATALOG, "effect:solar_corona")?.key).toBe(
      "effect:nukeExplosion:solar_corona",
    );
  });

  it("finds nothing for a flare no cosmetic has", () => {
    expect(findFlareCosmetic(CATALOG, "flag:nope")).toBeNull();
    expect(findFlareCosmetic(CATALOG, "pattern:default")).toBeNull();
  });
});

describe("describeFlareCosmetic", () => {
  beforeEach(() => {
    fetchCosmetics.mockReset().mockResolvedValue({});
    resolveCosmetics.mockReset().mockReturnValue(CATALOG);
  });

  it("describes the catalog's item: its name, type and preview", async () => {
    const view = (await describeFlareCosmetic(flare("effect:solar_corona")))!;
    expect(view.name).toBe("label:effect:nukeExplosion:solar_corona");
    expect(view.typeLabel).toBe("type:effect");
    const host = document.createElement("div");
    render(view.preview, host);
    expect(host.querySelector("cosmetic-preview")).not.toBeNull();
  });

  it("falls back to what the flare says when the catalog lacks it", async () => {
    const view = (await describeFlareCosmetic(
      flare("flag:brand_new_flag", "https://cdn.test/flag.svg"),
    ))!;
    expect(view.name).toBe("Brand New Flag");
    expect(view.typeLabel).toBe("");
    const host = document.createElement("div");
    render(view.preview, host);
    expect(host.querySelector("img")!.getAttribute("src")).toBe(
      "https://cdn.test/flag.svg",
    );
  });

  it("falls back when the catalog can't be loaded", async () => {
    fetchCosmetics.mockRejectedValue(new Error("offline"));
    const view = (await describeFlareCosmetic(flare("crown:marbled")))!;
    expect(view.name).toBe("Marbled");
  });

  it("is null for a flare that isn't a cosmetic", async () => {
    expect(
      await describeFlareCosmetic({ ...flare("crown:x"), cosmetic: null }),
    ).toBeNull();
  });
});
