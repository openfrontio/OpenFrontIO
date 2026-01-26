import { vi } from "vitest";

// Mock BuildMenu to avoid importing lit and other ESM-heavy deps in this unit test
vi.mock("../src/client/graphics/layers/BuildMenu", () => ({
  BuildMenu: class {},
  flattenedBuildTable: [],
}));

// Mock Utils to avoid touching DOM (document) during tests
vi.mock("../src/client/Utils", () => ({
  translateText: (k: string) => k,
  getSvgAspectRatio: async () => 1,
}));

import {
  COLORS,
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
      handleBreakAlliance: vi.fn(),
      handleEmbargo: vi.fn(),
      handleDonateGold: vi.fn(),
      handleDonateTroops: vi.fn(),
      handleTargetPlayer: vi.fn(),
    } as any,
    playerPanel: {
      show: vi.fn(),
    } as any,
    chatIntegration: {
      createQuickChatMenu: vi.fn(() => []),
    } as any,
    eventBus: {} as any,
    closeMenu: vi.fn(),
  };
};

const findAllyBreak = (items: any[]) =>
  items.find((i) => i && i.id === "ally_break");

const findAllyBreakConfirm = (items: any[]) =>
  items.find((i) => i && i.id === "ally_break_confirm");

const findAllyBreakCancel = (items: any[]) =>
  items.find((i) => i && i.id === "ally_break_cancel");

describe("RadialMenuElements ally break", () => {
  test("shows break option with correct color when allied", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    expect(ally).toBeTruthy();
    expect(ally.name).toBe("break");
    expect(ally.color).toBe(COLORS.breakAlly);
  });

  test("break option opens confirmation submenu", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;

    expect(ally.subMenu).toBeDefined();
    const subMenuItems = ally.subMenu!(params);
    expect(subMenuItems.length).toBe(2);

    const confirmItem = findAllyBreakConfirm(subMenuItems);
    const cancelItem = findAllyBreakCancel(subMenuItems);
    expect(confirmItem).toBeTruthy();
    expect(cancelItem).toBeTruthy();
  });

  test("confirm action calls handleBreakAlliance and closes menu", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    const subMenuItems = ally.subMenu!(params);
    const confirmItem = findAllyBreakConfirm(subMenuItems)!;

    confirmItem.action!(params);

    expect(params.playerActionHandler.handleBreakAlliance).toHaveBeenCalledWith(
      params.myPlayer,
      params.selected,
    );
    expect(params.closeMenu).toHaveBeenCalled();
  });

  test("cancel action closes menu without breaking alliance", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    const subMenuItems = ally.subMenu!(params);
    const cancelItem = findAllyBreakCancel(subMenuItems)!;

    cancelItem.action!(params);

    expect(
      params.playerActionHandler.handleBreakAlliance,
    ).not.toHaveBeenCalled();
    expect(params.closeMenu).toHaveBeenCalled();
  });
});
