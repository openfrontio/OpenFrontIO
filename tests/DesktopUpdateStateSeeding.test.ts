import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import type {
  DesktopUpdateBridge,
  DesktopUpdateState,
} from "../src/client/DesktopShell";
import { GameMapType, GameMode } from "../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
} from "../src/core/Schemas";

// Both consumers open a public-lobby WebSocket the moment they connect. jsdom
// has no WebSocket worth talking to and this file is about the seed, not the
// lobby list, so the socket is a no-op -- except for retaining the update
// callback the real socket would drive off the wire, which is the only way a
// lobby card ever renders.
const { lobbiesCallbackRef } = vi.hoisted(() => ({
  lobbiesCallbackRef: { current: null as ((g: PublicGames) => void) | null },
}));

vi.mock("../src/client/LobbySocket", () => ({
  PublicLobbySocket: class {
    constructor(onUpdate: (g: PublicGames) => void) {
      lobbiesCallbackRef.current = onUpdate;
    }
    start(): void {}
    stop(): void {}
  },
}));

// Each registers its custom element as a side effect. The status bar is
// imported FIRST on purpose: that is the order Main.ts uses, and it is the
// whole reason the bug exists.
import { DesktopStatusBar } from "../src/client/components/DesktopStatusBar";
import { DetailedGameViewModal } from "../src/client/components/DetailedGameViewModal";
import "../src/client/GameModeSelector";

/**
 * OPE-396. The sibling wiring tests mount a consumer and THEN dispatch
 * `desktop-update-state` by hand, which proves each entry point consults the
 * gate. By construction they cannot see the delivery failure underneath it:
 * the shell bridge replays its current state to a new subscriber
 * SYNCHRONOUSLY, so DesktopStatusBar -- the sole subscriber and therefore the
 * sole publisher of that event -- dispatches during its own upgrade, before
 * <game-mode-selector> can exist. The dispatch is one-shot, so a consumer that
 * mounts afterwards used to gate on `null` forever: the bar read
 * "Update ready -- Reload" while multiplayer stayed wide open, which is
 * exactly the pair of symptoms reported from the Steam Playtest.
 *
 * So every test here expresses the opposite order to those files: publish
 * first, through the real bridge and the real status bar, then mount.
 */
let wiggle: Mock<() => void>;
let joinOpen: ReturnType<typeof vi.fn>;
let hostOpen: ReturnType<typeof vi.fn>;
let joinLobby: ReturnType<typeof vi.fn>;

function stub(tag: string, methods: Record<string, unknown>): void {
  const el = document.createElement(tag);
  Object.assign(el, methods);
  document.body.appendChild(el);
}

function publicLobby(gameID: string): PublicGameInfo {
  return {
    gameID,
    numClients: 3,
    publicGameType: "ffa",
    gameConfig: {
      gameMap: GameMapType.World,
      gameMode: GameMode.FFA,
      maxPlayers: 8,
    } as unknown as GameConfig,
  };
}

/**
 * Mounts the real <desktop-status-bar> against a bridge that ALREADY holds
 * `state`, replaying it synchronously on subscribe exactly as
 * openfront-desktop's updater does. The publish therefore happens here, during
 * the bar's upgrade -- before any consumer in these tests exists.
 */
function publishBeforeAnyConsumerMounts(state: DesktopUpdateState): void {
  const bridge: DesktopUpdateBridge = {
    subscribe(cb) {
      cb(state); // the synchronous replay -- see updater.ts's subscribe()
      return () => {};
    },
    apply: async () => {},
    retry: async () => {},
  };
  (window as { openfrontDesktop?: unknown }).openfrontDesktop = {
    update: bridge,
  };
  document.body.appendChild(document.createElement("desktop-status-bar"));
}

/** Mounts <game-mode-selector> and lets it render. */
async function mountSelector(): Promise<
  HTMLElement & { updateComplete: Promise<unknown> }
> {
  const selector = document.createElement(
    "game-mode-selector",
  ) as HTMLElement & { updateComplete: Promise<unknown> };
  document.body.appendChild(selector);
  await selector.updateComplete;
  return selector;
}

/** Mounts <detailed-view-modal> with one rendered lobby card. */
async function mountModal(): Promise<
  HTMLElement & { updateComplete: Promise<unknown> }
> {
  // `new DetailedGameViewModal()` rather than document.createElement: the
  // constructor sets `this.id`, which jsdom's spec-strict createElement path
  // rejects. See DetailedGameViewModalGatingWiring.test.ts.
  const modal = new DetailedGameViewModal() as unknown as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  document.body.appendChild(modal);
  await modal.updateComplete;
  lobbiesCallbackRef.current?.({
    serverTime: Date.now(),
    games: { ffa: [publicLobby("public-1")] },
  });
  await modal.updateComplete;
  return modal;
}

/** Clicks every button a component renders. Returns how many it clicked. */
function clickEveryButton(host: HTMLElement): number {
  const buttons = Array.from(host.querySelectorAll("button"));
  for (const button of buttons) button.click();
  return buttons.length;
}

const STAGED: DesktopUpdateState = { status: "staged", bytes: 10, total: 10 };
const CURRENT: DesktopUpdateState = { status: "current", bytes: 0, total: 0 };

beforeEach(() => {
  // GameModeSelector's connectedCallback reads ClientEnv.gameCreationRate(),
  // which throws without the config the server injects into index.html.
  window.BOOTSTRAP_CONFIG = {
    gameEnv: "dev",
    numWorkers: 1,
    turnstileSiteKey: "",
    jwtAudience: "test",
    instanceId: "test",
    gitCommit: "test",
  };
  ClientEnv.reset();

  joinOpen = vi.fn();
  hostOpen = vi.fn();
  joinLobby = vi.fn();
  stub("join-lobby-modal", { open: joinOpen });
  stub("host-lobby-modal", { open: hostOpen });
  stub("single-player-modal", { open: vi.fn() });
  // The real bar is the publisher here, so spy on the real method rather than
  // standing in a fake element the way the wiring tests do.
  wiggle = vi.fn<() => void>();
  vi.spyOn(DesktopStatusBar.prototype, "wiggle").mockImplementation(wiggle);

  document.addEventListener("join-lobby", joinLobby as EventListener);
  lobbiesCallbackRef.current = null;
});

afterEach(() => {
  document.removeEventListener("join-lobby", joinLobby as EventListener);
  document.body.innerHTML = "";
  (window as { openfrontDesktop?: unknown }).openfrontDesktop = undefined;
  window.BOOTSTRAP_CONFIG = undefined;
  ClientEnv.reset();
  vi.restoreAllMocks();
});

describe("a consumer mounting AFTER the update state was published", () => {
  it("gates every GameModeSelector entry point on a staged update", async () => {
    publishBeforeAnyConsumerMounts(STAGED);

    const selector = await mountSelector();

    // No `desktop-update-state` event is dispatched anywhere below: the only
    // one this document will ever see already fired, during the status bar's
    // upgrade above. The seed is the sole path by which the selector can know.
    expect(clickEveryButton(selector)).toBeGreaterThan(0);

    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
    // Refusing silently would look like a broken button.
    expect(wiggle).toHaveBeenCalled();
  });

  it("marks the selector's multiplayer buttons aria-disabled", async () => {
    publishBeforeAnyConsumerMounts(STAGED);

    const selector = await mountSelector();

    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBeGreaterThan(0);
  });

  it("still lets the selector through when the state published was healthy", async () => {
    // The control. Without it, a selector that gated for some unrelated reason
    // -- or never mounted at all -- would pass the assertions above.
    publishBeforeAnyConsumerMounts(CURRENT);

    const selector = await mountSelector();
    expect(clickEveryButton(selector)).toBeGreaterThan(0);

    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
    expect(wiggle).not.toHaveBeenCalled();
  });

  it("gates DetailedGameViewModal's join() on a staged update", async () => {
    publishBeforeAnyConsumerMounts(STAGED);

    const modal = await mountModal();
    const card = modal.querySelector<HTMLButtonElement>(
      '[data-lobby-slot="public-1"] button.group',
    );
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).not.toHaveBeenCalled();
    expect(wiggle).toHaveBeenCalled();
  });

  it("still lets the modal through when the state published was healthy", async () => {
    publishBeforeAnyConsumerMounts(CURRENT);

    const modal = await mountModal();
    const card = modal.querySelector<HTMLButtonElement>(
      '[data-lobby-slot="public-1"] button.group',
    );
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).toHaveBeenCalled();
    expect(joinLobby.mock.calls[0][0].detail.gameID).toBe("public-1");
  });
});
