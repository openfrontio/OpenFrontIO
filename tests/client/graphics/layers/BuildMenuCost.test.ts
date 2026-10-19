import { afterEach, describe, expect, it, vi } from "vitest";
import * as NukeAlliance from "@openfront/engine-lib/execution/NukeAlliance";
import { EventBus } from "@openfront/shared/EventBus";
import { BuildUnitIntentEvent } from "../../../../src/client/Transport";
import { UserSettings } from "../../../../src/client/UserSettings";
import type { GameView } from "../../../../src/client/view";
import type { UIState } from "../../../../src/client/UIState";

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

describe("BuildMenu nuclear betrayal protection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    new UserSettings().removeCached("settings.preventNuclearBetrayal", false);
  });

  it("disables an unsafe target and rechecks direct launch attempts", async () => {
    const settings = new UserSettings();
    settings.removeCached("settings.preventNuclearBetrayal", false);
    settings.togglePreventNuclearBetrayal();
    const risk = vi
      .spyOn(NukeAlliance, "wouldNukeCauseBetrayal")
      .mockReturnValue(true);
    const menu = makeMenu();
    const unit = {
      type: UnitType.AtomBomb,
      canBuild: 10,
      canUpgrade: false,
      cost: 1n,
    } as BuildableUnit;
    const player = { buildables: async () => [unit] };
    menu.game = {
      myPlayer: () => player,
      config: () => ({ isUnitDisabled: () => false }),
    } as unknown as GameView;
    menu.eventBus = new EventBus();
    menu.uiState = { rocketDirectionUp: true } as UIState;
    const launch = vi.fn();
    menu.eventBus.on(BuildUnitIntentEvent, launch);
    document.body.append(menu);
    menu.showMenu(123);
    await menu.updateComplete;
    await menu.updateComplete;

    expect(menu.canBuildOrUpgrade(item(UnitType.AtomBomb), 123)).toBe(false);
    expect(risk).toHaveBeenCalledWith({
      game: menu.game,
      player,
      targetTile: 123,
      unitType: UnitType.AtomBomb,
    });
    expect(menu.shadowRoot!.querySelector("button")!.disabled).toBe(true);
    menu.sendBuildOrUpgrade(unit, 123);
    expect(launch).not.toHaveBeenCalled();
    expect(menu.isVisible).toBe(true);

    settings.togglePreventNuclearBetrayal();
    await menu.updateComplete;
    expect(menu.shadowRoot!.querySelector("button")!.disabled).toBe(false);
    expect(menu.canBuildOrUpgrade(item(UnitType.AtomBomb), 123)).toBe(true);
    menu.sendBuildOrUpgrade(unit, 123);
    expect(launch).toHaveBeenCalledWith(
      new BuildUnitIntentEvent(UnitType.AtomBomb, 123, true),
    );
    menu.remove();
    const requestUpdate = vi.spyOn(menu, "requestUpdate");
    settings.togglePreventNuclearBetrayal();
    expect(requestUpdate).not.toHaveBeenCalled();
  });
});
