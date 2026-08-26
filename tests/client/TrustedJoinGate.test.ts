import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
} from "../../src/core/Schemas";

// Same socket stand-in as GameModeSelectorGatingWiring: keep the update
// callback so a lobby snapshot can be pushed in and a card rendered.
const { lobbiesCallbackRef } = vi.hoisted(() => ({
  lobbiesCallbackRef: { current: null as ((g: PublicGames) => void) | null },
}));

vi.mock("../../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    constructor(onUpdate: (g: PublicGames) => void) {
      lobbiesCallbackRef.current = onUpdate;
    }
    start(): void {}
    stop(): void {}
  },
}));

// Registers <game-mode-selector> as a side effect.
import "../../src/client/GameModeSelector";

function lobby(trusted: boolean): PublicGameInfo {
  return {
    gameID: "trust001",
    numClients: 3,
    publicGameType: "ffa",
    gameConfig: {
      gameMap: GameMapType.World,
      gameMode: GameMode.FFA,
      maxPlayers: 8,
      trusted,
    } as unknown as GameConfig,
  };
}

let selector: HTMLElement & { updateComplete: Promise<unknown> };
let joinLobby: ReturnType<typeof vi.fn>;

async function pushLobby(l: PublicGameInfo): Promise<void> {
  lobbiesCallbackRef.current?.({ serverTime: Date.now(), games: { ffa: [l] } });
  await selector.updateComplete;
}

async function setViewerTrust(trustTier: string): Promise<void> {
  document.dispatchEvent(
    new CustomEvent("userMeResponse", { detail: { player: { trustTier } } }),
  );
  await selector.updateComplete;
}

async function clickCard(): Promise<void> {
  const card = selector.querySelector("button.group") as HTMLButtonElement;
  expect(card).not.toBeNull();
  card.click();
  await selector.updateComplete;
}

const dialog = () => selector.querySelector("confirm-dialog");

beforeEach(async () => {
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "",
    jwtAudience: "test",
    instanceId: "test",
    gitCommit: "test",
  };
  ClientEnv.reset();
  joinLobby = vi.fn();
  document.addEventListener("join-lobby", joinLobby as EventListener);
  lobbiesCallbackRef.current = null;
  selector = document.createElement("game-mode-selector") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  document.body.appendChild(selector);
  await selector.updateComplete;
});

afterEach(() => {
  document.removeEventListener("join-lobby", joinLobby as EventListener);
  document.body.innerHTML = "";
  window.BOOTSTRAP_CONFIG = undefined;
  ClientEnv.reset();
  vi.restoreAllMocks();
});

describe("joining a trusted-only lobby from the homepage", () => {
  it("shows the trust popup instead of joining when the viewer is untrusted", async () => {
    await pushLobby(lobby(true));
    await setViewerTrust("untrusted");
    await clickCard();
    expect(joinLobby).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("closes the popup on dismiss", async () => {
    await pushLobby(lobby(true));
    await clickCard();
    expect(dialog()).not.toBeNull();
    dialog()!.dispatchEvent(new CustomEvent("cancel"));
    await selector.updateComplete;
    expect(dialog()).toBeNull();
  });

  it("joins when the viewer is trusted", async () => {
    await pushLobby(lobby(true));
    await setViewerTrust("trusted");
    await clickCard();
    expect(joinLobby).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("joins an open lobby regardless of trust", async () => {
    await pushLobby(lobby(false));
    await clickCard();
    expect(joinLobby).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });
});
