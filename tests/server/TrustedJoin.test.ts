import { describe, expect, it } from "vitest";
import { GameType } from "../../src/core/game/Game";
import {
  cid,
  makeClient as harnessClient,
  makeGame as harnessGame,
} from "../util/GameServerHarness";

const C1 = cid("t1");
const C2 = cid("t2");
const C3 = cid("t3");

function makeClient(
  clientID: string,
  persistentID: string,
  trusted: boolean,
  role: string | null = null,
) {
  return harnessClient({
    clientID,
    persistentID,
    trusted,
    role,
    username: "TestUser",
  });
}

function makeGame(trusted?: boolean) {
  return harnessGame({
    config: {
      gameType: GameType.Private,
      ...(trusted === undefined ? {} : { trusted }),
    },
  });
}

describe("GameServer - trusted-only lobbies (GameConfig.trusted)", () => {
  it("admits trusted accounts and rejects untrusted ones", () => {
    const game = makeGame(true);
    expect(game.joinClient(makeClient(C1, "p1", true))).toBe("joined");
    expect(game.joinClient(makeClient(C2, "p2", false))).toBe("not_trusted");
  });

  it("lets admins and root bypass the gate", () => {
    const game = makeGame(true);
    expect(game.joinClient(makeClient(C1, "p1", false, "admin"))).toBe(
      "joined",
    );
    expect(game.joinClient(makeClient(C2, "p2", false, "root"))).toBe("joined");
  });

  it("does not let mod or unknown roles bypass the gate", () => {
    const game = makeGame(true);
    expect(game.joinClient(makeClient(C1, "p1", false, "mod"))).toBe(
      "not_trusted",
    );
    expect(game.joinClient(makeClient(C2, "p2", false, "flagged"))).toBe(
      "not_trusted",
    );
  });

  it("does not restrict joins when trusted is unset or false", () => {
    expect(makeGame().joinClient(makeClient(C1, "p1", false))).toBe("joined");
    expect(makeGame(false).joinClient(makeClient(C2, "p2", false))).toBe(
      "joined",
    );
  });

  it("applies the gate once update_game_config turns it on", () => {
    const game = makeGame();
    game.updateGameConfig({ trusted: true });
    expect(game.gameConfig.trusted).toBe(true);
    expect(game.joinClient(makeClient(C1, "p1", false))).toBe("not_trusted");
    expect(game.joinClient(makeClient(C2, "p2", true))).toBe("joined");
  });

  it("checks the allowlist before trust", () => {
    const game = harnessGame({
      config: {
        gameType: GameType.Private,
        trusted: true,
        allowedPublicIds: ["pub-ok"],
      },
    });
    expect(
      game.joinClient(
        harnessClient({
          clientID: C3,
          persistentID: "p3",
          publicId: "pub-no",
          trusted: true,
          username: "TestUser",
        }),
      ),
    ).toBe("not_allowlisted");
  });
});
