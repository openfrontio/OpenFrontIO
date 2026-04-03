import {
  getLocalWalletDebugUserMe,
  purchasePatternWithWallet,
} from "../src/client/Api";
import { UserMeResponseSchema } from "../src/core/ApiSchemas";
import { ProductSchema } from "../src/core/CosmeticSchemas";

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

  test("parses wallet-priced products", () => {
    const result = ProductSchema.safeParse({
      walletPrice: {
        currency: "premium",
        amount: "250",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected wallet-priced product to parse");
    }

    expect(result.data.walletPrice?.currency).toBe("premium");
    expect(result.data.walletPrice?.amount).toBe(250n);
  });

  test("localhost wallet purchase deducts balance and grants flare", async () => {
    localStorage.setItem(
      "debug.walletBalances",
      JSON.stringify({
        premium: "300",
        standard: "10",
        email: "wallet-test@example.com",
        publicId: "wallet-test-player",
        flares: [],
      }),
    );

    const result = await purchasePatternWithWallet(
      {
        patternName: "stripes_v",
        colorPaletteName: "sunset",
        currency: "premium",
        amount: 250n,
      },
      "localhost",
    );

    expect(result.ok).toBe(true);

    const userMe = getLocalWalletDebugUserMe("localhost");
    expect(userMe?.player.balances?.premium).toBe(50n);
    expect(userMe?.player.flares).toContain("pattern:stripes_v:sunset");
  });

  test("localhost wallet purchase rejects insufficient balance", async () => {
    localStorage.setItem(
      "debug.walletBalances",
      JSON.stringify({
        premium: "20",
        standard: "10",
        flares: [],
      }),
    );

    const result = await purchasePatternWithWallet(
      {
        patternName: "stripes_v",
        colorPaletteName: null,
        currency: "premium",
        amount: 250n,
      },
      "localhost",
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient_balance");

    const userMe = getLocalWalletDebugUserMe("localhost");
    expect(userMe?.player.balances?.premium).toBe(20n);
    expect(userMe?.player.flares ?? []).not.toContain("pattern:stripes_v");
  });
});
