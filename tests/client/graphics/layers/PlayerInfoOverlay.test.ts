vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(),
  renderNumber: vi.fn(),
  renderTroops: vi.fn(),
  getTranslatedPlayerTeamLabel: vi.fn(() => ""),
}));

vi.mock("../../../../src/core/AssetUrls", () => ({
  assetUrl: vi.fn((p: string) => p),
}));

vi.mock("../../../../src/client/graphics/PlayerIcons", () => ({
  getFirstPlacePlayer: vi.fn(),
  getPlayerIcons: vi.fn(() => []),
  EMOJI_ICON_KIND: "emoji",
  IMAGE_ICON_KIND: "image",
}));

vi.mock("../../../../src/client/graphics/layers/ImmunityTimer", () => ({
  ImmunityBarVisibleEvent: class {},
}));

vi.mock("../../../../src/client/graphics/layers/SpawnTimer", () => ({
  SpawnBarVisibleEvent: class {},
}));

vi.mock("../../../../src/client/graphics/layers/RadialMenu", () => ({
  CloseRadialMenuEvent: class {},
}));

import { PlayerInfoOverlay } from "../../../../src/client/graphics/layers/PlayerInfoOverlay";
import { translateText } from "../../../../src/client/Utils";
import { UnitType } from "../../../../src/core/game/Game";

function makeOverlay(gameOverrides: Record<string, unknown> = {}) {
  const overlay = new PlayerInfoOverlay();

  const game = {
    isValidCoord: vi.fn(() => true),
    ref: vi.fn(() => 42),
    owner: vi.fn(() => ({ isPlayer: () => false })),
    isLand: vi.fn(() => false),
    units: vi.fn(() => []),
    x: vi.fn(() => 0),
    y: vi.fn(() => 0),
    myPlayer: vi.fn(() => null),
    config: vi.fn(() => ({
      isUnitDisabled: () => false,
      theme: () => ({ teamColor: () => ({ toHex: () => "#fff" }) }),
      maxTroops: () => 1000,
      disableAlliances: () => false,
    })),
    ticks: vi.fn(() => 0),
    ...gameOverrides,
  };

  const transform = {
    screenToWorldCoordinates: vi.fn(() => ({ x: 10, y: 10 })),
  };

  (overlay as any).game = game;
  (overlay as any).transform = transform;
  (overlay as any).eventBus = { on: vi.fn() };

  return { overlay, game, transform };
}

describe("PlayerInfoOverlay", () => {
  describe("maybeShow", () => {
    test("water tile with no ships shows water overlay", () => {
      const { overlay } = makeOverlay();

      overlay.maybeShow(100, 100);

      expect((overlay as any).isWater).toBe(true);
      expect((overlay as any).unit).toBeNull();
      expect((overlay as any)._isInfoVisible).toBe(true);
    });

    test("water tile with nearby ship shows water overlay and unit", () => {
      const mockUnit = {
        tile: () => 42,
        type: () => UnitType.Warship,
        owner: () => ({ displayName: () => "Player1" }),
        hasHealth: () => true,
        health: () => 100,
        troops: () => 0,
      };

      const { overlay } = makeOverlay({
        units: vi.fn(() => [mockUnit]),
        x: vi.fn(() => 10),
        y: vi.fn(() => 10),
      });

      overlay.maybeShow(100, 100);

      expect((overlay as any).isWater).toBe(true);
      expect((overlay as any).unit).toBe(mockUnit);
      expect((overlay as any)._isInfoVisible).toBe(true);
    });

    test("player-owned tile shows player info, not water", () => {
      const mockPlayer = {
        isPlayer: () => true,
        profile: () => Promise.resolve({}),
        displayName: () => "TestPlayer",
        type: () => 0,
        team: () => null,
        cosmetics: { flag: null },
        gold: () => 100,
        troops: () => 50,
        outgoingAttacks: () => [],
        alliances: () => [],
        totalUnitLevels: () => 0,
        smallID: () => 1,
        id: () => 1,
        isFriendly: () => false,
        isAlliedWith: () => false,
      };

      const { overlay } = makeOverlay({
        owner: vi.fn(() => mockPlayer),
      });

      overlay.maybeShow(100, 100);

      expect((overlay as any).isWater).toBe(false);
      expect((overlay as any).player).toBe(mockPlayer);
      expect((overlay as any)._isInfoVisible).toBe(true);
    });

    test("unowned land tile shows wilderness overlay", () => {
      const { overlay } = makeOverlay({
        isLand: vi.fn(() => true),
      });

      overlay.maybeShow(100, 100);

      expect((overlay as any).isWilderness).toBe(true);
      expect((overlay as any).isWater).toBe(false);
      expect((overlay as any).player).toBeNull();
      expect((overlay as any)._isInfoVisible).toBe(true);
    });

    test("render uses water title translation key", () => {
      const { overlay } = makeOverlay();
      overlay.maybeShow(100, 100);
      (overlay as any)._isActive = true;
      overlay.render();
      expect(translateText).toHaveBeenCalledWith(
        "player_info_overlay.water_title",
      );
    });

    test("render uses wilderness title translation key", () => {
      const { overlay } = makeOverlay({
        isLand: vi.fn(() => true),
      });
      overlay.maybeShow(100, 100);
      (overlay as any)._isActive = true;
      overlay.render();
      expect(translateText).toHaveBeenCalledWith(
        "player_info_overlay.wilderness_title",
      );
    });

    test("invalid coordinates shows nothing", () => {
      const { overlay } = makeOverlay({
        isValidCoord: vi.fn(() => false),
      });

      overlay.maybeShow(100, 100);

      expect((overlay as any).isWater).toBe(false);
      expect((overlay as any).isWilderness).toBe(false);
      expect((overlay as any)._isInfoVisible).toBe(false);
    });
  });

  describe("hide", () => {
    test("resets isWater and isWilderness state", () => {
      const { overlay } = makeOverlay();

      overlay.maybeShow(100, 100);
      expect((overlay as any).isWater).toBe(true);

      overlay.hide();
      expect((overlay as any).isWater).toBe(false);
      expect((overlay as any).isWilderness).toBe(false);
      expect((overlay as any).unit).toBeNull();
      expect((overlay as any).player).toBeNull();
      expect((overlay as any)._isInfoVisible).toBe(false);
    });
  });
});
