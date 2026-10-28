import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string, p?: Record<string, string | number>) =>
    p ? `${k}:${JSON.stringify(p)}` : k,
}));

import { assetUrl } from "@openfront/shared/AssetUrls";
import { existsSync } from "fs";
import { resolve } from "path";
import { parseFfaTier } from "../../src/client/components/ffaRating/FfaTier";
import {
  type FfaTierBadge,
  ffaTierImagePath,
} from "../../src/client/components/ffaRating/FfaTierBadge";
import { ALL_FFA_TIERS } from "../util/FfaTiers";

let badge: FfaTierBadge;
afterEach(() => badge?.remove());

async function render(props: Partial<FfaTierBadge>) {
  badge = document.createElement("ffa-tier-badge") as FfaTierBadge;
  Object.assign(badge, props);
  document.body.appendChild(badge);
  await badge.updateComplete;
  return badge;
}

describe("<ffa-tier-badge>", () => {
  it.each(ALL_FFA_TIERS)("draws %s with its base and label", async (tier) => {
    await render({ tier });
    const el = badge.querySelector<HTMLElement>("[data-ffa-tier]")!;
    const [name, division] = tier.split(" ");
    const label = `ffa_rating.tier.${name.toLowerCase()}${division ? ` ${division}` : ""}`;
    expect(el.dataset.ffaTier).toBe(name.toLowerCase());
    expect(el.title).toBe(label);
    expect(badge.textContent).toContain(label);
  });

  it("shows the dashed Calibrating N/10 variant", async () => {
    await render({ calibrationGames: 3 });
    const el = badge.querySelector("[data-ffa-calibrating]")!;
    expect(el.textContent).toContain('ffa_rating.calibrating:{"n":3}');
    expect(badge.innerHTML).toContain("border-dashed");
  });

  it("clamps and rounds the calibration count", async () => {
    await render({ calibrationGames: 12 });
    expect(badge.textContent).toContain('ffa_rating.calibrating:{"n":10}');
    badge.calibrationGames = -2;
    await badge.updateComplete;
    expect(badge.textContent).toContain('ffa_rating.calibrating:{"n":0}');
    badge.calibrationGames = 2.6;
    await badge.updateComplete;
    expect(badge.textContent).toContain('ffa_rating.calibrating:{"n":3}');
  });

  it("prefers the tier when both are set", async () => {
    await render({ tier: "Gold I", calibrationGames: 3 });
    expect(badge.querySelector("[data-ffa-calibrating]")).toBeNull();
    expect(badge.querySelector("[data-ffa-tier]")).not.toBeNull();
  });

  it("shows an unknown tier's text in a neutral pill", async () => {
    await render({ tier: "Mythril II" });
    expect(
      badge.querySelector<HTMLElement>("[data-ffa-tier]")!.dataset.ffaTier,
    ).toBe("unknown");
    expect(badge.textContent).toContain("Mythril II");
    expect(badge.innerHTML).toContain("bg-white/10");
  });

  it("renders nothing without a tier or a calibration count", async () => {
    await render({});
    expect(badge.textContent!.trim()).toBe("");
  });

  it.each(ALL_FFA_TIERS)(
    "draws %s with its family's compact emblem",
    async (tier) => {
      await render({ tier });
      const family = tier.split(" ")[0].toLowerCase();
      expect(img().getAttribute("src")).toBe(
        assetUrl(`images/ffa-tiers/compact/${family}.svg`),
      );
    },
  );

  it.each(ALL_FFA_TIERS)(
    "draws %s at lg with its own detailed emblem",
    async (tier) => {
      await render({ tier, size: "lg" });
      const file = tier.toLowerCase().replace(" ", "-");
      expect(img().getAttribute("src")).toBe(
        assetUrl(`images/ffa-tiers/detailed/${file}.svg`),
      );
    },
  );

  it("only points at emblems that ship", () => {
    for (const tier of ALL_FFA_TIERS) {
      for (const size of ["sm", "md", "lg"] as const) {
        const asset = ffaTierImagePath(parseFfaTier(tier)!, size);
        expect(existsSync(resolve("resources", asset)), asset).toBe(true);
      }
    }
  });

  it("writes the tier beside the compact emblem, which is decorative", async () => {
    await render({ tier: "Diamond II", size: "md" });
    expect(img().alt).toBe("");
    expect(
      badge.querySelector("[data-ffa-tier-label]")!.textContent!.trim(),
    ).toBe("ffa_rating.tier.diamond II");
  });

  it("gives the detailed emblem the tier as alt text and no label", async () => {
    await render({ tier: "Diamond II", size: "lg" });
    expect(img().alt).toBe("ffa_rating.tier.diamond II");
    expect(badge.querySelector("[data-ffa-tier-label]")).toBeNull();
    expect(badge.querySelector<HTMLElement>("[data-ffa-tier]")!.title).toBe(
      "ffa_rating.tier.diamond II",
    );
  });

  it("shares one compact emblem across a family's divisions", async () => {
    const srcs = new Set<string>();
    for (const tier of ["Diamond III", "Diamond II", "Diamond I"]) {
      await render({ tier });
      srcs.add(img().getAttribute("src")!);
      badge.remove();
    }
    expect(srcs.size).toBe(1);
  });

  it.each([
    ["sm", 20],
    ["md", 24],
    ["lg", 48],
  ] as const)("sizes the emblem for %s", async (size, px) => {
    await render({ tier: "Gold I", size });
    expect(img().getAttribute("width")).toBe(String(px));
    expect(img().getAttribute("height")).toBe(String(px));
  });

  it("defaults to sm", async () => {
    await render({ tier: "Gold I" });
    expect(img().getAttribute("width")).toBe("20");
  });
});

function img(): HTMLImageElement {
  return badge.querySelector<HTMLImageElement>("img[data-ffa-tier-img]")!;
}
