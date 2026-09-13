import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameType } from "../../src/core/game/Game";
import {
  cid,
  makeClient as harnessClient,
  makeGame as harnessGame,
  mockWsOf,
} from "../util/GameServerHarness";

const C1 = cid("c1");
const C1B = cid("c1b");
const C2 = cid("c2");
const C3 = cid("c3");

function makeClient(
  clientID: string,
  persistentID: string,
  publicId: string | undefined,
  role: string | null = null,
) {
  return harnessClient({
    clientID,
    persistentID,
    publicId,
    role,
    username: "TestUser",
  });
}

describe("GameServer - allowlist (allowedPublicIds)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function makeGame(allowedPublicIds?: string[]) {
    return harnessGame({
      config: {
        gameType: GameType.Private,
        ...(allowedPublicIds ? { allowedPublicIds } : {}),
      },
    });
  }

  it("admits only listed publicIds and rejects others", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.joinClient(makeClient(C1, "p1", "pub-ok"))).toBe("joined");
    expect(game.joinClient(makeClient(C2, "p2", "pub-no"))).toBe(
      "not_allowlisted",
    );
    expect(game.joinClient(makeClient(C3, "p3", undefined))).toBe(
      "not_allowlisted",
    );
  });

  it("lets admins and root bypass the allowlist", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.joinClient(makeClient(C1, "p1", "pub-no", "admin"))).toBe(
      "joined",
    );
    expect(game.joinClient(makeClient(C2, "p2", "pub-no", "root"))).toBe(
      "joined",
    );
    // No publicId at all (anonymous persistent-ID join) still bypasses.
    expect(game.joinClient(makeClient(C3, "p3", undefined, "admin"))).toBe(
      "joined",
    );
  });

  it("does not let mod or unknown roles bypass the allowlist", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.joinClient(makeClient(C1, "p1", "pub-no", "mod"))).toBe(
      "not_allowlisted",
    );
    expect(game.joinClient(makeClient(C2, "p2", "pub-no", "flagged"))).toBe(
      "not_allowlisted",
    );
  });

  it("still keeps a kicked admin out of an allowlisted lobby", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.joinClient(makeClient(C1, "p1", "pub-no", "admin"))).toBe(
      "joined",
    );
    game.kickClient(C1);
    expect(game.joinClient(makeClient(C1B, "p1", "pub-no", "admin"))).toBe(
      "kicked",
    );
  });

  it("does not restrict joins when no allowlist is set", () => {
    const game = makeGame();
    expect(game.joinClient(makeClient(C1, "p1", "anything"))).toBe("joined");
  });

  it("treats an empty allowlist as no restriction", () => {
    const game = makeGame([]);
    expect(game.joinClient(makeClient(C1, "p1", "anything"))).toBe("joined");
  });

  it("lets a previously-rejected player in once the allowlist is cleared", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.joinClient(makeClient(C2, "p2", "pub-no"))).toBe(
      "not_allowlisted",
    );
    game.updateGameConfig({ allowedPublicIds: [] });
    expect(game.joinClient(makeClient(C2, "p2", "pub-no"))).toBe("joined");
  });

  it("keeps allowedPublicIds on the stored config (read like other settings)", () => {
    const game = makeGame(["pub-ok"]);
    expect(game.gameConfig.allowedPublicIds).toEqual(["pub-ok"]);
  });

  it("keeps publicId lists out of the start info (wire + archived record)", () => {
    const game = harnessGame({
      config: {
        gameType: GameType.Private,
        allowedPublicIds: ["pub-ok"],
        nameRevealPublicIds: ["pub-reveal"],
      },
    });
    const c1 = makeClient(C1, "p1", "pub-ok");
    expect(game.joinClient(c1)).toBe("joined");
    game.start();

    // The start message carries the same config object the archive reads.
    const start = mockWsOf(c1)
      .sent()
      .find((m) => m.type === "start");
    expect(start).toBeDefined();
    const config = start!.type === "start" ? start!.gameStartInfo.config : null;
    expect(config?.allowedPublicIds).toBeUndefined();
    expect(config?.nameRevealPublicIds).toBeUndefined();
    // The server still enforces the allowlist from its own config.
    expect(game.gameConfig.allowedPublicIds).toEqual(["pub-ok"]);
  });
});
