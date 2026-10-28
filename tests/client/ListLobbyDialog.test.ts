import { Duos, Quads, Trios } from "@openfront/engine-api/game/GameTypes";
import { TeamCountConfig } from "@openfront/engine-api/Schemas";
import {
  MAX_HOSTED_LOBBY_PLAYERS,
  MIN_HOSTED_LOBBY_PLAYERS,
} from "@openfront/shared/WireSchemas";
import { describe, expect, it } from "vitest";
// The class is used as a type below, so this import is needed for registration.
// oxlint-disable-next-line import/no-duplicates -- Required custom-element registration.
import "../../src/client/components/ListLobbyDialog";
import { ListLobbyDialog } from "../../src/client/components/ListLobbyDialog";

function dialog(
  currentPlayers: number,
  playerTeams?: TeamCountConfig,
): ListLobbyDialog {
  const el = document.createElement("list-lobby-dialog") as ListLobbyDialog;
  el.currentPlayers = currentPlayers;
  el.playerTeams = playerTeams;
  return el;
}

const minPlayers = (el: ListLobbyDialog): number =>
  (el as unknown as { minPlayers(): number }).minPlayers();

describe("ListLobbyDialog player cap", () => {
  it("never offers a cap below MIN_HOSTED_LOBBY_PLAYERS", () => {
    expect(MIN_HOSTED_LOBBY_PLAYERS).toBe(10);
    expect(minPlayers(dialog(1))).toBe(MIN_HOSTED_LOBBY_PLAYERS);
  });

  it("leaves room for one more player than are already seated", () => {
    expect(minPlayers(dialog(30))).toBe(31);
  });

  it("stays within the maximum", () => {
    expect(minPlayers(dialog(MAX_HOSTED_LOBBY_PLAYERS + 5))).toBe(
      MAX_HOSTED_LOBBY_PLAYERS,
    );
  });

  it("rounds up to the next full team multiple for preset team sizes", () => {
    // Quads (size 4): 8 and 9 seated would otherwise produce floor 10,
    // which aligns to 8 and gets rejected by the server.
    expect(minPlayers(dialog(8, Quads))).toBe(12);
    expect(minPlayers(dialog(9, Quads))).toBe(12);

    // Trios (size 3): 9 seated would otherwise produce floor 10,
    // which aligns to 9 and gets rejected by the server.
    expect(minPlayers(dialog(1, Trios))).toBe(12);
    expect(minPlayers(dialog(9, Trios))).toBe(12);

    // Duos (size 2): 9 seated produces floor 10 (valid duo multiple);
    // 10 seated produces floor 12.
    expect(minPlayers(dialog(9, Duos))).toBe(10);
    expect(minPlayers(dialog(10, Duos))).toBe(12);

    // Numeric team counts (e.g. 2 teams) do not enforce preset team sizes.
    expect(minPlayers(dialog(8, 2))).toBe(MIN_HOSTED_LOBBY_PLAYERS);
  });
});

describe("ListLobbyDialog suggested cap", () => {
  const cap = (el: ListLobbyDialog): number =>
    (el as unknown as { maxPlayers: number }).maxPlayers;

  async function suggested(value: number | undefined) {
    const el = dialog(1);
    el.suggestedMaxPlayers = value;
    document.body.appendChild(el);
    await el.updateComplete;
    el.remove();
    return el;
  }

  it("starts at the host's player limit", async () => {
    expect(cap(await suggested(25))).toBe(25);
  });

  it("starts at the maximum without one, or when it is above the maximum", async () => {
    expect(cap(await suggested(undefined))).toBe(MAX_HOSTED_LOBBY_PLAYERS);
    expect(cap(await suggested(500))).toBe(MAX_HOSTED_LOBBY_PLAYERS);
  });
});
