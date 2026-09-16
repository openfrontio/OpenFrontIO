import { describe, expect, it } from "vitest";
import { getLobbyQueuePosition } from "../../src/client/LobbyQueue";
import type { PublicGameInfo, PublicGames } from "../../src/core/Schemas";

function lobby(
  gameID: string,
  publicGameType: PublicGameInfo["publicGameType"],
  startsAt?: number,
): PublicGameInfo {
  return { gameID, publicGameType, numClients: 0, startsAt };
}

describe("getLobbyQueuePosition", () => {
  it.each(["ffa", "team", "special"] as const)(
    "counts only waiting lobbies in the %s bucket, in server order",
    (type) => {
      const lobbies: PublicGames = {
        serverTime: 0,
        games: {
          ffa: [lobby("unrelated", "ffa")],
          team: [lobby("unrelated", "team")],
          special: [lobby("unrelated", "special")],
          [type]: [
            lobby("active", type, 0),
            lobby("first", type),
            lobby("second", type),
          ],
        },
      };
      expect(getLobbyQueuePosition(lobbies, "first")).toBe(1);
      expect(getLobbyQueuePosition(lobbies, "second")).toBe(2);
      expect(getLobbyQueuePosition(lobbies, "active")).toBeNull();
    },
  );

  it("has no position for missing snapshots, buckets, or lobbies", () => {
    expect(getLobbyQueuePosition(null, "missing")).toBeNull();
    expect(
      getLobbyQueuePosition({ serverTime: 0, games: {} }, "missing"),
    ).toBeNull();
    expect(
      getLobbyQueuePosition(
        { serverTime: 0, games: { ffa: [lobby("first", "ffa")] } },
        "missing",
      ),
    ).toBeNull();
  });

  it("does not number hosted lobbies", () => {
    expect(
      getLobbyQueuePosition(
        { serverTime: 0, games: { hosted: [lobby("hosted", "hosted")] } },
        "hosted",
      ),
    ).toBeNull();
  });
});
