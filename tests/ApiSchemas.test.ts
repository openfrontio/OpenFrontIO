import { getLocalWalletDebugUserMe } from "../src/client/Api";
import { UserMeResponseSchema } from "../src/core/ApiSchemas";

describe("UserMeResponseSchema", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("parses legacy payloads without balances", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {
        email: "player@example.com",
      },
      player: {
        publicId: "player-123",
      },
    });

    expect(result.success).toBe(true);
  });

  test("parses mixed balance input formats", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {
        email: "player@example.com",
      },
      player: {
        publicId: "player-123",
        balances: {
          premium: "1250",
          standard: 85,
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected user payload with balances to parse");
    }

    expect(result.data.player.balances?.premium).toBe(1250n);
    expect(result.data.player.balances?.standard).toBe(85n);
  });

  test("rejects negative balances", () => {
    const result = UserMeResponseSchema.safeParse({
      user: {
        email: "player@example.com",
      },
      player: {
        publicId: "player-123",
        balances: {
          premium: -1,
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("parses localhost wallet debug override", () => {
    localStorage.setItem(
      "debug.walletBalances",
      JSON.stringify({
        premium: "1250",
        standard: 85,
        email: "wallet-test@example.com",
        publicId: "wallet-test-player",
      }),
    );

    const result = getLocalWalletDebugUserMe("localhost");

    expect(result).not.toBeNull();
    expect(result?.player.balances?.premium).toBe(1250n);
    expect(result?.player.balances?.standard).toBe(85n);
    expect(result?.user.email).toBe("wallet-test@example.com");
  });

  test("ignores wallet debug override off localhost", () => {
    localStorage.setItem(
      "debug.walletBalances",
      JSON.stringify({ premium: 10, standard: 5 }),
    );

    expect(getLocalWalletDebugUserMe("openfront.dev")).toBeNull();
  });
});
