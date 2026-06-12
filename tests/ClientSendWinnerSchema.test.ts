import { ClientSendWinnerSchema } from "../src/core/Schemas";

describe("ClientSendWinnerSchema", () => {
  // ID must match /^[A-Za-z0-9]{8}$/
  const id1 = "AAAAAAAA";
  const id2 = "BBBBBBBB";
  const validWinner = ["player", id1, id2] as const;

  test("accepts a winner message without allPlayersStats", () => {
    const result = ClientSendWinnerSchema.safeParse({
      type: "winner",
      winner: validWinner,
    });
    expect(result.success).toBe(true);
  });

  test("accepts a winner message with allPlayersStats (singleplayer path)", () => {
    const result = ClientSendWinnerSchema.safeParse({
      type: "winner",
      winner: validWinner,
      allPlayersStats: {
        [id1]: {},
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a winner message with undefined winner (draw)", () => {
    const result = ClientSendWinnerSchema.safeParse({
      type: "winner",
      winner: undefined,
    });
    expect(result.success).toBe(true);
  });

  test("rejects a message with wrong type", () => {
    const result = ClientSendWinnerSchema.safeParse({
      type: "not_winner",
      winner: validWinner,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a message with invalid winner format", () => {
    const result = ClientSendWinnerSchema.safeParse({
      type: "winner",
      winner: "invalid",
    });
    expect(result.success).toBe(false);
  });

  test("allPlayersStats is absent (undefined) when not provided by sender", () => {
    const result = ClientSendWinnerSchema.safeParse({
      type: "winner",
      winner: validWinner,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allPlayersStats).toBeUndefined();
    }
  });
});
