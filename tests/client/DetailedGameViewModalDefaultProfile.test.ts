import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import {
  DEFAULT_FILTERS,
  saveDefaultFilterProfile,
  saveFilterProfile,
} from "../../src/client/components/DetailedGameViewFilters";
import { DetailedGameViewModal } from "../../src/client/components/DetailedGameViewModal";
import { UserSettings } from "../../src/client/UserSettings";

function openModal(modal: any) {
  modal.lobbySocket = { start: vi.fn(async () => {}), stop: vi.fn() };
  modal.onOpen();
}

describe("DetailedGameViewModal default profile", () => {
  const modals: any[] = [];

  function newModal() {
    const modal = new DetailedGameViewModal() as any;
    modals.push(modal);
    return modal;
  }

  beforeEach(() => {
    localStorage.clear();
    UserSettings.setPlayerId(null);
    saveFilterProfile("Halloween", {
      ...DEFAULT_FILTERS,
      modes: ["ffa"],
      sources: ["public"],
      minCapacity: 100,
    });
  });

  afterEach(() => {
    UserSettings.setPlayerId(null);
    // onOpen starts a repaint timer.
    for (const modal of modals.splice(0)) {
      clearInterval(modal.countdownTimer);
    }
  });

  it("applies the default profile when the menu first opens", () => {
    saveDefaultFilterProfile("Halloween");
    const modal = newModal();
    openModal(modal);
    expect(modal.selectedProfile).toBe("Halloween");
    expect(modal.filters.modes).toEqual(["ffa"]);
    expect(modal.filters.minCapacity).toBe(100);
  });

  it("leaves the filters at their defaults when no default is set", () => {
    const modal = newModal();
    openModal(modal);
    expect(modal.selectedProfile).toBe("");
    expect(modal.filters).toEqual(DEFAULT_FILTERS);
  });

  it("does not undo the host's own filter change when reopened", () => {
    saveDefaultFilterProfile("Halloween");
    const modal = newModal();
    openModal(modal);
    modal.resetFilters();
    openModal(modal);
    expect(modal.filters).toEqual(DEFAULT_FILTERS);
  });

  it("choosing a default saves it for the next page load", () => {
    const modal = newModal();
    openModal(modal);
    modal.setDefaultProfile("Halloween");
    expect(modal.defaultProfile).toBe("Halloween");

    const nextLoad = newModal();
    openModal(nextLoad);
    expect(nextLoad.selectedProfile).toBe("Halloween");
  });

  it("deleting the default profile leaves no default behind", () => {
    saveDefaultFilterProfile("Halloween");
    const modal = newModal();
    openModal(modal);
    modal.deleteProfile();
    expect(modal.defaultProfile).toBe("");
  });

  it("each account opens with its own default, and gets it back on login", () => {
    UserSettings.setPlayerId("rikardo");
    saveFilterProfile("asd", { ...DEFAULT_FILTERS, minCapacity: 100 });
    saveDefaultFilterProfile("asd");
    const modal = newModal();
    openModal(modal);
    expect(modal.selectedProfile).toBe("asd");
    expect(modal.filters.minCapacity).toBe(100);

    // Another account on the same device: nothing of Rikardo's is visible.
    UserSettings.setPlayerId("anon");
    modal.loadAccountProfiles();
    expect(modal.profiles).toEqual({});
    expect(modal.selectedProfile).toBe("");
    expect(modal.filters).toEqual(DEFAULT_FILTERS);

    // Back to the first account: its default is applied again.
    UserSettings.setPlayerId("rikardo");
    modal.loadAccountProfiles();
    expect(modal.selectedProfile).toBe("asd");
    expect(modal.defaultProfile).toBe("asd");
    expect(modal.filters.minCapacity).toBe(100);
  });
});
