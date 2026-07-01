import { UnitType } from "../src/core/game/Game";
import { ClientMessageSchema } from "../src/core/Schemas";

const VALID_ID = "ABCDEFGH";

function parseIntent(intent: unknown) {
  return ClientMessageSchema.safeParse({
    type: "intent",
    intent,
  });
}

describe("Client intent schema", () => {
  test.each([
    [{ type: "spawn", tile: 0.5 }],
    [{ type: "build_unit", unit: UnitType.City, tile: 0.5 }],
    [{ type: "boat", troops: 100, dst: 0.5 }],
    [{ type: "move_warship", unitIds: [1], tile: 0.5 }],
    [{ type: "move_warship", unitIds: [1.5], tile: 1 }],
    [{ type: "upgrade_structure", unit: UnitType.City, unitId: 1.5 }],
    [{ type: "cancel_boat", unitID: 1.5 }],
    [{ type: "delete_unit", unitId: 1.5 }],
  ])("rejects non-integer tile and unit references %#", (intent) => {
    expect(parseIntent(intent).success).toBe(false);
  });

  test.each([
    [{ type: "attack", targetID: VALID_ID, troops: 1e308 }],
    [{ type: "boat", troops: 1e308, dst: 1 }],
    [{ type: "donate_gold", recipient: VALID_ID, gold: 1e308 }],
    [{ type: "donate_troops", recipient: VALID_ID, troops: 1e308 }],
  ])("rejects unsafe numeric resource amounts %#", (intent) => {
    expect(parseIntent(intent).success).toBe(false);
  });

  test("accepts valid finite resource amounts and integer refs", () => {
    expect(
      parseIntent({ type: "attack", targetID: VALID_ID, troops: 10.5 }).success,
    ).toBe(true);
    expect(parseIntent({ type: "spawn", tile: 0 }).success).toBe(true);
    expect(
      parseIntent({
        type: "build_unit",
        unit: UnitType.City,
        tile: 12,
      }).success,
    ).toBe(true);
  });
});
