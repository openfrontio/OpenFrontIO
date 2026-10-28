import { describe, expect, it, vi } from "vitest";

// Side-effect import: the @customElement decorator registers <build-menu>
// when the module is evaluated, and a type-only reference would not evaluate it.
import { BuildableUnit, UnitType } from "@openfront/engine-api/game/GameTypes";
import "../../../../src/client/hud/layers/BuildMenu";
import type { BuildMenu } from "../../../../src/client/hud/layers/BuildMenu";

function makeMenu(): BuildMenu {
  return document.createElement("build-menu") as BuildMenu;
}

const item = (unitType: UnitType) => ({ unitType, icon: "" }) as any;

describe("BuildMenu.cost", () => {
  it("returns the buildable's cost for a matching unit type", () => {
    const menu = makeMenu();
    menu.playerBuildables = [
      { type: UnitType.City, canBuild: true, canUpgrade: false, cost: 125n },
      { type: UnitType.Port, canBuild: false, canUpgrade: false, cost: 5n },
    ] as unknown as BuildableUnit[];

    // Skips non-matching entries before finding the match.
    expect(menu.cost(item(UnitType.Port))).toBe(5n);
    expect(menu.cost(item(UnitType.City))).toBe(125n);
  });

  it("falls back to 0 when the unit type is not buildable here", () => {
    const menu = makeMenu();
    menu.playerBuildables = [
      { type: UnitType.City, canBuild: true, canUpgrade: false, cost: 125n },
    ] as unknown as BuildableUnit[];

    expect(menu.cost(item(UnitType.Factory))).toBe(0n);
  });

  it("falls back to 0 before the buildables have arrived", () => {
    const menu = makeMenu();
    menu.playerBuildables = null;

    expect(menu.cost(item(UnitType.City))).toBe(0n);
  });
});

describe("BuildMenu hold-to-build availability", () => {
  it("uses the effective action for rendered buttons as the hold changes", async () => {
    const menu = makeMenu();
    menu.game = { myPlayer: () => ({}) } as any;
    menu.uiState = { preventStacking: true } as any;
    menu.playerBuildables = [
      { type: UnitType.City, canBuild: false, canUpgrade: 7, cost: 1n },
    ] as BuildableUnit[];
    (menu as any).filteredBuildTable = [[item(UnitType.City)]];
    document.body.appendChild(menu);
    await menu.updateComplete;
    const button = menu.renderRoot.querySelector("button")!;
    expect(button.disabled).toBe(true);

    menu.uiState.preventStacking = false;
    menu.requestUpdate();
    await menu.updateComplete;
    expect(button.disabled).toBe(false);

    menu.uiState.preventStacking = true;
    menu.playerBuildables[0].canBuild = 0;
    menu.requestUpdate();
    await menu.updateComplete;
    expect(button.disabled).toBe(false);
    menu.remove();
  });
});

it("recovers the open build menu after a buildables timeout", async () => {
  const menu = makeMenu();
  const units = [
    { type: UnitType.City, canBuild: 43, canUpgrade: false, cost: 1n },
  ] as BuildableUnit[];
  const buildables = vi
    .fn()
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValue(units);
  menu.game = {
    myPlayer: () => ({ buildables }),
    config: () => ({ isUnitDisabled: () => false }),
  } as any;
  menu.playerBuildables = units;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    await (menu as any).refresh();
    expect(menu.playerBuildables).toBe(units);
    expect(warning).toHaveBeenCalledTimes(1);
    await (menu as any).refresh();
    expect(menu.playerBuildables).toBe(units);
  } finally {
    warning.mockRestore();
  }
});

it("an older timeout cannot erase a newer successful menu refresh", async () => {
  const menu = makeMenu();
  let rejectOld: (error: Error) => void = () => {};
  const units = [
    { type: UnitType.City, canBuild: 43, canUpgrade: false, cost: 1n },
  ] as BuildableUnit[];
  const buildables = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    )
    .mockResolvedValue(units);
  menu.game = {
    myPlayer: () => ({ buildables }),
    config: () => ({ isUnitDisabled: () => false }),
  } as any;
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const oldRefresh = (menu as any).refresh();
    await (menu as any).refresh();
    expect(menu.playerBuildables).toBe(units);
    rejectOld(new Error("timeout"));
    await oldRefresh;
    expect(menu.playerBuildables).toBe(units);
    expect(warning).toHaveBeenCalledTimes(1);
  } finally {
    warning.mockRestore();
  }
});
