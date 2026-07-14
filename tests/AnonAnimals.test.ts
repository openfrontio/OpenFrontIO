import { ANON_ANIMALS } from "../src/core/AnonAnimals";
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
