// Mock BuildMenu to avoid importing lit and other ESM-heavy deps in this unit test
jest.mock(
  "../src/client/graphics/layers/BuildMenu",
  () => ({
    BuildMenu: class {},
    flattenedBuildTable: [],
  }),
  { virtual: true },
);

// Mock Utils to avoid touching DOM (document) during tests
jest.mock("../src/client/Utils", () => ({
  translateText: (k: string) => k,
  getSvgAspectRatio: async () => 1,
}));

import {
  COLORS,
  RadialMenuState,
  rootMenuElement,
  type MenuElementParams,
} from "../src/client/graphics/layers/RadialMenuElements";

// Minimal stubs to satisfy types used in rootMenuElement.subMenu and allyBreak actions
const makePlayer = (id: string) =>
  ({
    id: () => id,
    isAlliedWith: (other: any) =>
      other && typeof other.id === "function" && other.id() !== id
        ? true
        : true,
  }) as unknown as import("../src/core/game/GameView").PlayerView;

const makeParams = (opts?: Partial<MenuElementParams>): MenuElementParams => {
  const myPlayer = (opts?.myPlayer as any) ?? makePlayer("p1");
  const selected = (opts?.selected as any) ?? makePlayer("p2");
  return {
    myPlayer,
    selected,
    tile: {} as any,
    playerActions: {
      canAttack: true,
      interaction: {
        canBreakAlliance: true,
        canSendAllianceRequest: false,
        canEmbargo: false,
      },
    } as any,
    game: {
      inSpawnPhase: () => false,
      owner: () => ({ isPlayer: () => false }),
    } as any,
    buildMenu: {
      canBuildOrUpgrade: () => false,
      cost: () => 0,
      count: () => 0,
      sendBuildOrUpgrade: () => {},
    } as any,
    emojiTable: {} as any,
    playerActionHandler: {
      handleBreakAlliance: jest.fn(),
      handleEmbargo: jest.fn(),
      handleDonateGold: jest.fn(),
      handleDonateTroops: jest.fn(),
      handleTargetPlayer: jest.fn(),
    } as any,
    playerPanel: {
      show: jest.fn(),
    } as any,
    chatIntegration: {
      createQuickChatMenu: jest.fn(() => []),
    } as any,
    eventBus: {} as any,
    closeMenu: jest.fn(),
  };
};

const findAllyBreak = (items: any[]) =>
  items.find((i) => i && i.id === "ally_break");

describe("RadialMenuElements ally break/confirm", () => {
  beforeEach(() => {
    RadialMenuState.breakAlliancePendingId = null;
  });

  test("stage 1 shows break with default color", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    expect(ally).toBeTruthy();
    expect(ally.name).toBe("break");
    expect(ally.color).toBe(COLORS.breakAlly);
  });

  test("stage 2 shows confirm with purple color when pending id matches", () => {
    const params = makeParams();
    RadialMenuState.breakAlliancePendingId = params.selected!.id();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    expect(ally.name).toBe("confirm_break");
    expect(ally.color).toBe("#800080");
  });

  test("action toggles pending state then confirms and resets", () => {
    const params = makeParams();
    // First click: set pending state, do not close, do not call handler
    let items = rootMenuElement.subMenu!(params);
    let ally = findAllyBreak(items)!;
    ally.action!(params);
    expect(RadialMenuState.breakAlliancePendingId).toBe(params.selected!.id());
    expect(params.closeMenu).not.toHaveBeenCalled();
    expect(
      params.playerActionHandler.handleBreakAlliance,
    ).not.toHaveBeenCalled();

    // Second click: with pending state, confirm and reset + close menu
    items = rootMenuElement.subMenu!(params);
    ally = findAllyBreak(items)!;
    expect(ally.name).toBe("confirm_break");
    ally.action!(params);
    expect(params.playerActionHandler.handleBreakAlliance).toHaveBeenCalled();
    expect(params.closeMenu).toHaveBeenCalled();
    expect(RadialMenuState.breakAlliancePendingId).toBeNull();
  });
});
