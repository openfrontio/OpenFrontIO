import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string, p?: Record<string, string | number>) =>
    p ? `${k}:${JSON.stringify(p)}` : k,
}));

import { FFA_TIER_BASES } from "../../src/client/components/ffaRating/FfaTier";
import {
  FFA_TIER_COLOR_CLASSES,
  type FfaTierBadge,
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

  it("gives each base tier its own colour", () => {
    expect(
      new Set(FFA_TIER_BASES.map((b) => FFA_TIER_COLOR_CLASSES[b])).size,
    ).toBe(8);
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

  it("defaults to sm and sizes up", async () => {
    await render({ tier: "Gold I" });
    expect(badge.innerHTML).toContain("text-[10px]");
    badge.size = "lg";
    await badge.updateComplete;
    expect(badge.innerHTML).toContain("text-sm");
  });
});
