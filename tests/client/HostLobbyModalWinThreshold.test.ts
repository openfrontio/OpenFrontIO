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

import { HostLobbyModal } from "../../src/client/HostLobbyModal";

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
    modal.winThreshold = false;
    modal.winThresholdValue = 75.5;
    expect((await pushedConfig(modal)).winThresholdTenths).toBeNull();
  });

  it("sends null when on but no valid value is typed", async () => {
    const modal = new HostLobbyModal() as any;
    modal.winThreshold = true;
    modal.winThresholdValue = undefined;
    expect((await pushedConfig(modal)).winThresholdTenths).toBeNull();
  });
});
