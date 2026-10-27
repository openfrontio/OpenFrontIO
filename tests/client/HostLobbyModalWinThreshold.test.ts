import { describe, expect, it, vi } from "vitest";

// The desktop bridge is absent in jsdom; mock it like HostLobbyModal.test.ts.
vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: vi.fn(() => false),
    openInviteDialog: vi.fn(async () => true),
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

import { LobbyInfoEvent } from "@openfront/shared/WireSchemas";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";

const LOBBY = "ABCD1234";

function lobbyInfo(winThresholdTenths: number | undefined, gameID = LOBBY) {
  return new LobbyInfoEvent(
    { gameID, clients: [], gameConfig: { winThresholdTenths } } as any,
    "host",
  );
}

function modalWithStubbedPush() {
  const modal = new HostLobbyModal() as any;
  modal.putGameConfig = vi.fn(); // network push stubbed out
  return modal;
}

function typed(value: string) {
  const input = document.createElement("input");
  input.value = value;
  return { target: input } as unknown as Event;
}

// The server stores the threshold in tenths of a percent (755 = 75.5%).
async function pushedConfig(modal: any) {
  const events: CustomEvent[] = [];
  modal.dispatchEvent = (e: CustomEvent) => {
    events.push(e);
    return true;
  };
  modal.constructUrl = vi.fn(async () => "http://localhost/");
  modal.updateLobbyHistory = vi.fn();
  const { putGameConfig } = HostLobbyModal.prototype as any;
  await putGameConfig.call(modal);
  return events[0].detail.config;
}

describe("HostLobbyModal win threshold", () => {
  it("turns the setting on with the card's value and pushes the config", () => {
    const modal = modalWithStubbedPush();
    modal.handleWinThresholdToggle(true, 80);
    expect(modal.winThreshold).toBe(true);
    expect(modal.winThresholdValue).toBe(80);
    expect(modal.putGameConfig).toHaveBeenCalledOnce();
  });

  it("clears the value when the toggle is switched off", () => {
    const modal = modalWithStubbedPush();
    modal.handleWinThresholdToggle(true, 80);
    modal.handleWinThresholdToggle(false, undefined);
    expect(modal.winThreshold).toBe(false);
    expect(modal.winThresholdValue).toBeUndefined();
  });

  it("keeps one decimal", () => {
    const modal = modalWithStubbedPush();
    modal.handleWinThresholdValueChanges(typed("75.5"));
    expect(modal.winThresholdValue).toBe(75.5);
  });

  it("rounds extra decimals to one", () => {
    const modal = modalWithStubbedPush();
    modal.handleWinThresholdValueChanges(typed("75.54"));
    expect(modal.winThresholdValue).toBe(75.5);
  });

  it.each(["9.9", "100", "99.95", "0", "abc", ""])(
    "rejects %s as out of range",
    (text) => {
      const modal = modalWithStubbedPush();
      modal.winThresholdValue = 80;
      modal.handleWinThresholdValueChanges(typed(text));
      expect(modal.winThresholdValue).toBeUndefined();
    },
  );

  it.each([
    ["10", 10],
    ["99.9", 99.9],
  ])("accepts the limit %s", (text, expected) => {
    const modal = modalWithStubbedPush();
    modal.handleWinThresholdValueChanges(typed(text));
    expect(modal.winThresholdValue).toBe(expected);
  });

  it("sends the threshold in tenths when on", async () => {
    const modal = new HostLobbyModal() as any;
    modal.winThreshold = true;
    modal.winThresholdValue = 75.5;
    expect((await pushedConfig(modal)).winThresholdTenths).toBe(755);
  });

  it("sends null when off, so the 80% default applies", async () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(undefined));
    modal.winThreshold = false;
    modal.winThresholdValue = 75.5;
    expect((await pushedConfig(modal)).winThresholdTenths).toBeNull();
  });

  it("sends null when on but no valid value is typed", async () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(undefined));
    modal.winThreshold = true;
    modal.winThresholdValue = undefined;
    expect((await pushedConfig(modal)).winThresholdTenths).toBeNull();
  });
});

// A host returning to an existing lobby (?host) starts with default settings;
// without this, their next change of any setting would send
// winThresholdTenths: null and clear the lobby's custom threshold.
describe("HostLobbyModal win threshold from lobby info", () => {
  it("loads the lobby's threshold from its first lobby info", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(755));
    expect(modal.winThreshold).toBe(true);
    expect(modal.winThresholdValue).toBe(75.5);
  });

  it("does not overwrite the host's edits on later lobby info", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(755));
    modal.winThresholdValue = 60;
    modal.handleLobbyInfo(lobbyInfo(755));
    expect(modal.winThresholdValue).toBe(60);
  });

  it("keeps an edit the host made before the first lobby info", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.putGameConfig = vi.fn();
    modal.handleWinThresholdToggle(true, 60);
    modal.handleLobbyInfo(lobbyInfo(755));
    expect(modal.winThresholdValue).toBe(60);
  });

  it("keeps the host switching it off before the first lobby info", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.putGameConfig = vi.fn();
    modal.handleWinThresholdToggle(false, undefined);
    modal.handleLobbyInfo(lobbyInfo(755));
    expect(modal.winThreshold).toBe(false);
  });

  it("ignores lobby info for another lobby", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.handleLobbyInfo(lobbyInfo(755, "OTHER999"));
    expect(modal.winThreshold).toBe(false);
  });

  it("leaves the threshold alone before the lobby's has loaded", async () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    expect((await pushedConfig(modal)).winThresholdTenths).toBeUndefined();
  });

  it("sends the host's threshold even before the lobby's has loaded", async () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = LOBBY;
    modal.winThreshold = true;
    modal.winThresholdValue = 75.5;
    expect((await pushedConfig(modal)).winThresholdTenths).toBe(755);
  });
});
