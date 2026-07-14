import { ANON_ANIMALS, anonAnimalName } from "../src/core/AnonAnimals";
import { UsernameSchema } from "../src/core/Schemas";
import { MAX_USERNAME_LENGTH } from "../src/core/validations/username";

describe("ANON_ANIMALS", () => {
  it("has 80 unique, single-word entries", () => {
    expect(ANON_ANIMALS.length).toBe(80);
    expect(new Set(ANON_ANIMALS).size).toBe(ANON_ANIMALS.length);
    for (const a of ANON_ANIMALS) expect(a).toMatch(/^[A-Z][a-z]+$/);
  });
});

describe("anonAnimalName", () => {
  it("is deterministic in (slot, offset)", () => {
    expect(anonAnimalName(5, 3)).toBe(anonAnimalName(5, 3));
  });

  it("names the first 80 slots bare, then counts the round up", () => {
    expect(anonAnimalName(0, 0)).toBe(`Anon${ANON_ANIMALS[0]}`);
    expect(anonAnimalName(79, 0)).toBe(`Anon${ANON_ANIMALS[79]}`);
    expect(anonAnimalName(80, 0)).toBe(`Anon${ANON_ANIMALS[0]}1`);
    expect(anonAnimalName(160, 0)).toBe(`Anon${ANON_ANIMALS[0]}2`);
  });

  it("NEVER collides for distinct slots at a fixed offset (the guarantee)", () => {
    for (const offset of [0, 7, 12345]) {
      const names = new Set<string>();
      for (let slot = 0; slot < 250; slot++)
        names.add(anonAnimalName(slot, offset));
      expect(names.size).toBe(250); // 250 distinct players → 250 distinct names
    }
  });

  it("varies by offset (per-viewer): same slot, different viewers → different name", () => {
    const slot = 3;
    const names = new Set(
      Array.from({ length: 25 }, (_, v) => anonAnimalName(slot, v * 101)),
    );
    expect(names.size).toBeGreaterThan(1);
  });

  it("always produces a wire-valid handle within length limits", () => {
    for (let slot = 0; slot < ANON_ANIMALS.length * 3; slot++) {
      const name = anonAnimalName(slot, 999);
      expect(name).toMatch(/^Anon[A-Z][a-z]+\d*$/);
      expect(name.length).toBeLessThanOrEqual(MAX_USERNAME_LENGTH);
      expect(UsernameSchema.safeParse(name).success).toBe(true);
    }
  });
});
