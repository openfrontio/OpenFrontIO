import { beforeEach, describe, expect, it, vi } from "vitest";

// validateUsername() builds its error strings via translateText on the invalid
// path; mock it to predictable keys so this test doesn't depend on loaded
// translations. generateCryptoRandomUUID is stubbed because UsernameInput
// imports it (only used by genAnonUsername, which these tests don't exercise).
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, vars?: unknown) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  generateCryptoRandomUUID: () => "00000000-0000-0000-0000-000000000000",
}));

import { UsernameInput } from "../../src/client/UsernameInput";

describe("UsernameInput.setUsername (?username= prefill)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("applies and persists a valid username", () => {
    const input = new UsernameInput();

    expect(input.setUsername("Aevann")).toBe(true);
    expect(input.getUsername()).toBe("Aevann");
    expect(localStorage.getItem("username")).toBe("Aevann");
    expect(input.canPlay()).toBe(true);
  });

  it("trims surrounding whitespace before applying", () => {
    const input = new UsernameInput();

    expect(input.setUsername("  Bob  ")).toBe(true);
    expect(input.getUsername()).toBe("Bob");
    expect(localStorage.getItem("username")).toBe("Bob");
  });

  it("strips reserved brackets so a clan tag cannot be spoofed", () => {
    const input = new UsernameInput();

    expect(input.setUsername("[ADMIN] hi")).toBe(true);
    expect(input.getUsername()).toBe("ADMIN hi");
  });

  it("ignores a too-short value and keeps the existing name", () => {
    const input = new UsernameInput();
    input.setUsername("ValidName");

    expect(input.setUsername("ab")).toBe(false);
    expect(input.getUsername()).toBe("ValidName");
    expect(localStorage.getItem("username")).toBe("ValidName");
  });

  it("ignores a value with disallowed characters", () => {
    const input = new UsernameInput();
    input.setUsername("ValidName");

    expect(input.setUsername("Invalid!Name#")).toBe(false);
    expect(input.getUsername()).toBe("ValidName");
  });

  it("ignores an empty parameter value", () => {
    const input = new UsernameInput();
    input.setUsername("ValidName");

    expect(input.setUsername("")).toBe(false);
    expect(input.getUsername()).toBe("ValidName");
  });

  it("ignores a value longer than the max length", () => {
    const input = new UsernameInput();
    input.setUsername("ValidName");

    expect(input.setUsername("a".repeat(28))).toBe(false);
    expect(input.getUsername()).toBe("ValidName");
  });
});
