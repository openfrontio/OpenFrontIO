/**
 * @jest-environment jsdom
 */
import {
  attackMenuElement,
  buildMenuElement,
  COLORS,
  MenuElementParams,
  rootMenuElement,
  Slot,
} from "../../../src/client/graphics/layers/RadialMenuElements";
import { UnitType } from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { GameView, PlayerView } from "../../../src/core/game/GameView";

jest.mock("../../../src/client/Utils", () => ({
  renderNumber: jest.fn((num: number) => num.toString()),
  translateText: jest.fn((key: string) => key),
}));

jest.mock("../../../src/client/graphics/layers/BuildMenu", () => {
  const { UnitType } = jest.requireActual("../../../src/core/game/Game");
  return {
    flattenedBuildTable: [
      {
        countable: true,
        description: "unit_type.city_desc",
        icon: "city-icon",
        key: "unit_type.city",
        unitType: UnitType.City,
      },
      {
        countable: true,
        description: "unit_type.factory_desc",
        icon: "factory-icon",
        key: "unit_type.factory",
        unitType: UnitType.Factory,
      },
      {
        countable: false,
        description: "unit_type.atom_bomb_desc",
        icon: "atom-bomb-icon",
        key: "unit_type.atom_bomb",
        unitType: UnitType.AtomBomb,
      },
      {
        countable: true,
        description: "unit_type.warship_desc",
        icon: "warship-icon",
        key: "unit_type.warship",
        unitType: UnitType.Warship,
      },
      {
        countable: false,
        description: "unit_type.hydrogen_bomb_desc",
        icon: "hydrogen-bomb-icon",
        key: "unit_type.hydrogen_bomb",
        unitType: UnitType.HydrogenBomb,
      },
      {
        countable: false,
        description: "unit_type.mirv_desc",
        icon: "mirv-icon",
        key: "unit_type.mirv",
        unitType: UnitType.MIRV,
      },
    ],
  };
});

jest.mock("nanoid", () => ({
  customAlphabet: jest.fn(() => jest.fn(() => "mock-id")),
}));

jest.mock("dompurify", () => ({
  __esModule: true,
  default: {
    sanitize: jest.fn((str: string) => str),
  },
}));

describe("RadialMenuElements", () => {
  let mockParams: MenuElementParams;
  let mockPlayer: PlayerView;
  let mockGame: GameView;
  let mockBuildMenu: any;
  let mockPlayerActions: any;
  let mockTile: TileRef;

  beforeEach(() => {
    mockPlayer = {
      id: () => 1,
      isAlliedWith: jest.fn(() => false),
      isPlayer: jest.fn(() => true),
    } as unknown as PlayerView;

    mockGame = {
      config: jest.fn(() => ({
        isUnitDisabled: jest.fn(() => false),
        theme: () => ({
          territoryColor: () => ({
            lighten: () => ({ alpha: () => ({ toRgbString: () => "#fff" }) }),
          }),
        }),
      })),
      inSpawnPhase: jest.fn(() => false),
      isLand: jest.fn(() => true),
      owner: jest.fn(() => mockPlayer),
    } as unknown as GameView;

    mockBuildMenu = {
      canBuildOrUpgrade: jest.fn(() => true),
      cost: jest.fn(() => 100),
      count: jest.fn(() => 5),
      sendBuildOrUpgrade: jest.fn(),
    };

    mockPlayerActions = {
      buildableUnits: [
        { canBuild: true, type: UnitType.City },
        { canBuild: true, type: UnitType.Factory },
        { canBuild: true, type: UnitType.AtomBomb },
        { canBuild: true, type: UnitType.Warship },
        { canBuild: true, type: UnitType.HydrogenBomb },
        { canBuild: true, type: UnitType.MIRV },
        { canBuild: true, type: UnitType.TransportShip },
      ],
      canAttack: true,
      interaction: {
        canBreakAlliance: false,
        canDonateGold: true,
        canDonateTroops: true,
        canSendAllianceRequest: true,
      },
    };

    mockTile = {} as TileRef;

    mockParams = {
      buildMenu: mockBuildMenu,
      chatIntegration: {} as any,
      closeMenu: jest.fn(),
      emojiTable: {} as any,
      eventBus: {} as any,
      game: mockGame,
      myPlayer: mockPlayer,
      playerActionHandler: {} as any,
      playerActions: mockPlayerActions,
      playerPanel: {} as any,
      selected: mockPlayer,
      tile: mockTile,
    };
  });

  describe("attackMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(attackMenuElement.id).toBe(Slot.Attack);
      expect(attackMenuElement.name).toBe("radial_attack");
      expect(attackMenuElement.icon).toBeDefined();
      expect(attackMenuElement.color).toBe(COLORS.attack);
    });

    it("should be disabled during spawn phase", () => {
      mockGame.inSpawnPhase = jest.fn(() => true);
      expect(attackMenuElement.disabled(mockParams)).toBe(true);
    });

    it("should be enabled when not in spawn phase", () => {
      mockGame.inSpawnPhase = jest.fn(() => false);
      expect(attackMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should return attack submenu with attack units only", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      expect(subMenu).toBeDefined();
      expect(subMenu.length).toBeGreaterThan(0);

      const attackUnitTypes = [
        UnitType.AtomBomb,
        UnitType.MIRV,
        UnitType.HydrogenBomb,
        UnitType.Warship,
      ];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("attack_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      returnedUnitTypes.forEach((unitType) => {
        expect(attackUnitTypes).toContain(unitType);
      });
    });

    it("should not include construction units in attack menu", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      const constructionUnitTypes = [UnitType.City, UnitType.Factory];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("attack_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      constructionUnitTypes.forEach((unitType) => {
        expect(returnedUnitTypes).not.toContain(unitType);
      });
    });

    it("should handle undefined params in submenu", () => {
      const subMenu = attackMenuElement.subMenu!(undefined as any);
      expect(subMenu).toEqual([]);
    });
  });

  describe("buildMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(buildMenuElement.id).toBe(Slot.Build);
      expect(buildMenuElement.name).toBe("build");
      expect(buildMenuElement.icon).toBeDefined();
      expect(buildMenuElement.color).toBe(COLORS.build);
    });

    it("should be disabled during spawn phase", () => {
      mockGame.inSpawnPhase = jest.fn(() => true);
      expect(buildMenuElement.disabled(mockParams)).toBe(true);
    });

    it("should be enabled when not in spawn phase", () => {
      mockGame.inSpawnPhase = jest.fn(() => false);
      expect(buildMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should return build submenu with construction units only", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);

      expect(subMenu).toBeDefined();
      expect(subMenu.length).toBeGreaterThan(0);

      const constructionUnitTypes = [UnitType.City, UnitType.Factory];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("build_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      returnedUnitTypes.forEach((unitType) => {
        expect(constructionUnitTypes).toContain(unitType);
      });
    });

    it("should not include attack units in build menu", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);

      const attackUnitTypes = [
        UnitType.AtomBomb,
        UnitType.MIRV,
        UnitType.HydrogenBomb,
        UnitType.Warship,
      ];
      const returnedUnitTypes = subMenu.map((item) => {
        const unitTypeStr = item.id.replace("build_", "");
        return Object.values(UnitType).find(
          (type) => type.toString() === unitTypeStr,
        );
      });

      attackUnitTypes.forEach((unitType) => {
        expect(returnedUnitTypes).not.toContain(unitType);
      });
    });

    it("should handle undefined params in submenu", () => {
      const subMenu = buildMenuElement.subMenu!(undefined as any);
      expect(subMenu).toEqual([]);
    });
  });

  describe("rootMenuElement", () => {
    it("should have correct basic properties", () => {
      expect(rootMenuElement.id).toBe("root");
      expect(rootMenuElement.name).toBe("root");
      expect(rootMenuElement.disabled(mockParams)).toBe(false);
    });

    it("should show build menu on own territory", () => {
      const subMenu = rootMenuElement.subMenu!(mockParams);
      const buildMenu = subMenu.find((item) => item.id === Slot.Build);
      const attackMenu = subMenu.find((item) => item.id === Slot.Attack);

      expect(buildMenu).toBeDefined();
      expect(attackMenu).toBeUndefined();
    });

    it("should show attack menu on enemy territory", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockGame.owner = jest.fn(() => enemyPlayer);

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const buildMenu = subMenu.find((item) => item.id === Slot.Build);
      const attackMenu = subMenu.find((item) => item.id === Slot.Attack);

      expect(attackMenu).toBeDefined();
      expect(buildMenu).toBeUndefined();
    });

    it("should include info and boat menus in both cases", () => {
      const subMenu = rootMenuElement.subMenu!(mockParams);
      const infoMenu = subMenu.find((item) => item.id === Slot.Info);
      const boatMenu = subMenu.find((item) => item.id === Slot.Boat);

      expect(infoMenu).toBeDefined();
      expect(boatMenu).toBeDefined();
    });

    it("should handle ally menu correctly", () => {
      const allyPlayer = {
        id: () => 2,
        isAlliedWith: jest.fn(() => true),
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = allyPlayer;

      const subMenu = rootMenuElement.subMenu!(mockParams);
      const allyMenu = subMenu.find((item) => item.id === "ally_break");

      expect(allyMenu).toBeDefined();
    });
  });

  describe("Menu element actions", () => {
    it("should execute build action correctly", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement).toBeDefined();
      expect(cityElement!.action).toBeDefined();

      if (cityElement!.action) {
        cityElement!.action(mockParams);
        expect(mockBuildMenu.sendBuildOrUpgrade).toHaveBeenCalled();
        expect(mockParams.closeMenu).toHaveBeenCalled();
      }
    });

    it("should execute attack action correctly", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);

      const atomBombElement = subMenu.find(
        (item) => item.id === "attack_Atom Bomb",
      );

      expect(atomBombElement).toBeDefined();
      expect(atomBombElement!.action).toBeDefined();

      if (atomBombElement!.action) {
        atomBombElement!.action(mockParams);
        expect(mockBuildMenu.sendBuildOrUpgrade).toHaveBeenCalled();
        expect(mockParams.closeMenu).toHaveBeenCalled();
      }
    });

    it("should not execute action when buildable unit is not found", () => {
      mockPlayerActions.buildableUnits = [];
      mockBuildMenu.canBuildOrUpgrade = jest.fn(() => false);

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      if (cityElement!.action) {
        cityElement!.action(mockParams);
        expect(mockBuildMenu.sendBuildOrUpgrade).not.toHaveBeenCalled();
        expect(mockParams.closeMenu).not.toHaveBeenCalled();
      }
    });
  });

  describe("Menu element tooltips", () => {
    it("should generate correct tooltip items for build elements", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement!.tooltipItems).toBeDefined();
      expect(cityElement!.tooltipItems!.length).toBeGreaterThan(0);

      const tooltipTexts = cityElement!.tooltipItems!.map((item) => item.text);
      expect(tooltipTexts).toContain("unit_type.city");
      expect(tooltipTexts).toContain("unit_type.city_desc");
      expect(tooltipTexts.some((text) => text.includes("100"))).toBe(true);
      expect(tooltipTexts.some((text) => text.includes("5x"))).toBe(true);
    });

    it("should generate correct tooltip items for attack elements", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);
      const atomBombElement = subMenu.find(
        (item) => item.id === "attack_Atom Bomb",
      );

      expect(atomBombElement!.tooltipItems).toBeDefined();
      expect(atomBombElement!.tooltipItems!.length).toBeGreaterThan(0);

      const tooltipTexts = atomBombElement!.tooltipItems!.map(
        (item) => item.text,
      );
      expect(tooltipTexts).toContain("unit_type.atom_bomb");
      expect(tooltipTexts).toContain("unit_type.atom_bomb_desc");
      expect(tooltipTexts.some((text) => text.includes("100"))).toBe(true);
    });
  });

  describe("Menu element colors", () => {
    it("should use correct colors for build elements", () => {
      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement!.color).toBe(COLORS.building);
    });

    it("should use correct colors for attack elements", () => {
      const enemyPlayer = {
        id: () => 2,
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      const subMenu = attackMenuElement.subMenu!(mockParams);
      const atomBombElement = subMenu.find(
        (item) => item.id === "attack_Atom Bomb",
      );

      expect(atomBombElement!.color).toBe(COLORS.attack);
    });

    it("should not set color when element is disabled", () => {
      mockBuildMenu.canBuildOrUpgrade = jest.fn(() => false);

      const subMenu = buildMenuElement.subMenu!(mockParams);
      const cityElement = subMenu.find((item) => item.id === "build_City");

      expect(cityElement!.color).toBeUndefined();
    });
  });

  describe("Translation integration", () => {
    it("should use translateText for tooltip items in build menu", () => {
      const { translateText } = jest.requireMock("../../../src/client/Utils");

      (translateText as jest.Mock).mockClear();

      buildMenuElement.subMenu!(mockParams);

      expect(translateText).toHaveBeenCalledWith("unit_type.city");
      expect(translateText).toHaveBeenCalledWith("unit_type.city_desc");
      expect(translateText).toHaveBeenCalledWith("unit_type.factory");
      expect(translateText).toHaveBeenCalledWith("unit_type.factory_desc");
    });

    it("should use translateText for tooltip items in attack menu", () => {
      const { translateText } = jest.requireMock("../../../src/client/Utils");

      (translateText as jest.Mock).mockClear();

      const enemyPlayer = {
        id: () => 2,
        isPlayer: jest.fn(() => true),
      } as unknown as PlayerView;
      mockParams.selected = enemyPlayer;

      attackMenuElement.subMenu!(mockParams);

      expect(translateText).toHaveBeenCalledWith("unit_type.atom_bomb");
      expect(translateText).toHaveBeenCalledWith("unit_type.atom_bomb_desc");
      expect(translateText).toHaveBeenCalledWith("unit_type.hydrogen_bomb");
      expect(translateText).toHaveBeenCalledWith(
        "unit_type.hydrogen_bomb_desc",
      );
    });
  });
});
