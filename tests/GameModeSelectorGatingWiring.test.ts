import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import type { DesktopUpdateState } from "../src/client/DesktopShell";
import { GameMapType, GameMode } from "../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
} from "../src/core/Schemas";

// The component opens a public-lobby WebSocket the moment it connects. jsdom
// has no WebSocket worth talking to and this test is about the gate, not the
// lobby list, so the socket is a no-op -- except for retaining the update
// callback the real socket would drive off the wire. Without that, `lobbies`
// never leaves `null`, no public-lobby card ever renders, and
// `validateAndJoin` -- one of the four gated entry points -- goes untested by
// this whole file.
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

// Registers <game-mode-selector> as a side effect.
import "../src/client/GameModeSelector";

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
 * The pure predicate is covered in GameModeSelectorGating.test.ts. What that
 * cannot see is whether the predicate is actually CONSULTED at each entry
 * point -- a call site that forgets to ask still passes every unit test while
 * letting a stale client into a multiplayer game. So this mounts the real
 * component, drives it into a gated state through the real
 * `desktop-update-state` event the shell bridge dispatches, clicks the real
 * buttons, and asserts nothing proceeded.
 */
let selector: HTMLElement & { updateComplete: Promise<unknown> };
let joinOpen: ReturnType<typeof vi.fn>;
let hostOpen: ReturnType<typeof vi.fn>;
let wiggle: ReturnType<typeof vi.fn>;
let joinLobby: ReturnType<typeof vi.fn>;

function stub(tag: string, methods: Record<string, unknown>): void {
  const el = document.createElement(tag);
  Object.assign(el, methods);
  document.body.appendChild(el);
}

async function setUpdateState(state: DesktopUpdateState | null): Promise<void> {
  if (state !== null) {
    document.dispatchEvent(
      new CustomEvent("desktop-update-state", { detail: state }),
    );
  }
  await selector.updateComplete;
}

/** Clicks every button the selector renders. Returns how many it clicked. */
function clickEveryButton(): number {
  const buttons = Array.from(selector.querySelectorAll("button"));
  for (const button of buttons) button.click();
  return buttons.length;
}

/**
 * Pushes a full lobby snapshot through the (mocked) socket's own update
 * callback, exactly as the real PublicLobbySocket would on receiving a "full"
 * message -- the only way `lobbies` leaves `null` and a public-lobby card
 * gets rendered at all.
 */
async function pushLobbies(games: PublicGames["games"]): Promise<void> {
  lobbiesCallbackRef.current?.({ serverTime: Date.now(), games });
  await selector.updateComplete;
}

/** The rendered public-lobby card's button, or null if none rendered. */
function lobbyCardButton(): HTMLButtonElement | null {
  return selector.querySelector("button.group");
}

/** The UPCOMING heading, which is itself the link to the lobby browser. */
function upcomingHeadingButton(): HTMLButtonElement | null {
  return selector.querySelector("h2 button");
}

async function setUsernameValid(isValid: boolean): Promise<void> {
  window.dispatchEvent(
    new CustomEvent("username-validity-change", { detail: { isValid } }),
  );
  await selector.updateComplete;
}

beforeEach(async () => {
  // connectedCallback reads ClientEnv.gameCreationRate(), which throws without
  // the config the server normally injects into index.html.
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
  wiggle = vi.fn();
  joinLobby = vi.fn();
  stub("join-lobby-modal", { open: joinOpen });
  stub("host-lobby-modal", { open: hostOpen });
  stub("single-player-modal", { open: vi.fn() });
  stub("desktop-status-bar", { wiggle });
  (window as { showPage?: (id: string) => void }).showPage = vi.fn();
  // validateAndJoin dispatches "join-lobby" as a bubbling/composed CustomEvent
  // rather than calling a modal's open() -- catch it at the document the same
  // way Main.ts's real listener would.
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

describe("the multiplayer gate at its real call sites", () => {
  it("mounts and, ungated, the multiplayer entry points do proceed", async () => {
    await setUpdateState({ status: "current", bytes: 0, total: 0 });

    expect(clickEveryButton()).toBeGreaterThan(0);

    // Establishes the control: these are genuinely reachable, so the
    // assertions below are about the gate and not about a broken mount.
    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
    expect(wiggle).not.toHaveBeenCalled();
  });

  it("refuses every multiplayer entry point while an update is downloading", async () => {
    await setUpdateState({ status: "downloading", bytes: 1, total: 100 });

    clickEveryButton();

    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
    // Refusing silently would look like a broken button; the click has to land
    // somewhere, and it lands on the snackbar.
    expect(wiggle).toHaveBeenCalled();
  });

  it("refuses while an update is staged, and marks the buttons aria-disabled", async () => {
    await setUpdateState({ status: "staged", bytes: 100, total: 100 });

    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBeGreaterThan(0);

    clickEveryButton();

    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
  });

  it("does not refuse on a failure the player cannot retry away", async () => {
    await setUpdateState({
      status: "failed",
      bytes: 0,
      total: 0,
      error: { kind: "refused", message: "403 from the WAF" },
    });

    clickEveryButton();

    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
  });

  it("does refuse on a network failure, where Retry is a real remedy", async () => {
    await setUpdateState({
      status: "failed",
      bytes: 0,
      total: 0,
      error: { kind: "network", message: "offline" },
    });

    clickEveryButton();

    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
  });

  it("does refuse on a hash-verification failure, which Retry can also fix", async () => {
    // Newly gating: the descriptor parsed, so we KNOW a newer version exists,
    // and the CDN bytes not matching it is something Retry can genuinely
    // resolve. Asserted here and not only against the pure predicate, so the
    // real call sites are covered for this kind too.
    await setUpdateState({
      status: "failed",
      bytes: 0,
      total: 0,
      error: { kind: "verify", message: "sha256 mismatch" },
    });

    clickEveryButton();

    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
  });

  it("does not refuse on a malformed descriptor, which Retry cannot fix", async () => {
    await setUpdateState({
      status: "failed",
      bytes: 0,
      total: 0,
      error: { kind: "parse", message: "unsupported schemaVersion" },
    });

    clickEveryButton();

    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
  });

  it("never gates the single-player card", async () => {
    const solo = vi.fn();
    (
      document.querySelector("single-player-modal") as HTMLElement & {
        open: unknown;
      }
    ).open = solo;

    await setUpdateState({ status: "downloading", bytes: 1, total: 100 });
    clickEveryButton();

    expect(solo).toHaveBeenCalled();
  });
});

/**
 * The four cases above never render a public-lobby card at all -- the mocked
 * socket never called back, so `lobbies` stayed `null` and `validateAndJoin`
 * (the fourth gated entry point, wired to the card's own click handler
 * rather than to a modal's open()) went completely unexercised. This block
 * drives a real lobby through the same "full" callback the real
 * PublicLobbySocket would, so the rendered card and its click handler are
 * real.
 */
describe("the public lobby card (validateAndJoin)", () => {
  beforeEach(async () => {
    await pushLobbies({ ffa: [publicLobby("game-1")] });
  });

  it("renders a real lobby card once the socket reports one", () => {
    const card = lobbyCardButton();
    expect(card).not.toBeNull();
  });

  it("emits join-lobby when ungated", async () => {
    await setUpdateState({ status: "current", bytes: 0, total: 0 });

    const card = lobbyCardButton();
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).toHaveBeenCalled();
    const detail = joinLobby.mock.calls[0][0].detail;
    expect(detail.gameID).toBe("game-1");
    expect(detail.source).toBe("public");
  });

  it("refuses to emit join-lobby while an update is downloading", async () => {
    await setUpdateState({ status: "downloading", bytes: 1, total: 100 });

    const card = lobbyCardButton();
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).not.toHaveBeenCalled();
    expect(wiggle).toHaveBeenCalled();
  });

  it("refuses to emit join-lobby while an update is staged", async () => {
    await setUpdateState({ status: "staged", bytes: 100, total: 100 });

    const card = lobbyCardButton();
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).not.toHaveBeenCalled();
  });
});

/**
 * The heading over the upcoming column replaced the Detailed View card, so it
 * is the homepage's only route to the lobby browser. openDetailedView's own
 * username check is a silent backstop -- it returns without telling anyone --
 * so the control has to carry the disabled state itself, as the card it
 * replaced did.
 */
describe("the upcoming heading (the route to the lobby browser)", () => {
  beforeEach(async () => {
    await pushLobbies({ ffa: [publicLobby("game-1")] });
  });

  it("is there before any snapshot, so a dead feed can't strand the player", async () => {
    // No pushLobbies() here on purpose: `lobbies` is still null, which used to
    // replace this whole block with a spinner. The browser opens its own
    // socket, so it is worth reaching even when the homepage's never connects.
    const fresh = document.createElement(
      "game-mode-selector",
    ) as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(fresh);
    await fresh.updateComplete;

    const heading = fresh.querySelector("h2 button");
    expect(heading).not.toBeNull();
    (heading as HTMLButtonElement).click();

    expect(window.showPage).toHaveBeenCalledWith("page-detailed-view");
  });

  it("opens the browser while the username is valid", async () => {
    await setUsernameValid(true);

    const heading = upcomingHeadingButton();
    expect(heading).not.toBeNull();
    expect(heading!.disabled).toBe(false);
    heading!.click();

    expect(window.showPage).toHaveBeenCalledWith("page-detailed-view");
  });

  it("dims and stops responding once the username is invalid", async () => {
    await setUsernameValid(false);

    const heading = upcomingHeadingButton();
    expect(heading).not.toBeNull();
    expect(heading!.disabled).toBe(true);
    expect(heading!.className).toContain("cursor-not-allowed");
    heading!.click();

    expect(window.showPage).not.toHaveBeenCalledWith("page-detailed-view");
  });
});

/**
 * At sm+ the block is a placed grid, so the class strings are the layout.
 * These pin the three states where an unconditional placement collided or
 * left a track empty: loading, a snapshot with no FFA lobby, and a column
 * with only one of its two cards.
 */
describe("grid placement", () => {
  const section = () => selector.querySelector("section")!;
  const heroSlot = () =>
    selector.querySelector(":scope > div > div.sm\\:col-start-1");

  it("keeps the upcoming column beside the spinner while loading", () => {
    expect(heroSlot()).not.toBeNull();
    expect(section().className).toContain("sm:col-start-2");
    expect(section().className).not.toContain("sm:col-span-2");
  });

  it("drops the hero slot and spans the row when there is no FFA lobby", async () => {
    await pushLobbies({ team: [publicLobby("team-1")] });
    expect(heroSlot()).toBeNull();
    expect(section().className).toContain("sm:col-start-1 sm:col-span-2");
  });

  it("lets a lone card take both card rows", async () => {
    await pushLobbies({
      ffa: [publicLobby("ffa-1")],
      team: [publicLobby("t")],
    });
    const card = section().querySelector("div.sm\\:min-h-0")!;
    expect(card.className).toContain("sm:row-start-2 sm:row-span-2");
  });

  it("stacks two cards on their own rows", async () => {
    await pushLobbies({
      ffa: [publicLobby("ffa-1")],
      team: [publicLobby("t")],
      special: [publicLobby("s")],
    });
    const rows = Array.from(section().querySelectorAll("div.sm\\:min-h-0")).map(
      (c) => c.className,
    );
    expect(rows.some((c) => c.includes("sm:row-start-3"))).toBe(true);
    expect(rows.some((c) => c.includes("sm:row-span-2"))).toBe(false);
  });
});
