// @vitest-environment jsdom
import {
  GameMapType,
  GameMode,
  GameType,
} from "@openfront/engine-api/game/GameTypes";
import { PublicGameInfo, PublicGames } from "@openfront/shared/WireSchemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "../../resources/lang/en.json";
import { ClientEnv } from "../../src/client/ClientEnv";
import { GameModeSelector } from "../../src/client/GameModeSelector";

vi.mock("../../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    start = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn();
  },
}));

vi.mock("../../src/client/ServerList", () => ({
  backendUnreachableConfirmed: () => false,
  isPinnedToAVersion: () => false,
  refreshServerList: vi.fn(),
  retryServerList: vi.fn(),
  manualRetryAvailable: () => true,
  MANUAL_RETRY_COOLDOWN_MS: 3000,
}));

function flatten(
  value: Record<string, unknown>,
  prefix = "",
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") out[fullKey] = child;
    else flatten(child as Record<string, unknown>, fullKey, out);
  }
  return out;
}

const mockFfaLobby: PublicGameInfo = {
  gameID: "ffa-game-123",
  numClients: 10,
  startsAt: Date.now() + 60000,
  publicGameType: "ffa",
  gameConfig: {
    gameMap: GameMapType.World,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    maxPlayers: 50,
  } as unknown as PublicGameInfo["gameConfig"],
};

const mockLobbies: PublicGames = {
  serverTime: Date.now(),
  games: {
    ffa: [mockFfaLobby],
    team: [],
    special: [],
  },
};

describe("GameModeSelector Click-Lock & In-Lobby State", () => {
  let languageFixture: HTMLElement | undefined;
  let selector: GameModeSelector | undefined;

  beforeEach(async () => {
    (
      window as unknown as { BOOTSTRAP_CONFIG?: Record<string, unknown> }
    ).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      turnstileSiteKey: "test",
      jwtAudience: "localhost",
      gitCommit: "test",
      isDev: false,
      version: "test",
    };

    const translations = flatten(en);
    languageFixture = document.createElement("lang-selector");
    Object.assign(languageFixture, {
      translations,
      defaultTranslations: translations,
      currentLang: "en",
    });
    document.body.appendChild(languageFixture);

    selector = new GameModeSelector();
    document.body.appendChild(selector);
    selector.setLobbiesForTest(mockLobbies);
    await selector.updateComplete;
  });

  afterEach(() => {
    selector?.remove();
    selector = undefined;
    languageFixture?.remove();
    languageFixture = undefined;
    document.body.innerHTML = "";
    delete (window as unknown as { BOOTSTRAP_CONFIG?: Record<string, unknown> })
      .BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.restoreAllMocks();
  });

  it("upgrades when created via document.createElement", () => {
    const el = document.createElement("game-mode-selector");
    expect(el instanceof GameModeSelector).toBe(true);
    expect(typeof (el as GameModeSelector).setLobbiesForTest).toBe("function");
  });

  it("has inLobby false initially and cards are not locked", () => {
    expect(selector).toBeDefined();
    expect(selector!.inLobby).toBe(false);
    expect(selector!.joiningLobbyId).toBeNull();

    const buttons = selector!.querySelectorAll("button");
    expect(buttons.length).toBeGreaterThan(0);

    for (const btn of buttons) {
      expect(btn.hasAttribute("disabled")).toBe(false);
      expect(btn.classList.contains("pointer-events-none")).toBe(false);
    }

    const spinner = selector!.querySelector(".animate-spin");
    expect(spinner).toBeNull();
  });

  it("click-locks lobby and action cards when join-lobby is dispatched on document", async () => {
    const joinEvents: CustomEvent[] = [];
    const onJoin = (e: Event) => joinEvents.push(e as CustomEvent);
    document.addEventListener("join-lobby", onJoin);

    try {
      document.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: { gameID: "ffa-game-123" },
        }),
      );
      await selector!.updateComplete;

      expect(selector!.inLobby).toBe(true);
      expect(selector!.joiningLobbyId).toBe("ffa-game-123");

      const buttons = selector!.querySelectorAll("button");
      for (const btn of buttons) {
        expect(btn.hasAttribute("disabled")).toBe(true);
        expect(btn.classList.contains("pointer-events-none")).toBe(true);
      }

      // Clicking while locked does not dispatch any new join-lobby event
      joinEvents.length = 0;
      const ffaCardBtn = selector!.querySelector(
        ".min-w-0 button",
      ) as HTMLButtonElement;
      expect(ffaCardBtn).not.toBeNull();
      ffaCardBtn.click();
      expect(joinEvents.length).toBe(0);

      // Also verify the JS guard directly (since disabled buttons suppress .click())
      const ffaLobby = mockLobbies.games.ffa?.[0];
      expect(ffaLobby).toBeDefined();
      (
        selector as unknown as {
          validateAndJoin: (lobby: unknown) => void;
        }
      ).validateAndJoin(ffaLobby);
      expect(joinEvents.length).toBe(0);
    } finally {
      document.removeEventListener("join-lobby", onJoin);
    }
  });

  it("ignores defaultPrevented join-lobby events from external modals", async () => {
    const prevent = (e: Event) => e.preventDefault();
    document.addEventListener("join-lobby", prevent, {
      capture: true,
      once: true,
    });
    try {
      const ev = new CustomEvent("join-lobby", {
        detail: { gameID: "ffa-game-123" },
        cancelable: true,
      });
      document.dispatchEvent(ev);
      await selector!.updateComplete;
      expect(selector!.inLobby).toBe(false);
    } finally {
      document.removeEventListener("join-lobby", prevent, { capture: true });
    }
  });

  it("unlocks cards and resets state when leave-lobby or menu-restored is dispatched on document", async () => {
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: { gameID: "ffa-game-123" },
      }),
    );
    await selector!.updateComplete;
    expect(selector!.inLobby).toBe(true);

    document.dispatchEvent(new CustomEvent("leave-lobby"));
    await selector!.updateComplete;
    expect(selector!.inLobby).toBe(false);
    expect(selector!.joiningLobbyId).toBeNull();

    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: { gameID: "ffa-game-123" },
      }),
    );
    await selector!.updateComplete;
    expect(selector!.inLobby).toBe(true);

    document.dispatchEvent(new CustomEvent("menu-restored"));
    await selector!.updateComplete;
    expect(selector!.inLobby).toBe(false);
    expect(selector!.joiningLobbyId).toBeNull();
  });

  it("displays connecting spinner and active card indicator while inLobby is true", async () => {
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: { gameID: "ffa-game-123" },
      }),
    );
    await selector!.updateComplete;

    const spinner = selector!.querySelector(".animate-spin");
    expect(spinner).not.toBeNull();

    const statusEl = selector!.querySelector('[role="status"]');
    expect(statusEl).not.toBeNull();
    expect(statusEl?.textContent).toContain("Connecting");

    const activeRing = selector!.querySelector(".ring-2.ring-malibu-blue");
    expect(activeRing).not.toBeNull();

    // After leave-lobby, visual feedback is removed
    document.dispatchEvent(new CustomEvent("leave-lobby"));
    await selector!.updateComplete;

    expect(selector!.querySelector(".animate-spin")).toBeNull();
    expect(selector!.querySelector('[role="status"]')).toBeNull();
  });

  it("resets lock immediately if join-lobby dispatch is cancelled", () => {
    const cancelJoin = vi.fn((e: Event) => e.preventDefault());
    document.addEventListener("join-lobby", cancelJoin);

    try {
      const ffaCardBtn = selector!.querySelector(
        ".min-w-0 button",
      ) as HTMLButtonElement;
      expect(ffaCardBtn).not.toBeNull();
      ffaCardBtn.click();

      expect(cancelJoin).toHaveBeenCalledTimes(1);
      expect(selector!.inLobby).toBe(false);
      expect(selector!.joiningLobbyId).toBeNull();
    } finally {
      document.removeEventListener("join-lobby", cancelJoin);
    }
  });
});
