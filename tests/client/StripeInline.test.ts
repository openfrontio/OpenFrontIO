import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    env: vi.fn(),
    stripePublishableKey: vi.fn(),
  },
}));

vi.mock("../../src/client/Payments", () => ({
  paymentsProvider: vi.fn(() => "stripe"),
  createInlinePaymentIntent: vi.fn(),
}));

import { ClientEnv } from "../../src/client/ClientEnv";
import { paymentsProvider } from "../../src/client/Payments";
import {
  stripeInlineAvailable,
  stripeKeyMatchesEnv,
  stripePublishableKey,
} from "../../src/client/StripeInline";
import { GameEnv } from "../../src/core/configuration/Config";

const envMock = ClientEnv.env as unknown as ReturnType<typeof vi.fn>;
const keyMock = ClientEnv.stripePublishableKey as unknown as ReturnType<
  typeof vi.fn
>;
const providerMock = paymentsProvider as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  envMock.mockReturnValue(GameEnv.Preprod);
  keyMock.mockReturnValue("pk_test_abc");
  providerMock.mockReturnValue("stripe");
});

describe("stripePublishableKey", () => {
  it("is null when the page carried no key", () => {
    keyMock.mockReturnValue(undefined);
    expect(stripePublishableKey()).toBeNull();
    keyMock.mockReturnValue("");
    expect(stripePublishableKey()).toBeNull();
  });

  it("returns the page's key", () => {
    expect(stripePublishableKey()).toBe("pk_test_abc");
  });

  // stripeInlineAvailable is a render-path gate; a page with no usable
  // BOOTSTRAP_CONFIG (ClientEnv.get() throws) must read as "no key", not
  // blow up the component render that asked.
  it("is null when the page has no BOOTSTRAP_CONFIG", () => {
    keyMock.mockImplementation(() => {
      throw new Error("Missing BOOTSTRAP_CONFIG");
    });
    expect(stripePublishableKey()).toBeNull();
    expect(stripeInlineAvailable()).toBe(false);
  });
});

describe("stripeKeyMatchesEnv", () => {
  it("accepts a live key only on prod", () => {
    expect(stripeKeyMatchesEnv("pk_live_abc", GameEnv.Prod)).toBe(true);
    expect(stripeKeyMatchesEnv("pk_live_abc", GameEnv.Preprod)).toBe(false);
    expect(stripeKeyMatchesEnv("pk_live_abc", GameEnv.Dev)).toBe(false);
  });

  it("accepts a test key everywhere except prod", () => {
    expect(stripeKeyMatchesEnv("pk_test_abc", GameEnv.Prod)).toBe(false);
    expect(stripeKeyMatchesEnv("pk_test_abc", GameEnv.Preprod)).toBe(true);
    expect(stripeKeyMatchesEnv("pk_test_abc", GameEnv.Dev)).toBe(true);
  });
});

describe("stripeInlineAvailable", () => {
  it("is on when the page's key matches the environment's mode", () => {
    expect(stripeInlineAvailable()).toBe(true);
    envMock.mockReturnValue(GameEnv.Prod);
    keyMock.mockReturnValue("pk_live_abc");
    expect(stripeInlineAvailable()).toBe(true);
  });

  it("is off with no key", () => {
    keyMock.mockReturnValue(undefined);
    expect(stripeInlineAvailable()).toBe(false);
  });

  it("is off when the key's mode disagrees with the environment", () => {
    envMock.mockReturnValue(GameEnv.Prod);
    expect(stripeInlineAvailable()).toBe(false);
  });

  it("is off on the Steam rail", () => {
    providerMock.mockReturnValue("steam");
    expect(stripeInlineAvailable()).toBe(false);
  });
});
