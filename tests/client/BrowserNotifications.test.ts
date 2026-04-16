import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationPrompt } from "../../src/client/components/NotificationPrompt";
import { JoinLobbyModal } from "../../src/client/JoinLobbyModal";
import { UserSettings } from "../../src/core/game/UserSettings";

const store: Record<string, string> = {};
const ls = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    Object.keys(store).forEach((k) => delete store[k]);
  },
};
vi.stubGlobal("localStorage", ls);

function resetStorage() {
  ls.clear();
  (UserSettings as any).cache = new Map();
}

describe("UserSettings.browserNotifications", () => {
  beforeEach(resetStorage);

  it("defaults to false", () => {
    expect(new UserSettings().browserNotifications()).toBe(false);
  });

  it("toggleBrowserNotifications turns it on", () => {
    const s = new UserSettings();
    s.toggleBrowserNotifications();
    expect(s.browserNotifications()).toBe(true);
  });

  it("toggleBrowserNotifications is a real toggle", () => {
    const s = new UserSettings();
    s.toggleBrowserNotifications();
    s.toggleBrowserNotifications();
    expect(s.browserNotifications()).toBe(false);
  });

  it("persists to localStorage", () => {
    const s = new UserSettings();
    s.toggleBrowserNotifications();
    expect(ls.getItem("settings.browserNotifications")).toBe("true");
  });
});

describe("NotificationPrompt", () => {
  beforeEach(resetStorage);
  afterEach(() => vi.restoreAllMocks());

  it("dismiss() hides prompt but does NOT write notificationPromptDismissed", () => {
    const prompt = new NotificationPrompt();
    prompt.visible = true;
    (prompt as any).dismiss();
    expect(ls.getItem("settings.notificationPromptDismissed")).toBeNull();
    expect(prompt.visible).toBe(false);
  });

  it("dismissForever() persists notificationPromptDismissed", () => {
    const prompt = new NotificationPrompt();
    prompt.visible = true;
    (prompt as any).dismissForever();
    expect(ls.getItem("settings.notificationPromptDismissed")).toBe("true");
    expect(prompt.visible).toBe(false);
  });

  it("handleEnable() does NOT write notificationPromptDismissed", () => {
    const prompt = new NotificationPrompt();
    prompt.visible = true;
    const spy = vi.spyOn(prompt, "dispatchEvent");
    (prompt as any).handleEnable();
    expect(ls.getItem("settings.notificationPromptDismissed")).toBeNull();
    expect(prompt.visible).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ type: "enable" }),
    );
  });
});

describe("JoinLobbyModal notification prompt", () => {
  let notifMock: {
    permission: NotificationPermission;
    requestPermission: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    resetStorage();
    notifMock = {
      permission: "default",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    };
    vi.stubGlobal("Notification", notifMock);
  });

  afterEach(() => vi.restoreAllMocks());

  function makeModal() {
    const m = new JoinLobbyModal();
    (m as any).startTrackingLobby = vi.fn();
    return m;
  }

  it("shows prompt when notifications not enabled", () => {
    const m = makeModal();
    m.open();
    expect((m as any).showNotificationPrompt).toBe(true);
  });

  it("open() is unaffected by unrelated localStorage keys", () => {
    // Guards against accidental gating by keys like "gamesPlayed" that
    // open() does not and should not consult.
    ls.setItem("gamesPlayed", "10");
    const m = makeModal();
    m.open();
    expect((m as any).showNotificationPrompt).toBe(true);
  });

  it("does not show when dismissed forever", () => {
    ls.setItem("settings.notificationPromptDismissed", "true");
    const m = makeModal();
    m.open();
    expect((m as any).showNotificationPrompt).toBe(false);
  });

  it("does not show when browserNotifications already enabled", () => {
    ls.setItem("settings.browserNotifications", "true");
    (UserSettings as any).cache = new Map();
    const m = makeModal();
    m.open();
    expect((m as any).showNotificationPrompt).toBe(false);
  });

  it("does not show when Notification permission is denied", () => {
    notifMock.permission = "denied";
    const m = makeModal();
    m.open();
    expect((m as any).showNotificationPrompt).toBe(false);
  });

  it("shows again on re-open after dismiss (not forever)", () => {
    const m = makeModal();
    m.open();
    expect((m as any).showNotificationPrompt).toBe(true);
    (m as any).showNotificationPrompt = false;
    m.open();
    expect((m as any).showNotificationPrompt).toBe(true);
  });

  it("does not show on re-open after dismissForever", () => {
    const m = makeModal();
    m.open();
    expect((m as any).showNotificationPrompt).toBe(true);
    ls.setItem("settings.notificationPromptDismissed", "true");
    m.open();
    expect((m as any).showNotificationPrompt).toBe(false);
  });
});

describe("JoinLobbyModal.handleEnableNotifications", () => {
  let notifMock: {
    permission: NotificationPermission;
    requestPermission: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    resetStorage();
    notifMock = {
      permission: "default",
      requestPermission: vi.fn().mockResolvedValue("granted"),
    };
    vi.stubGlobal("Notification", notifMock);
  });

  afterEach(() => vi.restoreAllMocks());

  function makeModal() {
    const m = new JoinLobbyModal();
    (m as any).userSettings = new UserSettings();
    return m;
  }

  it("enables browserNotifications when permission already granted", () => {
    notifMock.permission = "granted";
    const m = makeModal();
    (m as any).handleEnableNotifications();
    expect((m as any).userSettings.browserNotifications()).toBe(true);
  });

  it("enables browserNotifications after permission resolves to granted", async () => {
    notifMock.requestPermission = vi.fn().mockResolvedValue("granted");
    const m = makeModal();
    (m as any).handleEnableNotifications();
    await Promise.resolve();
    expect((m as any).userSettings.browserNotifications()).toBe(true);
  });

  it("does not enable browserNotifications when permission denied", async () => {
    notifMock.requestPermission = vi.fn().mockResolvedValue("denied");
    const m = makeModal();
    (m as any).handleEnableNotifications();
    await Promise.resolve();
    expect((m as any).userSettings.browserNotifications()).toBe(false);
  });

  it("is idempotent - calling twice when granted does not disable", () => {
    notifMock.permission = "granted";
    const m = makeModal();
    (m as any).handleEnableNotifications();
    (m as any).handleEnableNotifications();
    expect((m as any).userSettings.browserNotifications()).toBe(true);
  });

  it("hides the prompt", () => {
    const m = makeModal();
    (m as any).showNotificationPrompt = true;
    (m as any).handleEnableNotifications();
    expect((m as any).showNotificationPrompt).toBe(false);
  });

  it("requests permission when default", () => {
    const m = makeModal();
    (m as any).handleEnableNotifications();
    expect(notifMock.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("does not request permission when already granted", () => {
    notifMock.permission = "granted";
    const m = makeModal();
    (m as any).handleEnableNotifications();
    expect(notifMock.requestPermission).not.toHaveBeenCalled();
  });
});
