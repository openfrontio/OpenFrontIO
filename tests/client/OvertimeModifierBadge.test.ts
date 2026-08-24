import { describe, expect, it } from "vitest";
import { getActiveModifiers } from "../../src/client/Utils";

// Overtime runs as a public FFA modifier, so an active isOvertime modifier
// must surface a lobby badge like every other rotation modifier.
describe("overtime public modifier", () => {
  it("surfaces an overtime badge when the modifier is active", () => {
    const mods = getActiveModifiers({ isOvertime: true });
    expect(mods).toHaveLength(1);
    expect(mods[0].badgeKey).toBe("public_game_modifier.overtime");
    expect(mods[0].labelKey).toBe("overtime.title");
  });

  it("omits the badge when the modifier is absent", () => {
    expect(getActiveModifiers({})).toHaveLength(0);
    expect(getActiveModifiers({ isOvertime: false })).toHaveLength(0);
  });
});
