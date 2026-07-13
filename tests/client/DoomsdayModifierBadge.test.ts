import { describe, expect, it } from "vitest";
import { getActiveModifiers } from "../../src/client/Utils";

// The doomsday clock is part of the public "special" modifier rotation, so an
// active isDoomsdayClock modifier must surface a lobby badge like every other
// rotation modifier.
describe("doomsday clock public modifier", () => {
  it("surfaces a doomsday-clock badge when the modifier is active", () => {
    const mods = getActiveModifiers({ isDoomsdayClock: true });
    expect(mods).toHaveLength(1);
    expect(mods[0].badgeKey).toBe("public_game_modifier.doomsday_clock");
    expect(mods[0].labelKey).toBe("public_game_modifier.doomsday_clock_label");
  });

  it("omits the badge when the modifier is absent", () => {
    expect(getActiveModifiers({})).toHaveLength(0);
    expect(getActiveModifiers(undefined)).toHaveLength(0);
  });
});
