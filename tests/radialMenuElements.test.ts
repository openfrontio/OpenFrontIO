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
const makePlayer = (
  id: string,
  opts?: { isTraitor?: boolean; isDisconnected?: boolean },
) =>
  ({
    id: () => id,
    isAlliedWith: (other: any) =>
      other && typeof other.id === "function" && other.id() !== id
        ? true
        : true,
    isTraitor: () => opts?.isTraitor ?? false,
    isDisconnected: () => opts?.isDisconnected ?? false,
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

describe("RadialMenuElements ally break", () => {
  test("shows break option with red color when allied to non-traitor", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    expect(ally).toBeTruthy();
    expect(ally.name).toBe("break");
    expect(typeof ally.color).toBe("function");
    expect(ally.color(params)).toBe(COLORS.breakAlly);
  });

  test("shows break option with orange color when allied to traitor", () => {
    const params = makeParams({
      selected: makePlayer("p2", { isTraitor: true }),
    });
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;
    expect(ally.color(params)).toBe(COLORS.breakAllyNoDebuff);
  });

  test("break action calls handleBreakAlliance and closes menu", () => {
    const params = makeParams();
    const items = rootMenuElement.subMenu!(params);
    const ally = findAllyBreak(items)!;

    ally.action!(params);

    expect(params.playerActionHandler.handleBreakAlliance).toHaveBeenCalledWith(
      params.myPlayer,
      params.selected,
    );
    expect(params.closeMenu).toHaveBeenCalled();
  });
});
