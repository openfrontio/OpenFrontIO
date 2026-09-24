import { describe, expect, it } from "vitest";
import "../../src/client/components/ListLobbyDialog";
import { ListLobbyDialog } from "../../src/client/components/ListLobbyDialog";
import {
  MAX_HOSTED_LOBBY_PLAYERS,
  MIN_HOSTED_LOBBY_PLAYERS,
} from "../../src/core/Schemas";

function dialog(currentPlayers: number): ListLobbyDialog {
  const el = document.createElement("list-lobby-dialog") as ListLobbyDialog;
  el.currentPlayers = currentPlayers;
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
});
