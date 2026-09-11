import { randomFillSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCryptoRandomUUID } from "../../src/client/Utils";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateCryptoRandomUUID", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });
    expect(generateCryptoRandomUUID()).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("builds a v4 uuid from getRandomValues when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => randomFillSync(array),
    });
    expect(generateCryptoRandomUUID()).toMatch(UUID_V4);
  });

  it("falls back to Math.random when crypto offers neither", () => {
    vi.stubGlobal("crypto", {});
    expect(generateCryptoRandomUUID()).toMatch(UUID_V4);
  });
});
