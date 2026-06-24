import { UsernameSchema } from "../src/core/Schemas";
import { anonymousUsername } from "../src/core/Util";

describe("anonymousUsername", () => {
  it("always produces a wire-valid username", () => {
    for (let i = 0; i < 1000; i++) {
      const name = anonymousUsername(`client${i}` + `viewer${i % 13}`);
      expect(UsernameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("is deterministic per seed", () => {
    expect(anonymousUsername("abc")).toBe(anonymousUsername("abc"));
  });

  it("varies by viewer for the same player", () => {
    const player = "playerA";
    const names = new Set(
      Array.from({ length: 25 }, (_, v) =>
        anonymousUsername(player + "viewer" + v),
      ),
    );
    expect(names.size).toBeGreaterThan(1);
  });
});
