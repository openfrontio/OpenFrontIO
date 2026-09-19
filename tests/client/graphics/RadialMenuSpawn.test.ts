import { vi } from "vitest";

// Mock BuildMenu to avoid importing lit and other ESM-heavy deps in this unit test
vi.mock("../../../src/client/hud/layers/BuildMenu", () => ({
  BuildMenu: class {},
  flattenedBuildTable: [],
}));

// Mock Utils to avoid touching DOM (document) during tests
vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (num: number) => num.toString(),
}));

import { RadialMenu } from "../../../src/client/hud/layers/RadialMenu";
import {
  centerButtonElement,
  MenuElementParams,
} from "../../../src/client/hud/layers/RadialMenuElements";
import { TileRef } from "../../../src/core/game/GameMap";

describe("RadialMenu center button - spawn phase", () => {
  it("clicking the center button during the spawn phase spawns on the tile", () => {
    const tile = 42 as TileRef;
    const handleSpawn = vi.fn();
    const handleAttack = vi.fn();
    const closeMenu = vi.fn();

    const params = {
      tile,
      game: { inSpawnPhase: () => true },
      playerActionHandler: { handleSpawn, handleAttack },
      closeMenu,
    } as unknown as MenuElementParams;

    centerButtonElement.action(params);

    expect(handleSpawn).toHaveBeenCalledExactlyOnceWith(tile);
    expect(handleAttack).not.toHaveBeenCalled();
    expect(closeMenu).toHaveBeenCalled();
  });

  it("guards against synthetic clicks immediately after opening", () => {
    const menu = new RadialMenu({} as any, {} as any, {} as any);
    menu["menuOpenedAt"] = Date.now();
    expect(menu["isClickAllowed"]()).toBe(false);
    expect(
      menu["isClickAllowed"](
        new PointerEvent("click", { pointerType: "mouse" }),
      ),
    ).toBe(true);
    menu["menuOpenedAt"] = Date.now() - 300;
    expect(menu["isClickAllowed"]()).toBe(true);
  });
});
