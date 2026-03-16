import {
  troopAttackColor,
  troopDefenceColor,
} from "../../../../src/client/graphics/layers/AttackingTroopsOverlay";

describe("troopAttackColor", () => {
  test("returns green when attacker has more troops", () => {
    expect(troopAttackColor(1000, 500)).toBe("#66ff66");
  });

  test("returns amber when defender has more troops", () => {
    expect(troopAttackColor(500, 1000)).toBe("#ffbe3c");
  });

  test("returns amber when troops are equal", () => {
    expect(troopAttackColor(500, 500)).toBe("#ffbe3c");
  });
});

describe("troopDefenceColor", () => {
  test("returns red when attacker has more troops than defender", () => {
    expect(troopDefenceColor(1000, 500)).toBe("#ff4444");
  });

  test("returns orange when defender has more troops", () => {
    expect(troopDefenceColor(500, 1000)).toBe("#ff9944");
  });

  test("returns orange when troops are equal", () => {
    expect(troopDefenceColor(500, 500)).toBe("#ff9944");
  });
});
