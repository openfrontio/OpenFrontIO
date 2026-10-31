import { vi } from "vitest";

vi.mock("../../../src/client/hud/layers/BuildMenu", () => ({
  BuildMenu: class {},
  flattenedBuildTable: [],
}));
vi.mock("../../../src/client/hud/layers/ChatIntegration", () => ({
  ChatIntegration: class {},
}));
vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));
vi.mock("@openfront/engine-lib/Format", () => ({
  renderNumber: (num: number) => num.toString(),
}));

import { EventBus } from "@openfront/shared/EventBus";
import { MainRadialMenu } from "../../../src/client/hud/layers/MainRadialMenu";
import {
  DoDonateGoldEvent,
  DoDonateTroopsEvent,
} from "../../../src/client/InputHandler";
import { SendDonateTroopsIntentEvent } from "../../../src/client/Transport";

const TILE = 7;

function setup({
  friendly = true,
  disconnected = false,
  canDonateTroops = true,
  canDonateGold = true,
} = {}) {
  const bus = new EventBus();
  const recipient = {
    isPlayer: () => true,
    isFriendly: () => friendly,
    isDisconnected: () => disconnected,
  };
  const actions = {
    canAttack: false,
    buildableUnits: [],
    canSendEmojiAllPlayers: false,
    interaction: { canDonateTroops, canDonateGold },
  };
  const myPlayer = {
    troops: () => 1000,
    actions: vi.fn(async () => actions),
  };
  const game = {
    isSpectator: () => false,
    inSpawnPhase: () => false,
    myPlayer: () => myPlayer,
    isValidCoord: () => true,
    ref: () => TILE,
    owner: () => recipient,
  };
  const transformHandler = {
    screenToWorldCoordinates: vi.fn(() => ({ x: 3, y: 4 })),
  };
  const playerPanel = { openSendGoldModal: vi.fn() };
  const menu = new MainRadialMenu(
    bus,
    game as any,
    transformHandler as any,
    {} as any,
    {} as any,
    { attackRatio: 0.25 } as any,
    playerPanel as any,
  );
  menu.init();
  const donations: SendDonateTroopsIntentEvent[] = [];
  bus.on(SendDonateTroopsIntentEvent, (e) => donations.push(e));
  return {
    bus,
    recipient,
    actions,
    myPlayer,
    transformHandler,
    playerPanel,
    donations,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MainRadialMenu donate keybinds", () => {
  afterEach(() => {
    document.dispatchEvent(new CustomEvent("leave-lobby"));
  });

  it("donates the attack ratio's share of troops to the friendly player at the cursor", async () => {
    const { bus, recipient, transformHandler, donations } = setup();

    bus.emit(new DoDonateTroopsEvent(50, 60));
    await flush();

    expect(transformHandler.screenToWorldCoordinates).toHaveBeenCalledWith(
      50,
      60,
    );
    expect(donations).toHaveLength(1);
    expect(donations[0].recipient).toBe(recipient);
    expect(donations[0].troops).toBe(250);
  });

  it.each([
    ["an enemy", { friendly: false }],
    ["a disconnected teammate", { disconnected: true }],
    ["a player who can't take troops yet", { canDonateTroops: false }],
  ])("does not donate troops to %s", async (_, opts) => {
    const { bus, donations } = setup(opts);

    bus.emit(new DoDonateTroopsEvent(50, 60));
    await flush();

    expect(donations).toHaveLength(0);
  });

  it("opens the send-gold modal for the friendly player at the cursor", async () => {
    const { bus, recipient, actions, playerPanel } = setup();

    bus.emit(new DoDonateGoldEvent(50, 60));
    await flush();

    expect(playerPanel.openSendGoldModal).toHaveBeenCalledExactlyOnceWith(
      actions,
      TILE,
      recipient,
    );
  });

  it("does not open the send-gold modal when gold can't be donated", async () => {
    const { bus, playerPanel } = setup({ canDonateGold: false });

    bus.emit(new DoDonateGoldEvent(50, 60));
    await flush();

    expect(playerPanel.openSendGoldModal).not.toHaveBeenCalled();
  });
});
