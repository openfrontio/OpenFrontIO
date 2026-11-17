import { PlayerType, RankedType } from "@openfront/engine-api/game/GameTypes";
import { describe, expect, it } from "vitest";
import {
  eliminatedByCard,
  type EndCardGame,
  type EndCardPlayer,
  winnerCard,
} from "../../src/client/hud/layers/EndScreenCard";

function player(
  clientID: string | null,
  opts: Partial<{
    type: PlayerType;
    team: string | null;
    tiles: number;
    clanTag: string | null;
    killedBy: string | null;
  }> = {},
): EndCardPlayer {
  return {
    clientID: () => clientID,
    type: () => opts.type ?? PlayerType.Human,
    team: () => opts.team ?? null,
    numTilesOwned: () => opts.tiles ?? 0,
    clanTag: () => opts.clanTag ?? null,
    killedBy: () => opts.killedBy ?? null,
  };
}

function game(players: EndCardPlayer[], rankedType?: RankedType): EndCardGame {
  return {
    players: () => players,
    playerByClientID: (id) => players.find((p) => p.clientID() === id) ?? null,
    rankedType: () => rankedType,
  };
}

const everyoneHasCard = () => true;

describe("eliminatedByCard", () => {
  it("human killer gives eliminatedBy", () => {
    const killer = player("KILLER01");
    const me = player("ME000001", { killedBy: "KILLER01" });
    expect(eliminatedByCard(me, game([me, killer]), everyoneHasCard)).toEqual({
      kind: "eliminatedBy",
      clientID: "KILLER01",
    });
  });

  it("human killer without a card gives none", () => {
    const killer = player("KILLER01");
    const me = player("ME000001", { killedBy: "KILLER01" });
    expect(eliminatedByCard(me, game([me, killer]), () => false)).toEqual({
      kind: "none",
    });
  });

  it("bot killer shows no card", () => {
    const me = player("ME000001", { killedBy: null });
    expect(eliminatedByCard(me, game([me]), everyoneHasCard)).toEqual({
      kind: "none",
    });
  });

  it("nation killer shows no card", () => {
    const nation = player("NATION01", { type: PlayerType.Nation });
    const me = player("ME000001", { killedBy: "NATION01" });
    expect(eliminatedByCard(me, game([me, nation]), everyoneHasCard)).toEqual({
      kind: "none",
    });
  });

  it("unknown clientID shows no card", () => {
    const me = player("ME000001", { killedBy: "GONE0001" });
    expect(eliminatedByCard(me, game([me]), everyoneHasCard)).toEqual({
      kind: "none",
    });
  });

  it("self-elimination shows no card", () => {
    const me = player("ME000001", { killedBy: "ME000001" });
    expect(eliminatedByCard(me, game([me]), everyoneHasCard)).toEqual({
      kind: "none",
    });
  });
});

describe("winnerCard", () => {
  it("player winner with a card", () => {
    const w = player("WIN00001");
    expect(
      winnerCard(["player", "WIN00001"], game([w]), everyoneHasCard),
    ).toEqual({ kind: "winner", clientID: "WIN00001" });
  });

  it("winner without a card gives none", () => {
    const w = player("WIN00001");
    expect(winnerCard(["player", "WIN00001"], game([w]), () => false)).toEqual({
      kind: "none",
    });
  });

  it("team win picks most tiles", () => {
    const a = player("AAAAAAAA", { team: "Red", tiles: 100 });
    const b = player("BBBBBBBB", { team: "Red", tiles: 300 });
    const c = player("CCCCCCCC", { team: "Blue", tiles: 900 });
    expect(
      winnerCard(["team", "Red"], game([a, b, c]), everyoneHasCard),
    ).toEqual({ kind: "winner", clientID: "BBBBBBBB" });
  });

  it("tie picks lowest clientID", () => {
    const a = player("ZZZZZZZZ", { team: "Red", tiles: 300 });
    const b = player("BBBBBBBB", { team: "Red", tiles: 300 });
    expect(winnerCard(["team", "Red"], game([a, b]), everyoneHasCard)).toEqual({
      kind: "winner",
      clientID: "BBBBBBBB",
    });
  });

  it("team top player without a card gives none", () => {
    const a = player("AAAAAAAA", { team: "Red", tiles: 100 });
    const b = player("BBBBBBBB", { team: "Red", tiles: 300 });
    expect(
      winnerCard(["team", "Red"], game([a, b]), (id) => id === "AAAAAAAA"),
    ).toEqual({ kind: "none" });
  });

  it("bots on the winning team are not candidates", () => {
    const bot = player("BOT00001", {
      team: "Red",
      tiles: 999,
      type: PlayerType.Bot,
    });
    const a = player("AAAAAAAA", { team: "Red", tiles: 100 });
    expect(
      winnerCard(["team", "Red"], game([bot, a]), everyoneHasCard),
    ).toEqual({ kind: "winner", clientID: "AAAAAAAA" });
  });

  it("clan wars win gives clan card", () => {
    const a = player("AAAAAAAA", { team: "Red", tiles: 100, clanTag: "UN" });
    const b = player("BBBBBBBB", { team: "Red", tiles: 300, clanTag: "UN" });
    expect(
      winnerCard(
        ["team", "Red"],
        game([a, b], RankedType.ClanWars),
        () => false,
      ),
    ).toEqual({ kind: "clan", clanTag: "UN", team: "Red" });
  });

  it("clan wars win with mixed tags falls back to the top player", () => {
    const a = player("AAAAAAAA", { team: "Red", tiles: 100, clanTag: "UN" });
    const b = player("BBBBBBBB", { team: "Red", tiles: 300, clanTag: "XX" });
    expect(
      winnerCard(
        ["team", "Red"],
        game([a, b], RankedType.ClanWars),
        everyoneHasCard,
      ),
    ).toEqual({ kind: "winner", clientID: "BBBBBBBB" });
  });

  it("nation win gives none", () => {
    expect(winnerCard(["nation", "France"], game([]), everyoneHasCard)).toEqual(
      { kind: "none" },
    );
  });

  it("cancelled gives none", () => {
    expect(winnerCard(undefined, game([]), everyoneHasCard)).toEqual({
      kind: "none",
    });
  });
});
