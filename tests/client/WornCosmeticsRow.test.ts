import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResolvedCosmetic } from "../../src/client/Cosmetics";

const { getUserMe, fetchCosmetics, resolveCosmetics } = vi.hoisted(() => ({
  getUserMe: vi.fn(async () => false),
  fetchCosmetics: vi.fn(async () => null),
  resolveCosmetics: vi.fn((): ResolvedCosmetic[] => []),
}));

vi.mock("../../src/client/Api", () => ({ getUserMe }));
vi.mock("../../src/client/Cosmetics", () => ({
  fetchCosmetics,
  resolveCosmetics,
  translateCosmetic: (_prefix: string, name: string) => name,
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { WornCosmeticsRow } from "../../src/client/components/WornCosmeticsRow";

function crownEntry(
  relationship: ResolvedCosmetic["relationship"],
): ResolvedCosmetic {
  return {
    type: "crown",
    cosmetic: { name: "gold", rarity: "legendary" } as never,
    colorPalette: null,
    relationship,
    key: "crown:gold",
  };
}

async function renderRow(): Promise<WornCosmeticsRow> {
  if (!customElements.get("worn-cosmetics-row")) {
    customElements.define("worn-cosmetics-row", WornCosmeticsRow);
  }
  const el = document.createElement("worn-cosmetics-row") as WornCosmeticsRow;
  el.cosmetics = { crown: { name: "gold", url: "/crown.png" } };
  document.body.appendChild(el);
  await el.updateComplete;
  // Second settle: the catalog and account load after the first render.
  await Promise.resolve();
  await el.updateComplete;
  return el;
}

describe("worn-cosmetics-row", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    resolveCosmetics.mockReturnValue([]);
  });

  it("renders nothing for a player with no cosmetics", async () => {
    const el = await renderRow();
    el.cosmetics = {};
    await el.updateComplete;

    expect(el.querySelector("button")).toBeNull();
    // The host must not keep taking up a flex gap once it has no tiles.
    expect(el.hasAttribute("hidden")).toBe(true);
  });

  it("unhides the host once the player has cosmetics", async () => {
    resolveCosmetics.mockReturnValue([crownEntry("owned")]);
    const el = await renderRow();

    expect(el.hasAttribute("hidden")).toBe(false);
  });

  it("opens the store in a new tab for an item the viewer can buy", async () => {
    resolveCosmetics.mockReturnValue([crownEntry("purchasable")]);
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    const el = await renderRow();
    const tile = el.querySelector("button")!;
    expect(tile.hasAttribute("disabled")).toBe(false);
    tile.click();

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining("#modal=store&tab=cosmetics&item=crown%3Agold"),
      "_blank",
      "noopener",
    );
    open.mockRestore();
  });

  it("shows an owned item without a store link", async () => {
    resolveCosmetics.mockReturnValue([crownEntry("owned")]);
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    const el = await renderRow();
    const tile = el.querySelector("button")!;
    tile.click();

    expect(tile.hasAttribute("disabled")).toBe(true);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
