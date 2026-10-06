import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { howls } = vi.hoisted(() => ({ howls: [] as any[] }));
vi.mock("howler", () => ({
  Howl: class {
    play = vi.fn();
    unload = vi.fn();
    constructor() {
      howls.push(this);
    }
  },
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
}));

import { GameStartAlertController } from "../../src/client/components/GameStartAlertController";
import { UserSettings } from "../../src/client/UserSettings";

let settings: UserSettings;
let controller: GameStartAlertController;

beforeEach(() => {
  localStorage.clear();
  (
    UserSettings as unknown as { cache: Map<string, string | null> }
  ).cache.clear();
  howls.length = 0;
  settings = new UserSettings();
  settings.setAudioVolume("master", 1);
  settings.setAudioVolume("alerts", 1);
  settings.setLobbyStartAlerts(true);
  controller = new GameStartAlertController(
    {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    },
    () => true,
  );
  controller.hostConnected();
});

afterEach(() => {
  controller.hostDisconnected();
  vi.unstubAllGlobals();
});

const gameStarting = () => document.dispatchEvent(new Event("game-starting"));

describe("lobby alert audio", () => {
  it("does not load or play a persisted globally muted alert", () => {
    settings.setAudioMuted(true);
    (
      UserSettings as unknown as { cache: Map<string, string | null> }
    ).cache.clear();
    controller.reset();
    gameStarting();
    expect(howls).toHaveLength(0);
  });

  it("unloads a queued chime on mute and only plays future alerts after unmute", () => {
    controller.reset();
    expect(howls).toHaveLength(1);
    settings.setAudioMuted(true);
    expect(howls[0].unload).toHaveBeenCalledTimes(1);
    gameStarting();
    expect(howls[0].play).not.toHaveBeenCalled();
    settings.setAudioMuted(false);
    expect(howls).toHaveLength(1);
    gameStarting();
    expect(howls).toHaveLength(2);
    expect(howls[1].play).toHaveBeenCalledTimes(1);
  });

  it("stops a playing chime on mute and keeps a zero alert level silent after unmute", () => {
    controller.reset();
    gameStarting();
    expect(howls[0].play).toHaveBeenCalledTimes(1);
    settings.setAudioMuted(true);
    expect(howls[0].unload).toHaveBeenCalledTimes(1);
    settings.setAudioVolume("alerts", 0);
    settings.setAudioMuted(false);
    gameStarting();
    expect(howls).toHaveLength(1);
    expect(settings.audioVolume("master")).toBe(1);
  });

  it.each(["master", "alerts"] as const)(
    "does not load or play when %s is zero",
    (category) => {
      settings.setAudioVolume(category, 0);
      controller.reset();
      gameStarting();
      expect(howls).toHaveLength(0);
    },
  );

  it("cancels a preloaded alert when master is disabled", () => {
    controller.reset();
    expect(howls).toHaveLength(1);
    settings.setAudioVolume("master", 0);
    expect(howls[0].unload).toHaveBeenCalled();
    gameStarting();
    expect(howls[0].play).not.toHaveBeenCalled();
  });

  it("can play again after audio is enabled", () => {
    settings.setAudioVolume("master", 0);
    controller.reset();
    settings.setAudioVolume("master", 1);
    gameStarting();
    expect(howls).toHaveLength(1);
    expect(howls[0].play).toHaveBeenCalledTimes(1);
  });

  it.each(["master", "muted"] as const)(
    "still sends the armed notification when %s disables sound",
    (setting) => {
      const notify = vi.fn();
      class MockNotification {
        static permission = "granted";
        constructor(title: string) {
          notify(title);
        }
      }
      vi.stubGlobal("Notification", MockNotification);
      if (setting === "muted") settings.setAudioMuted(true);
      else settings.setAudioVolume("master", 0);
      controller.reset();
      gameStarting();
      expect(howls).toHaveLength(0);
      expect(notify).toHaveBeenCalledWith("public_lobby.notify_started");
    },
  );
});
