import { afterEach, describe, expect, test } from "vitest";
import { GraphicsOverridesSchema } from "../../src/client/render/gl/GraphicsOverrides";
import { applyGraphicsOverrides } from "../../src/client/render/gl/RenderOverrides";
import { createRenderSettings } from "../../src/client/render/gl/RenderSettings";
import { visibleCosmetics } from "../../src/client/view/CosmeticVisibility";
import { UserSettings } from "../../src/core/game/UserSettings";
import type { PlayerCosmetics } from "../../src/core/Schemas";
import { makeGameView, makePlayerView } from "../util/viewStubs";

const EQUIPPED: PlayerCosmetics = {
  flag: "/flags/US.svg",
  pattern: { name: "stripes", patternData: "AAAA" },
  skin: { name: "lava", url: "/skins/lava.png" },
  color: { color: "#ff0000" },
  crown: { name: "gold", url: "/crowns/gold.png" },
  effects: {
    transportShipTrail: { name: "rainbow", effectType: "transportShipTrail" },
    nukeTrail: { name: "spiral", effectType: "nukeTrail" },
    atom: { name: "sparkle", effectType: "nukeExplosion" },
    railroad: { name: "gold", effectType: "railroad" },
  },
  verified: true,
} as PlayerCosmetics;

describe("visibleCosmetics", () => {
  test("shows everything by default", () => {
    expect(visibleCosmetics(EQUIPPED, {}, "other")).toEqual(EQUIPPED);
  });

  test("always shows your own cosmetics", () => {
    const hideAll = {
      showFrom: "self",
      flags: false,
      territorySkins: false,
    } as const;
    expect(visibleCosmetics(EQUIPPED, hideAll, "self")).toBe(EQUIPPED);
  });

  test("only me hides everyone else's cosmetics but keeps the verified badge", () => {
    expect(visibleCosmetics(EQUIPPED, { showFrom: "self" }, "other")).toEqual({
      verified: true,
    });
    expect(
      visibleCosmetics(EQUIPPED, { showFrom: "self" }, "teammate"),
    ).toEqual({ verified: true });
  });

  test("my team shows teammates' cosmetics only", () => {
    const visibility = { showFrom: "teammates" } as const;
    expect(visibleCosmetics(EQUIPPED, visibility, "teammate")).toEqual(
      EQUIPPED,
    );
    expect(visibleCosmetics(EQUIPPED, visibility, "other")).toEqual({
      verified: true,
    });
  });

  test("hides each disabled category", () => {
    const visible = visibleCosmetics(
      EQUIPPED,
      {
        territorySkins: false,
        territoryColors: false,
        flags: false,
        crowns: false,
      },
      "other",
    );
    expect(visible.pattern).toBeUndefined();
    expect(visible.skin).toBeUndefined();
    expect(visible.color).toBeUndefined();
    expect(visible.flag).toBeUndefined();
    expect(visible.crown).toBeUndefined();
    expect(visible.effects).toEqual(EQUIPPED.effects);
  });

  test("hides effects by effect type, including per-bomb explosion slots", () => {
    const visible = visibleCosmetics(
      EQUIPPED,
      { nukeExplosion: false, transportShipTrail: false },
      "other",
    );
    expect(Object.keys(visible.effects!).sort()).toEqual([
      "nukeTrail",
      "railroad",
    ]);
    expect(visible.flag).toBe(EQUIPPED.flag);
  });
});

describe("cosmetics graphics overrides", () => {
  test("schema accepts the cosmetics section and rejects bad values", () => {
    expect(
      GraphicsOverridesSchema.safeParse({
        cosmetics: { showFrom: "teammates", flags: false, flagOpacity: 0.5 },
      }).success,
    ).toBe(true);
    expect(
      GraphicsOverridesSchema.safeParse({ cosmetics: { showFrom: "allies" } })
        .success,
    ).toBe(false);
    expect(
      GraphicsOverridesSchema.safeParse({ cosmetics: { flagOpacity: 2 } })
        .success,
    ).toBe(false);
  });

  test("flag opacity sets the name pass flag alpha", () => {
    const settings = createRenderSettings();
    expect(settings.name.flagAlpha).toBe(1);
    applyGraphicsOverrides(settings, { cosmetics: { flagOpacity: 0.3 } });
    expect(settings.name.flagAlpha).toBe(0.3);
  });
});

describe("PlayerView cosmetics", () => {
  const userSettings = new UserSettings();
  // PlayerView decodes patterns for real, so leave the placeholder one out.
  const PLAYER_COSMETICS = {
    flag: EQUIPPED.flag,
    color: EQUIPPED.color,
  } as PlayerCosmetics;

  afterEach(() => userSettings.setGraphicsOverrides({}));

  test("applies the visibility settings to other players only", () => {
    userSettings.setGraphicsOverrides({ cosmetics: { showFrom: "self" } });
    const game = makeGameView({ myClientID: "client-me" });
    const me = makePlayerView({
      game,
      data: { clientID: "client-me", id: "me", smallID: 1 },
      cosmetics: PLAYER_COSMETICS,
    });
    const other = makePlayerView({
      game,
      data: { clientID: "client-other", id: "other", smallID: 2 },
      cosmetics: PLAYER_COSMETICS,
    });
    expect(me.cosmetics.flag).toBe(EQUIPPED.flag);
    expect(other.cosmetics.flag).toBeUndefined();
    expect(other.equippedCosmetics.flag).toBe(EQUIPPED.flag);
  });

  test("refreshPlayerCosmetics picks up changed settings", () => {
    const game = makeGameView({ myClientID: "client-me" });
    const other = makePlayerView({
      game,
      data: { clientID: "client-other", id: "other", smallID: 2 },
      cosmetics: PLAYER_COSMETICS,
    });
    expect(other.cosmetics.color).toEqual(EQUIPPED.color);
    expect(other.territoryColor().toHex()).toBe("#ff0000");

    userSettings.setGraphicsOverrides({
      cosmetics: { territoryColors: false },
    });
    game.refreshPlayerCosmetics();
    // makePlayerView doesn't register the player with the game.
    other.refreshCosmetics();
    expect(other.cosmetics.color).toBeUndefined();
    expect(other.territoryColor().toHex()).not.toBe("#ff0000");
  });
});
