import { Game } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";

describe("RandomGeneration", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("plains");
  });

  describe("createRandom", () => {
    it("should generate different seeds for different unique IDs", () => {
      const random1 = game.createRandom("test1");
      const random2 = game.createRandom("test2");

      const value1 = random1.next();
      const value2 = random2.next();

      expect(value1).not.toBe(value2);
    });

    it("should generate different seeds for same ID called multiple times", () => {
      const random1 = game.createRandom("test");
      const random2 = game.createRandom("test");

      const value1 = random1.next();
      const value2 = random2.next();

      expect(value1).not.toBe(value2);
    });

    it("should generate consistent random sequences for the same seed", () => {
      const seed = 12345;
      const random1 = new PseudoRandom(seed);
      const random2 = new PseudoRandom(seed);

      expect(random1.next()).toBe(random2.next());
      expect(random1.next()).toBe(random2.next());
      expect(random1.nextInt(0, 100)).toBe(random2.nextInt(0, 100));
    });

    it("should use location-based unique IDs effectively", () => {
      const portRandom1 = game.createRandom(`port_5_5`);
      const portRandom2 = game.createRandom(`port_7_8`);
      const warshipRandom = game.createRandom(`warship_3_4`);

      const val1 = portRandom1.next();
      const val2 = portRandom2.next();
      const val3 = warshipRandom.next();

      expect(val1).not.toBe(val2);
      expect(val2).not.toBe(val3);
      expect(val1).not.toBe(val3);
    });

    it("should handle many random generators without collisions", () => {
      const randoms: PseudoRandom[] = [];
      const values: Set<number> = new Set();

      for (let i = 0; i < 100; i++) {
        const random = game.createRandom(`test_${i}`);
        randoms.push(random);

        const value = random.next();
        values.add(value);
      }

      expect(values.size).toBeGreaterThan(90);
    });
  });

  describe("Execution integration", () => {
    it("should prevent synchronized patterns in same-tick creations", () => {
      const random1 = game.createRandom(`port_0_0`);
      const random2 = game.createRandom(`port_1_1`);
      const random3 = game.createRandom(`warship_2_2`);

      const val1 = random1.nextInt(0, 1000);
      const val2 = random2.nextInt(0, 1000);
      const val3 = random3.nextInt(0, 1000);

      const allSame = val1 === val2 && val2 === val3;
      expect(allSame).toBe(false);
    });
  });
});
