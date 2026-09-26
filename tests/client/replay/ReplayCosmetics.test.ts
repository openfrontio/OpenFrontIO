/**
 * Appearance in a replay, resolved in the viewer as the live client does:
 * colours from the viewer's theme, the cosmetics the server resolved when
 * the game started (colour, pattern, skin, flag, crown), a nation's flag
 * from the file, and the trail effects resolved against the catalog.
 */

import { colord } from "colord";
import { createThemeSettings } from "../../../src/client/render/gl/RenderSettings";
import {
  EFFECT_PALETTE_BLOCKS,
  MAX_TRAIL_COLORS,
} from "../../../src/client/render/gl/utils/ColorUtils";
import { PALETTE_SIZE } from "../../../src/client/render/gl/utils/PlayerPalette";
import {
  PlayerTypeEnum,
  type PlayerStatic,
} from "../../../src/client/render/types";
import { applyReplayEffects } from "../../../src/client/replay/ReplayEffects";
import {
  buildReplayPalette,
  visibleReplayCosmetics,
} from "../../../src/client/replay/ReplayPalette";
import { SettingsTheme } from "../../../src/client/theme/ThemeProvider";
import type { PlayerView } from "../../../src/client/view";
import { playerTypeFromEnum } from "../../../src/client/view/EntityState";
import type { Cosmetics } from "../../../src/core/CosmeticSchemas";
import type { PlayerCosmetics } from "../../../src/core/Schemas";

const player = (
  smallID: number,
  clientID: string | null,
  over: Partial<PlayerStatic> = {},
): PlayerStatic => ({
  smallID,
  id: `p${smallID}`,
  name: `P${smallID}`,
  displayName: `P${smallID}`,
  clanTag: null,
  clientID,
  playerType: PlayerTypeEnum.Human,
  team: null,
  isLobbyCreator: false,
  ...over,
});

/** What PlayerView gets from a fresh theme, in the same order. */
function themeColors(
  players: PlayerStatic[],
  palette: "default" | "colorblind" = "default",
) {
  const theme = new SettingsTheme(createThemeSettings(palette));
  return players.map((p) =>
    theme
      .territoryColor({
        id: () => p.id,
        type: () => playerTypeFromEnum(p.playerType),
        team: () => p.team,
      } as unknown as PlayerView)
      .toHex(),
  );
}

/** A player's fill and border as written to the palette. */
function paletteColors(palette: Float32Array, smallID: number) {
  const hex = (o: number) =>
    colord({
      r: Math.round(palette[o] * 255),
      g: Math.round(palette[o + 1] * 255),
      b: Math.round(palette[o + 2] * 255),
    }).toHex();
  return {
    fill: hex(smallID * 4),
    border: hex(PALETTE_SIZE * 4 + smallID * 4),
  };
}

describe("player appearance", () => {
  test("colours come from the theme, in the order players appeared", () => {
    const players = [
      player(1, "c1"),
      player(2, "c2"),
      player(3, null, { playerType: PlayerTypeEnum.Nation }),
      player(4, null, { playerType: PlayerTypeEnum.Bot }),
      player(5, "c5", { team: "Red" }),
    ];
    const built = buildReplayPalette(players);
    const expected = themeColors(players);
    expect(built.players.map((p) => p.color)).toEqual(expected);
    // Allocation is order-dependent: the humans drew distinct colours.
    expect(expected[0]).not.toBe(expected[1]);
    const theme = new SettingsTheme(createThemeSettings("default"));
    expect(paletteColors(built.palette, 1)).toEqual({
      fill: expected[0],
      border: theme.borderColor(colord(expected[0])).toHex(),
    });
  });

  test("the viewer's theme is used (the colour-blind palette)", () => {
    const players = [player(1, "c1"), player(2, "c2")];
    const built = buildReplayPalette(
      players,
      new Map(),
      new SettingsTheme(createThemeSettings("colorblind")),
    );
    expect(built.players.map((p) => p.color)).toEqual(
      themeColors(players, "colorblind"),
    );
    expect(built.players[0].color).not.toBe(themeColors(players)[0]);
  });

  test("flags, crowns and the verified badge; a nation's flag from the file", () => {
    const built = buildReplayPalette(
      [
        player(1, "c1"),
        player(2, "c2"),
        player(3, null, {
          playerType: PlayerTypeEnum.Nation,
          flag: "/flags/in.svg",
        }),
      ],
      new Map([
        [
          "c1",
          {
            flag: "https://cdn.example.com/flags/custom.svg",
            crown: { name: "gold", url: "https://cdn.example/c.png" },
            verified: true,
          },
        ],
      ]),
    );
    const [p1, p2, p3] = built.players;
    expect(p1).toMatchObject({
      flag: "https://cdn.example.com/flags/custom.svg",
      crown: "https://cdn.example/c.png",
      verified: true,
    });
    expect(p2.flag).toBeUndefined();
    expect(p2.crown).toBeUndefined();
    expect(p2.verified).toBe(false);
    expect(p3.flag).toMatch(/flags\/in.*\.svg$/);
  });
});

// A 2×2 pattern: the decoder reads width, height and scale from the first
// bytes (PatternDecoder), so this is a real encoded pattern, not a stub.
const PATTERN_DATA = "AAAAAA";

describe("the viewer's cosmetics visibility settings", () => {
  const equipped = new Map<string, PlayerCosmetics>([
    [
      "c1",
      {
        flag: "/flags/US.svg",
        crown: { name: "gold", url: "/crowns/gold.svg" },
        verified: true,
        pattern: { name: "stripes", patternData: PATTERN_DATA },
        skin: { name: "gold", url: "/skins/gold.png" },
      },
    ],
  ]);
  const shown = (visibility: Parameters<typeof visibleReplayCosmetics>[1]) =>
    buildReplayPalette(
      [player(1, "c1")],
      visibleReplayCosmetics(equipped, visibility),
    );

  test("everything shows by default", () => {
    const built = shown({});
    expect(built.players[0]).toMatchObject({ verified: true });
    expect(built.players[0].flag).toMatch(/flags\/US/);
    expect(built.players[0].crown).toMatch(/crowns\/gold/);
    expect(built.patternMeta[1 * 4]).toBe(1);
    expect(built.skins.has(1)).toBe(true);
  });

  test.each(["teammates", "self"] as const)(
    "a replay is nobody's: showing only %s hides every player's",
    (showFrom) => {
      const built = shown({ showFrom });
      expect(built.players[0].flag).toBeUndefined();
      expect(built.skins.has(1)).toBe(false);
      // The verified badge marks the account; it isn't a cosmetic.
      expect(built.players[0].verified).toBe(true);
    },
  );
});

describe("territory patterns and skins", () => {
  test("a player's pattern and skin reach the renderer", () => {
    const cosmetics = new Map<string, PlayerCosmetics>([
      [
        "client1",
        {
          pattern: { name: "stripes", patternData: PATTERN_DATA },
          skin: { name: "gold", url: "/skins/gold.png" },
        },
      ],
    ]);
    const built = buildReplayPalette(
      [player(1, "client1"), player(2, "client2"), player(3, null)],
      cosmetics,
    );
    // hasPattern is the first float of the player's entry.
    expect(built.patternMeta[1 * 4]).toBe(1);
    expect(built.patternMeta[2 * 4]).toBe(0);
    expect(built.skins.get(1)).toMatch(/skins\/gold/);
    expect(built.skins.has(2)).toBe(false);
  });
});

describe("trail effects", () => {
  const catalog = {
    effects: {
      nukeTrail: {
        vortex: {
          name: "vortex",
          product: null,
          rarity: "rare",
          effectType: "nukeTrail",
          attributes: {
            type: "spiral",
            colors: ["#ff0000", "#00ff00"],
            radius: 4,
            strands: 3,
            rotationSpeed: 2,
          },
        },
      },
      transportShipTrail: {
        comet: {
          name: "comet",
          product: null,
          rarity: "common",
          effectType: "transportShipTrail",
          attributes: {
            type: "gradient",
            colors: ["#0000ff"],
            colorSize: 2,
            movementSpeed: 1,
          },
        },
      },
    },
  } as unknown as Cosmetics;

  const equipped = (): PlayerCosmetics => ({
    effects: {
      nukeTrail: { name: "vortex", effectType: "nukeTrail" },
      transportShipTrail: {
        name: "comet",
        effectType: "transportShipTrail",
      },
    },
  });

  function renderer() {
    const uploaded: Float32Array[] = [];
    const spirals: { smallID: number; strands: number }[] = [];
    const cleared: number[] = [];
    return {
      view: {
        updateEffectPalette: (p: Float32Array) => uploaded.push(p),
      } as never,
      spirals: {
        setNukeTrailSpiral: (smallID: number, params: { strands: number }) =>
          spirals.push({ smallID, strands: params.strands }),
        clearNukeTrailSpiral: (smallID: number) => cleared.push(smallID),
      },
      uploaded,
      spiralCalls: spirals,
      cleared,
    };
  }

  test("a spiral nuke trail becomes ribbons and a palette entry", () => {
    const r = renderer();
    applyReplayEffects(
      r.view,
      r.spirals,
      [player(7, "client1")],
      new Map([["client1", equipped()]]),
      catalog,
    );
    expect(r.spiralCalls).toEqual([{ smallID: 7, strands: 3 }]);

    const palette = r.uploaded[0];
    expect(palette.length).toBe(
      PALETTE_SIZE * MAX_TRAIL_COLORS * EFFECT_PALETTE_BLOCKS * 4,
    );
    // Block 0 is the ship trail, block 1 the nuke trail: row 0's alpha is
    // the colour count, so both blocks carry this player's effect.
    const countAt = (block: number) =>
      palette[(block * MAX_TRAIL_COLORS * PALETTE_SIZE + 7) * 4 + 3];
    expect(countAt(0)).toBe(1);
    expect(countAt(1)).toBe(2);
  });

  test("an effect the catalog no longer has is simply not drawn", () => {
    const r = renderer();
    applyReplayEffects(
      r.view,
      r.spirals,
      [player(7, "client1")],
      new Map([
        [
          "client1",
          {
            effects: {
              nukeTrail: { name: "retired", effectType: "nukeTrail" },
            },
          } as PlayerCosmetics,
        ],
      ]),
      catalog,
    );
    expect(r.spiralCalls).toEqual([]);
    expect(r.uploaded[0].every((v) => v === 0)).toBe(true);
  });

  test("applied again with an effect hidden, it is cleared", () => {
    const r = renderer();
    const players = [player(7, "client1")];
    const all = new Map([["client1", equipped()]]);
    applyReplayEffects(r.view, r.spirals, players, all, catalog);
    applyReplayEffects(
      r.view,
      r.spirals,
      players,
      visibleReplayCosmetics(all, { nukeTrail: false }),
      catalog,
    );
    expect(r.cleared).toEqual([7]);
    const [, after] = r.uploaded;
    const countAt = (block: number) =>
      after[(block * MAX_TRAIL_COLORS * PALETTE_SIZE + 7) * 4 + 3];
    expect(countAt(0)).toBe(1); // the ship trail still shows
    expect(countAt(1)).toBe(0);
  });
});
