import { colord } from "colord";
import { describe, expect, it } from "vitest";
import { WebGLFrameBuilder } from "../src/client/WebGLFrameBuilder";
import type { PlayerStatic } from "../src/client/render/types";
import type { PlayerCosmetics } from "../src/core/Schemas";

const SID = 3;

const EQUIPPED = {
  flag: "https://cdn.example.com/flags/custom.svg",
  skin: { name: "lava", url: "https://cdn.example.com/skins/lava.png" },
  crown: { name: "gold", url: "https://cdn.example.com/crowns/gold.png" },
} as PlayerCosmetics;

function setup() {
  const skinCalls: Array<[number, string | null]> = [];
  const cosmeticUploads: PlayerStatic[][] = [];
  const view = {
    initSkinAtlas: () => {},
    addPlayers: () => {},
    setPlayerSkin: (sid: number, url: string | null) =>
      skinCalls.push([sid, url]),
    updatePlayerCosmetics: (players: PlayerStatic[]) =>
      cosmeticUploads.push(players),
  };
  const builder = new WebGLFrameBuilder(view as never) as unknown as {
    effectResolved: Set<number>;
    syncPlayers(gameView: unknown): void;
    refreshCosmetics(gameView: unknown): void;
  };
  const player = {
    equippedCosmetics: EQUIPPED,
    cosmetics: EQUIPPED,
    static: { id: "p", smallID: SID },
    smallID: () => SID,
    displayName: () => "p",
    territoryColor: () => colord("#112233"),
    borderColor: () => colord("#445566"),
  };
  const gameView = {
    players: () => [player],
    refreshPlayerCosmetics: () => {
      player.cosmetics = {};
    },
  };
  return { builder, gameView, skinCalls, cosmeticUploads };
}

describe("WebGLFrameBuilder cosmetics refresh", () => {
  it("clears hidden cosmetics from already-registered players", () => {
    const { builder, gameView, skinCalls, cosmeticUploads } = setup();
    builder.syncPlayers(gameView);
    expect(skinCalls).toEqual([[SID, EQUIPPED.skin!.url]]);
    builder.effectResolved.add(SID);

    builder.refreshCosmetics(gameView);

    expect(skinCalls[1]).toEqual([SID, null]);
    expect(cosmeticUploads).toHaveLength(1);
    expect(cosmeticUploads[0][0].flag).toBeUndefined();
    expect(cosmeticUploads[0][0].crown).toBeUndefined();
    // Effects re-resolve against the new visibility on the next update().
    expect(builder.effectResolved.size).toBe(0);
  });

  it("skips players the renderer hasn't registered yet", () => {
    const { builder, gameView, cosmeticUploads } = setup();
    builder.refreshCosmetics(gameView);
    expect(cosmeticUploads[0]).toEqual([]);
  });
});
