import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import type { DesktopUpdateState } from "../src/client/DesktopShell";
import {
  backendUnreachableConfirmed,
  ensureServerList,
  resetServerList,
  retryServerList,
} from "../src/client/ServerList";
import { GameMapType, GameMode } from "../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
  PublicGameType,
} from "../src/core/Schemas";

// DetailedGameViewModal opens a public-lobby WebSocket via a class-field
// PublicLobbySocket the moment the component is constructed. jsdom has no
// WebSocket worth talking to and this test is about the join() gate, not the
// lobby list, so the socket is a no-op -- except for retaining the update
// callback the real socket would drive off the wire. Without that, `lobbies`
// never leaves `null`, no lobby card ever renders, and join() goes completely
// untested by this file.
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

// Registers <detailed-view-modal> as a side effect and gives us the class
// directly. This also pulls in GameModeSelector.ts (for
// shouldBlockMultiplayerAction), which registers <game-mode-selector> too --
// harmless, nothing in this file instantiates it.
import { DetailedGameViewModal } from "../src/client/components/DetailedGameViewModal";

function lobby(gameID: string, publicGameType: PublicGameType): PublicGameInfo {
  return {
    gameID,
    numClients: 3,
    publicGameType,
    gameConfig: {
      gameMap: GameMapType.World,
      gameMode: GameMode.FFA,
      maxPlayers: 8,
    } as unknown as GameConfig,
  };
}

/**
 * The pure predicate is covered in GameModeSelectorGating.test.ts and the
 * homepage entry points are covered in GameModeSelectorGatingWiring.test.ts.
 * Neither can see whether DetailedGameViewModal's join() -- a separate call
 * site reached from Solo -> Detailed View -> any lobby card -- actually
 * consults the gate. So this mounts the real component, drives it into a
 * gated state through the real `desktop-update-state` event, clicks a real
 * rendered lobby card, and asserts nothing proceeded.
 */
let modal: HTMLElement & { updateComplete: Promise<unknown> };
let joinModalOpen: ReturnType<typeof vi.fn>;
let wiggle: ReturnType<typeof vi.fn>;
let joinLobby: ReturnType<typeof vi.fn>;

function stub(tag: string, methods: Record<string, unknown>): void {
  const el = document.createElement(tag);
  Object.assign(el, methods);
  document.body.appendChild(el);
}

async function setUpdateState(state: DesktopUpdateState): Promise<void> {
  document.dispatchEvent(
    new CustomEvent("desktop-update-state", { detail: state }),
  );
  await modal.updateComplete;
}

/**
 * Pushes a full lobby snapshot through the (mocked) socket's own update
 * callback, exactly as the real PublicLobbySocket would on receiving a "full"
 * message -- the only way `lobbies` leaves `null` and any lobby card renders.
 */
async function pushLobbies(games: PublicGames["games"]): Promise<void> {
  lobbiesCallbackRef.current?.({ serverTime: Date.now(), games });
  await modal.updateComplete;
}

/** The rendered card button for a given lobby, or null if none rendered. */
function cardButton(gameID: string): HTMLButtonElement | null {
  return modal.querySelector(`[data-lobby-slot="${gameID}"] button.group`);
}

beforeEach(async () => {
  joinModalOpen = vi.fn();
  wiggle = vi.fn();
  joinLobby = vi.fn();
  stub("join-lobby-modal", { open: joinModalOpen });
  stub("desktop-status-bar", { wiggle });
  // join() dispatches "join-lobby" as a bubbling/composed CustomEvent rather
  // than calling a modal's open() -- catch it at the document the same way
  // Main.ts's real listener would.
  document.addEventListener("join-lobby", joinLobby as EventListener);

  lobbiesCallbackRef.current = null;
  // `new DetailedGameViewModal()` rather than
  // `document.createElement("detailed-view-modal")`: the constructor sets
  // `this.id` (for the page router), and jsdom's spec-strict
  // document.createElement path rejects a custom element whose constructor
  // touched its own attributes. Constructing directly takes jsdom's other,
  // unchecked construction branch -- real browsers tolerate this pattern
  // either way.
  modal = new DetailedGameViewModal() as unknown as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  document.body.appendChild(modal);
  await modal.updateComplete;

  await pushLobbies({
    ffa: [lobby("public-1", "ffa")],
    hosted: [lobby("hosted-1", "hosted")],
  });
});

afterEach(() => {
  document.removeEventListener("join-lobby", joinLobby as EventListener);
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the multiplayer gate at DetailedGameViewModal's join()", () => {
  it("renders real lobby cards once the socket reports them", () => {
    expect(cardButton("public-1")).not.toBeNull();
    expect(cardButton("hosted-1")).not.toBeNull();
  });

  it("emits join-lobby when ungated (public lobby)", async () => {
    await setUpdateState({ status: "current", bytes: 0, total: 0 });

    const card = cardButton("public-1");
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).toHaveBeenCalled();
    const detail = joinLobby.mock.calls[0][0].detail;
    expect(detail.gameID).toBe("public-1");
    expect(detail.source).toBe("public");
    expect(wiggle).not.toHaveBeenCalled();
  });

  it("refuses to emit join-lobby and nudges the bar while an update is downloading", async () => {
    await setUpdateState({ status: "downloading", bytes: 1, total: 100 });

    const card = cardButton("public-1");
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).not.toHaveBeenCalled();
    expect(wiggle).toHaveBeenCalled();
  });

  it("does not close the modal (or drop its lobby list) on a blocked attempt", async () => {
    await setUpdateState({ status: "downloading", bytes: 1, total: 100 });

    const card = cardButton("public-1");
    card!.click();

    // close() -> onClose() nulls out `lobbies`, which would collapse the
    // whole body to the loading spinner and remove every card. Still being
    // able to find the card proves close() did not run.
    expect(cardButton("public-1")).not.toBeNull();
  });

  it("marks cards aria-disabled while blocked", async () => {
    await setUpdateState({ status: "downloading", bytes: 1, total: 100 });

    const card = cardButton("public-1");
    expect(card?.getAttribute("aria-disabled")).toBe("true");
    // Deliberately not `disabled`/pointer-events-none -- see LobbyCard.ts.
    expect(card?.hasAttribute("disabled")).toBe(false);
  });

  it("opens join-lobby-modal for a hosted lobby when ungated", async () => {
    await setUpdateState({ status: "current", bytes: 0, total: 0 });

    const card = cardButton("hosted-1");
    expect(card).not.toBeNull();
    card!.click();

    expect(joinModalOpen).toHaveBeenCalledWith({ lobbyId: "hosted-1" });
    expect(joinLobby).not.toHaveBeenCalled();
  });

  it("refuses to open join-lobby-modal for a hosted lobby while blocked", async () => {
    await setUpdateState({ status: "downloading", bytes: 1, total: 100 });

    const card = cardButton("hosted-1");
    expect(card).not.toBeNull();
    card!.click();

    expect(joinModalOpen).not.toHaveBeenCalled();
    expect(wiggle).toHaveBeenCalled();
  });

  it("refuses while an update is staged", async () => {
    await setUpdateState({ status: "staged", bytes: 100, total: 100 });

    cardButton("public-1")!.click();
    cardButton("hosted-1")!.click();

    expect(joinLobby).not.toHaveBeenCalled();
    expect(joinModalOpen).not.toHaveBeenCalled();
  });

  it("does not refuse on a failure the player cannot retry away", async () => {
    await setUpdateState({
      status: "failed",
      bytes: 0,
      total: 0,
      error: { kind: "refused", message: "403 from the WAF" },
    });

    cardButton("public-1")!.click();

    expect(joinLobby).toHaveBeenCalled();
  });
});

/**
 * OPE-439, from the other side. The update and session halves above are
 * desktop-only and they DO refuse a card click. A confirmed backend outage
 * must not, on either shell: every lobby this browser lists arrived over a
 * live game-server socket, and the outage signal tracks the separate
 * server-list API, whose health says nothing about that server. That is the
 * reachability rule at the top of GameModeSelector.ts, and Main's join funnel
 * already follows it -- these cards are where the very joins that funnel lets
 * through are produced, so refusing them one step earlier would contradict it.
 *
 * Driven through the real ServerList module rather than a mock of it: a
 * mocked accessor could only prove this component ignores something; this
 * proves it is unmoved by the signal the heartbeat actually produces, seeded
 * before it mounted or announced afterwards.
 */
describe("DetailedGameViewModal and a confirmed backend outage", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  /**
   * Throws this modal away and mounts a fresh one, so a test can choose what
   * the module already knows BEFORE the component exists. The outer
   * beforeEach always mounts one; that one is no use for a seeding test.
   */
  async function remountModal(): Promise<void> {
    modal.remove();
    modal = new DetailedGameViewModal() as unknown as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(modal);
    await modal.updateComplete;
    await pushLobbies({ ffa: [lobby("public-1", "ffa")] });
  }

  beforeEach(() => {
    // ServerList reads the site from ClientEnv, which throws without the
    // config the server injects into index.html -- and a site it cannot
    // resolve means it never fetches at all.
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      numWorkers: 1,
      turnstileSiteKey: "",
      jwtAudience: "test",
      instanceId: "test",
      gitCommit: "test",
    };
    ClientEnv.reset();
    resetServerList();
    fetchMock = vi.fn(async () => {
      throw new TypeError("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    resetServerList();
    ClientEnv.reset();
    window.BOOTSTRAP_CONFIG = undefined;
    vi.unstubAllGlobals();
  });

  /** Two unanswered attempts in a row, which is what confirms an outage. */
  async function confirmOutage(): Promise<void> {
    await ensureServerList();
    await retryServerList();
    expect(backendUnreachableConfirmed()).toBe(true);
  }

  it("still joins a public card when it mounted during a confirmed outage", async () => {
    await confirmOutage();
    await remountModal();

    const card = cardButton("public-1");
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).toHaveBeenCalled();
    expect(joinLobby.mock.calls[0][0].detail.gameID).toBe("public-1");
    // Nothing was refused, so nothing is reported: no wiggle on desktop and
    // no toast on the web.
    expect(wiggle).not.toHaveBeenCalled();
  });

  it("still opens the join modal for a hosted card during that outage", async () => {
    await confirmOutage();
    await remountModal();
    await pushLobbies({ hosted: [lobby("hosted-1", "hosted")] });

    cardButton("hosted-1")!.click();

    expect(joinModalOpen).toHaveBeenCalledWith({ lobbyId: "hosted-1" });
  });

  it("does not dim its cards during that outage", async () => {
    await confirmOutage();
    await remountModal();

    expect(modal.querySelectorAll('button[aria-disabled="true"]').length).toBe(
      0,
    );
  });

  it("is unmoved by an outage announced while it is mounted", async () => {
    // The subscribe half of the old wiring, from the other direction: this
    // component no longer listens for "backend-reachability" at all, and an
    // event that would once have dimmed every card now changes nothing.
    await remountModal();
    document.dispatchEvent(
      new CustomEvent("backend-reachability", {
        detail: { reachable: false, confirmed: true },
      }),
    );
    await modal.updateComplete;

    expect(modal.querySelectorAll('button[aria-disabled="true"]').length).toBe(
      0,
    );
    cardButton("public-1")!.click();

    expect(joinLobby).toHaveBeenCalled();
  });

  it("still refuses on a DESKTOP reason during an outage", async () => {
    // The control that keeps this from being "the gate was deleted": the
    // update state is a statement about this client rather than about any
    // server, so it refuses the same card the outage may not.
    await confirmOutage();
    await remountModal();
    await setUpdateState({ status: "staged", bytes: 0, total: 0 });

    cardButton("public-1")!.click();

    expect(joinLobby).not.toHaveBeenCalled();
    expect(wiggle).toHaveBeenCalled();
  });

  it("does not refuse after a single missed attempt either", async () => {
    await ensureServerList();
    expect(backendUnreachableConfirmed()).toBe(false);

    await remountModal();
    cardButton("public-1")!.click();

    expect(joinLobby).toHaveBeenCalled();
  });
});
