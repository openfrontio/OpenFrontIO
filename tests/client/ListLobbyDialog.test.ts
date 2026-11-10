import { Duos, Quads, Trios } from "@openfront/engine-api/game/GameTypes";
import { TeamCountConfig } from "@openfront/engine-api/Schemas";
import {
  hostedLobbyMaxPlayers,
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
  el.maxAllowedPlayers = MAX_ALLOWED;
  return el;
}

const MAX_ALLOWED = 100;

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
    expect(minPlayers(dialog(MAX_ALLOWED + 5))).toBe(MAX_ALLOWED);
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
    (el as unknown as { selectedMaxPlayers(): number }).selectedMaxPlayers();

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
    expect(cap(await suggested(undefined))).toBe(MAX_ALLOWED);
    expect(cap(await suggested(500))).toBe(MAX_ALLOWED);
  });

  it("allows past 100 on maps whose public lobbies do", async () => {
    const el = await suggested(undefined);
    el.maxAllowedPlayers = 210;
    expect(cap(el)).toBe(210);
  });
});

describe("hostedLobbyMaxPlayers", () => {
  it("matches the biggest public lobby for the map", () => {
    // The Box: 4,194,304 land tiles, whose public lobbies reach 210.
    expect(hostedLobbyMaxPlayers(4_194_304, false)).toBe(210);
    expect(hostedLobbyMaxPlayers(1_000_000, false)).toBe(50);
  });

  it("takes a quarter on compact maps", () => {
    expect(hostedLobbyMaxPlayers(4_194_304, true)).toBe(52);
  });

  it("never drops below the minimum listing cap", () => {
    expect(hostedLobbyMaxPlayers(10_000, false)).toBe(MIN_HOSTED_LOBBY_PLAYERS);
    expect(hostedLobbyMaxPlayers(400_000, true)).toBe(MIN_HOSTED_LOBBY_PLAYERS);
  });
});
