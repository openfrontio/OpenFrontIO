import {
  MAX_HOSTED_LOBBY_PLAYERS,
  MIN_HOSTED_LOBBY_PLAYERS,
} from "@openfront/shared/WireSchemas";
import { describe, expect, it } from "vitest";
import "../../src/client/components/ListLobbyDialog";
import { ListLobbyDialog } from "../../src/client/components/ListLobbyDialog";

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
