import { PlayerActions } from "@openfront/engine-api/game/GameTypes";
import { EventBus } from "@openfront/shared/EventBus";
import { describe, expect, test, vi } from "vitest";

vi.mock("../../src/client/hud/layers/ChatIntegration", () => ({
  ChatIntegration: class {
    setupChatModal = vi.fn();
  },
}));

import { MainRadialMenu } from "../../src/client/hud/layers/MainRadialMenu";
import {
  CloseViewEvent,
  ContextMenuEvent,
} from "../../src/client/InputHandler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const playerActions: PlayerActions = {
  canAttack: false,
  buildableUnits: [],
  canSendEmojiAllPlayers: false,
};

describe("MainRadialMenu pending actions", () => {
  test("does not reopen by itself after slow-loading myPlayer.actions when eg. a quick-build selection closed it", async () => {
    const pending = deferred<PlayerActions>();
    const eventBus = new EventBus();
    const myPlayer = { actions: vi.fn(() => pending.promise) };
    const game = {
      isValidCoord: () => true,
      ref: () => 1,
      isSpectator: () => false,
      myPlayer: () => myPlayer,
      owner: () => ({ isPlayer: () => false }),
    };
    const menu = new MainRadialMenu(
      eventBus,
      game as any,
      { screenToWorldCoordinates: () => ({ x: 1, y: 1 }) } as any,
      {} as any,
      {} as any,
      { ghostStructure: null } as any,
      {} as any,
    );
    const radialMenu = {
      init: vi.fn(),
      setCenterButtonAppearance: vi.fn(),
      getDefaultCenterIconSize: () => 48,
      setParams: vi.fn(),
      showRadialMenu: vi.fn(),
      refresh: vi.fn(),
    };
    (menu as any).radialMenu = radialMenu;
    menu.init();

    eventBus.emit(new ContextMenuEvent(100, 100));
    eventBus.emit(new CloseViewEvent());
    pending.resolve(playerActions);
    await pending.promise;
    await Promise.resolve();

    expect(radialMenu.showRadialMenu).not.toHaveBeenCalled();
  });
});
