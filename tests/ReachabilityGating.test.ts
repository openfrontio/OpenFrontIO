import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../src/client/ClientEnv";
import {
  attemptInFlight,
  backendUnreachableConfirmed,
  ensureServerList,
  MANUAL_RETRY_COOLDOWN_MS,
  resetServerList,
  retryServerList,
} from "../src/client/ServerList";
import { GameMapType, GameMode } from "../src/core/game/Game";
import type {
  GameConfig,
  PublicGameInfo,
  PublicGames,
} from "../src/core/Schemas";

// The component opens a public-lobby WebSocket the moment it connects. jsdom
// has no WebSocket worth talking to and this file is about the gate, not the
// lobby list, so the socket is a no-op -- except for retaining the update
// callback the real socket would drive off the wire, which is the only way a
// public-lobby card (one of the gated entry points) ever renders.
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

/**
 * OPE-439. The server-list heartbeat already knows whether the API answers;
 * this is the half that turns that into something the player can see, on the
 * WEB as well as on desktop -- which is what separates it from the desktop
 * update/session gates the sibling files cover.
 *
 * Everything here runs against the real ServerList module, driven by a
 * stubbed fetch. A mocked backendReachable() would prove the call sites
 * consult *something*, but not that the signal the heartbeat actually
 * produces is the one they consult, nor that a component mounting after the
 * first attempt settles can still find it.
 */
let selector: HTMLElement & { updateComplete: Promise<unknown> };
let joinOpen: ReturnType<typeof vi.fn>;
let hostOpen: ReturnType<typeof vi.fn>;
let wiggle: ReturnType<typeof vi.fn>;
let joinLobby: ReturnType<typeof vi.fn>;
let messages: string[];
let fetchMock: ReturnType<typeof vi.fn>;
// Added to the real clock, so a test can step past the manual-retry cooldown
// without waiting out five real seconds. Only Date.now is moved: ServerList's
// throttles are all clock comparisons, and faking timers wholesale would
// stall Lit's own scheduling.
let clockOffset: number;

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

/** Mounts <game-mode-selector> with one rendered public-lobby card. */
async function mountSelector(): Promise<
  HTMLElement & { updateComplete: Promise<unknown> }
> {
  const el = document.createElement("game-mode-selector") as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  document.body.appendChild(el);
  await el.updateComplete;
  lobbiesCallbackRef.current?.({
    serverTime: Date.now(),
    games: { ffa: [publicLobby("public-1")] },
  });
  await el.updateComplete;
  return el;
}

/** Clicks every button the selector renders. Returns how many it clicked. */
function clickEveryButton(): number {
  const buttons = Array.from(selector.querySelectorAll("button"));
  for (const button of buttons) button.click();
  return buttons.length;
}

/**
 * The rendered public-lobby card's button. Socket-sourced: whatever the
 * server-list API is doing, this one must keep working (the reachability rule
 * at the top of GameModeSelector.ts).
 */
function lobbyCardButton(): HTMLButtonElement | null {
  return selector.querySelector("button.group");
}

/** Announces a reachability change the way the heartbeat does. */
async function announce(reachable: boolean, confirmed = false): Promise<void> {
  document.dispatchEvent(
    new CustomEvent("backend-reachability", {
      detail: { reachable, confirmed },
    }),
  );
  await selector.updateComplete;
}

/**
 * Drives the real module through enough failed attempts that the outage is
 * confirmed. Uses the manual retry for the second one so the test does not
 * have to wait out the heartbeat's retry interval.
 */
async function confirmOutage(): Promise<void> {
  fetchMock.mockImplementation(async () => {
    throw new TypeError("network down");
  });
  await ensureServerList();
  await retryServerList();
  expect(backendUnreachableConfirmed()).toBe(true);
}

beforeEach(() => {
  // connectedCallback reads ClientEnv.gameCreationRate(), which throws
  // without the config the server injects into index.html. No serverHost and
  // no openfrontDesktop: this is the web build, where the update and session
  // gates do not exist and reachability is the only one that can fire.
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

  fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  clockOffset = 0;
  const realNow = Date.now.bind(Date);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffset);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});

  joinOpen = vi.fn();
  hostOpen = vi.fn();
  wiggle = vi.fn();
  joinLobby = vi.fn();
  stub("join-lobby-modal", { open: joinOpen });
  stub("host-lobby-modal", { open: hostOpen });
  stub("single-player-modal", { open: vi.fn() });
  // Present on the web too -- index.html mounts it on every build and it
  // simply renders nothing there -- which is exactly why the web message
  // cannot key on whether this element exists.
  stub("desktop-status-bar", { wiggle });
  (window as { showPage?: (id: string) => void }).showPage = vi.fn();
  document.addEventListener("join-lobby", joinLobby as EventListener);

  messages = [];
  window.addEventListener("show-message", (e) => {
    messages.push((e as CustomEvent).detail?.message);
  });

  lobbiesCallbackRef.current = null;
});

afterEach(() => {
  document.removeEventListener("join-lobby", joinLobby as EventListener);
  document.body.innerHTML = "";
  window.BOOTSTRAP_CONFIG = undefined;
  ClientEnv.reset();
  resetServerList();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the multiplayer entry points while the backend is unreachable", () => {
  it("lets everything through before the first attempt has settled", async () => {
    // The rule that matters most: a player must never be locked out of
    // multiplayer on a suspicion we have not even tested yet. Every page is
    // in this state for its first few hundred milliseconds.
    selector = await mountSelector();
    expect(backendUnreachableConfirmed()).toBe(false);

    expect(clickEveryButton()).toBeGreaterThan(0);

    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBe(0);
    expect(messages).toEqual([]);
  });

  it("lets everything through after a SINGLE missed attempt", async () => {
    // One timed-out heartbeat is a blip. The cached list is still serving,
    // the next request would very likely work, and dimming every button for
    // a retry interval over it -- with no Retry on the web to escape with --
    // takes the game away for no good reason.
    selector = await mountSelector();
    await announce(false, false);

    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBe(0);
    expect(clickEveryButton()).toBeGreaterThan(0);
    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
    expect(messages).toEqual([]);
  });

  it("dims and refuses the API-DEPENDENT entry points once the outage is confirmed", async () => {
    // Create, Ranked and Join-by-code each have to resolve a server for
    // something nothing has told this client about, so a dead list API really
    // does mean the click cannot work.
    selector = await mountSelector();
    await announce(false, true);

    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBeGreaterThan(0);
    clickEveryButton();

    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
  });

  it("still joins the public lobby card during a confirmed outage", async () => {
    // The rule (GameModeSelector, top of file): this lobby arrived over a
    // live game-server socket, which is the only liveness the join needs. The
    // server-list API's health says nothing about that server, and Main's
    // funnel would let the very same join through -- so refusing here would
    // only reject a join that is already under way.
    selector = await mountSelector();
    await announce(false, true);

    const card = lobbyCardButton();
    expect(card).not.toBeNull();
    card!.click();

    expect(joinLobby).toHaveBeenCalled();
    expect(joinLobby.mock.calls[0][0].detail.gameID).toBe("public-1");
  });

  it("does not dim the public lobby card during a confirmed outage", async () => {
    selector = await mountSelector();
    await announce(false, true);

    expect(lobbyCardButton()?.getAttribute("aria-disabled")).toBe("false");
  });

  it("says nothing when a card click goes through during an outage", async () => {
    // The toast is for a REFUSAL. A join that proceeded has nothing to
    // apologise for, and telling the player the servers are unreachable while
    // taking them into a game would be a lie.
    selector = await mountSelector();
    await announce(false, true);

    lobbyCardButton()!.click();

    expect(messages).toEqual([]);
  });

  it("says why, on the web, where there is no status bar to read", async () => {
    selector = await mountSelector();
    await announce(false, true);

    clickEveryButton();

    // Refusing silently would look like a broken button, and unlike the
    // desktop gates there is nothing else on screen naming the reason.
    expect(messages).toContain("common.backend_unreachable");
  });

  it("re-enables everything when the backend comes back", async () => {
    selector = await mountSelector();
    await announce(false, true);
    clickEveryButton();
    expect(joinOpen).not.toHaveBeenCalled();

    await announce(true);

    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBe(0);
    expect(clickEveryButton()).toBeGreaterThan(0);
    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
  });

  it("leaves single-player alone", async () => {
    selector = await mountSelector();
    const soloOpen = vi.fn();
    (
      document.querySelector("single-player-modal") as unknown as {
        open: () => void;
      }
    ).open = soloOpen;
    await announce(false, true);

    clickEveryButton();

    // Bot games run entirely in-client: an unreachable backend is no reason
    // to refuse one, and refusing would break the desktop build's core
    // offline promise.
    expect(soloOpen).toHaveBeenCalled();
  });

  it("gates a selector that mounted after the outage was already confirmed", async () => {
    // The seed half. No "backend-reachability" event is dispatched anywhere
    // below: the only ones this document will ever see fired while nothing
    // was listening, so the accessor is the sole path by which the selector
    // can know. This is OPE-396's bug, on a new signal.
    await confirmOutage();

    selector = await mountSelector();

    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBeGreaterThan(0);
    clickEveryButton();
    expect(joinOpen).not.toHaveBeenCalled();
    expect(hostOpen).not.toHaveBeenCalled();
    // ...and the card that came over the socket still joins, from the same
    // seed.
    expect(joinLobby).toHaveBeenCalled();
  });

  it("does not gate a selector that mounted after an attempt SUCCEEDED", async () => {
    // The control for the seed: a 404 is an answer, so a site with no list
    // at all is still a reachable backend.
    await ensureServerList();
    expect(backendUnreachableConfirmed()).toBe(false);

    selector = await mountSelector();

    expect(clickEveryButton()).toBeGreaterThan(0);
    expect(joinOpen).toHaveBeenCalled();
    expect(hostOpen).toHaveBeenCalled();
  });
});

/**
 * The web's escape hatch. Desktop has the status bar's Retry button; the web
 * has no bar at all, so without this the only way out of a gated state is the
 * heartbeat's next beat -- and that backs off to as much as RETRY_MAX_MS once
 * an outage has run a while. A toast reading "Check your connection and try
 * again" over a button where trying again provably does nothing is worse than
 * no toast, so on the web the refused click IS the retry.
 *
 * Driven through the real ServerList module: the point is that the click
 * reaches the same probe the desktop button does, throttled by the same
 * policy (manualRetryAvailable) and the same clock.
 */
describe("a refused multiplayer click on the web", () => {
  /** Past the shared manual-retry cooldown, so a probe is available again. */
  function advancePastRetryCooldown(): void {
    clockOffset += MANUAL_RETRY_COOLDOWN_MS + 1;
  }

  /** Mounts a selector against a module that has already confirmed an outage. */
  async function mountGated(): Promise<void> {
    await confirmOutage();
    selector = await mountSelector();
    // confirmOutage's own manual retry started the cooldown; step past it so
    // each test starts from "a probe is available".
    advancePastRetryCooldown();
  }

  it("probes the API again", async () => {
    await mountGated();
    const before = fetchMock.mock.calls.length;

    clickEveryButton();

    expect(messages).toContain("common.backend_unreachable");
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("collapses a flurry of refused clicks into a single probe", async () => {
    // Three gated entry points are clicked in that one pass. The first starts
    // an attempt; while it is in flight the rest could only join it, so
    // offering them a request each would just point traffic at a backend that
    // is already known to be struggling.
    await mountGated();
    const before = fetchMock.mock.calls.length;

    clickEveryButton();

    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it("does not probe again inside the cooldown, but still says why", async () => {
    await mountGated();
    clickEveryButton();
    await vi.waitFor(() => expect(attemptInFlight()).toBe(false));
    const after = fetchMock.mock.calls.length;
    messages.length = 0;

    clickEveryButton();

    expect(fetchMock.mock.calls.length).toBe(after);
    // The player is still being refused, so they are still told so: the
    // throttle is on the request, not on the explanation.
    expect(messages).toContain("common.backend_unreachable");
  });

  it("probes again once the cooldown has elapsed", async () => {
    await mountGated();
    clickEveryButton();
    await vi.waitFor(() => expect(attemptInFlight()).toBe(false));
    const after = fetchMock.mock.calls.length;

    advancePastRetryCooldown();
    clickEveryButton();

    expect(fetchMock.mock.calls.length).toBe(after + 1);
  });

  it("lets the player back in when the probe finds the backend up", async () => {
    // End to end: a refused click starts the probe, the probe answers, the
    // reachability event that carries the answer un-dims the buttons, and the
    // next click goes through. No Retry button involved anywhere.
    await mountGated();
    fetchMock.mockImplementation(
      async () =>
        new Response("{}", {
          status: 404,
        }),
    );

    clickEveryButton();
    await vi.waitFor(() => expect(backendUnreachableConfirmed()).toBe(false));
    await selector.updateComplete;

    expect(
      selector.querySelectorAll('button[aria-disabled="true"]').length,
    ).toBe(0);
    expect(clickEveryButton()).toBeGreaterThan(0);
    expect(hostOpen).toHaveBeenCalled();
    expect(joinOpen).toHaveBeenCalled();
  });

  it("does not probe when the click was not refused", async () => {
    // The control. A healthy page clicks the same buttons; nothing here may
    // turn an ordinary click into an extra request.
    selector = await mountSelector();
    const before = fetchMock.mock.calls.length;

    clickEveryButton();

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("does not probe on a card click that goes through", async () => {
    // Socket-sourced: it was never refused, so there is nothing to retry.
    await mountGated();
    const before = fetchMock.mock.calls.length;

    lobbyCardButton()!.click();

    expect(joinLobby).toHaveBeenCalled();
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
