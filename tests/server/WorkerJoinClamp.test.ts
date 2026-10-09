import { MAX_USERNAME_LENGTH } from "@openfront/engine-api/Schemas";
import { describe, expect, it } from "vitest";
import { clampApprovedUsername } from "../../src/server/Worker";
import { cid, makeClient, makeGame } from "../util/GameServerHarness";

describe("Worker join username clamping", () => {
  it("clamps an approved 21-character username to exactly 20 characters before Client/GameServer", () => {
    const approved21 = "a".repeat(21);
    const clamped = clampApprovedUsername(approved21);
    expect(clamped).toHaveLength(MAX_USERNAME_LENGTH);
    expect(clamped).toBe("a".repeat(MAX_USERNAME_LENGTH));

    // Verify the joined client stores exactly 20 characters
    const client = makeClient({
      clientID: cid("ctest"),
      username: clamped,
    });
    expect(client.username).toBe("a".repeat(MAX_USERNAME_LENGTH));
    expect(client.username).toHaveLength(20);

    const game = makeGame();
    expect(game.joinClient(client)).toBe("joined");
    const stored = game
      .gameInfo()
      .clients?.find((c) => c.clientID === client.clientID);
    expect(stored?.username).toBe("a".repeat(MAX_USERNAME_LENGTH));
    expect(stored?.username).toHaveLength(20);
  });

  it("leaves an approved username within the limit untouched", () => {
    const valid = "player_one";
    expect(clampApprovedUsername(valid)).toBe(valid);
  });

  it("trims trailing whitespace when clamped", () => {
    const withSpace = "a".repeat(MAX_USERNAME_LENGTH - 1) + " bcd";
    const clamped = clampApprovedUsername(withSpace);
    expect(clamped).toBe("a".repeat(MAX_USERNAME_LENGTH - 1));
    expect(clamped.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
  });
});
