import { beforeEach, describe, expect, it } from "vitest";
import { claimGameClientReload } from "../../src/client/GameClientLoader";

describe("claimGameClientReload", () => {
  beforeEach(() => sessionStorage.clear());

  it("allows the first reload", () => {
    expect(claimGameClientReload(1_000_000)).toBe(true);
  });

  // The desktop loop: the chunk is missing for good, so a reload lands on the
  // same failure and would reload again, forever and without a word.
  it("refuses a second reload soon after the first", () => {
    claimGameClientReload(1_000_000);
    expect(claimGameClientReload(1_000_000 + 60_000)).toBe(false);
  });

  it("allows another reload once the window has passed", () => {
    claimGameClientReload(1_000_000);
    expect(claimGameClientReload(1_000_000 + 5 * 60 * 1000)).toBe(true);
  });
});
