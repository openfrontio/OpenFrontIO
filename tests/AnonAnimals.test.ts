import { ANON_ANIMALS, anonAnimalName } from "../src/core/AnonAnimals";
import { UsernameSchema } from "../src/core/Schemas";
import { MAX_USERNAME_LENGTH } from "../src/core/validations/username";

// genAnonUsername (in client/UsernameInput) builds "Anon" + animal + one digit
// from this bank. It isn't imported here (it pulls in lit); instead we assert
// that EVERY handle it can emit is wire-valid, which is the property that matters.
describe("ANON_ANIMALS", () => {
  it("has 80 unique, single-word entries", () => {
    expect(ANON_ANIMALS.length).toBe(80);
    expect(new Set(ANON_ANIMALS).size).toBe(ANON_ANIMALS.length);
    for (const a of ANON_ANIMALS) expect(a).toMatch(/^[A-Z][a-z]+$/);
  });

  it("yields a wire-valid username for every animal × digit (0-9)", () => {
    for (const animal of ANON_ANIMALS) {
      for (let d = 0; d < 10; d++) {
        const name = `Anon${animal}${d}`;
        expect(name.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
        expect(UsernameSchema.safeParse(name).success).toBe(true);
      }
    }
  });
});

describe("anonAnimalName", () => {
  it("is deterministic in the hash", () => {
    expect(anonAnimalName(12345)).toBe(anonAnimalName(12345));
  });

  it("always produces an Anon+animal+3-digit, wire-valid handle", () => {
    for (let h = 0; h < 5000; h++) {
      const name = anonAnimalName(h);
      expect(name).toMatch(/^Anon[A-Z][a-z]+\d{3}$/);
      expect(UsernameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("covers the full 80 × 1000 space across distinct hashes", () => {
    const seen = new Set<string>();
    for (let h = 0; h < ANON_ANIMALS.length * 1000; h++)
      seen.add(anonAnimalName(h));
    expect(seen.size).toBe(ANON_ANIMALS.length * 1000);
  });
});
