import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import { CloseCode, CloseReason } from "../../src/core/CloseCodes";

const apiMocks = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

// The two ClientEnv reads the version check below depends on: this bundle's
// commit, and the commit the matched game's server runs (the API's list).
const envMocks = vi.hoisted(() => ({
  gitCommit: vi.fn(() => "bfd5563a11111111111111111111111111111111"),
  gameVersion: vi.fn((_gameID: string): string | undefined => undefined),
}));

// Deliberately NOT mocking the identity predicate. The previous version of
// this file stubbed it to `() => true`, which is precisely why these tests
// stayed green while Steam-only players were being hard-rejected from ranked
// (OPE-260). The gate is exercised for real below.
vi.mock("../../src/client/Api", () => ({
  getUserMe: apiMocks.getUserMe,
  invalidateUserMe: apiMocks.invalidateUserMe,
}));

vi.mock("../../src/client/Auth", () => ({
  getPlayToken: vi.fn(async () => "play-token"),
}));

vi.mock("../../src/client/ClientEnv", () => ({
  ClientEnv: {
    instanceId: vi.fn(() => "test-instance"),
    jwtIssuer: vi.fn(() => "ws://matchmaking.test"),
    workerPath: vi.fn(() => "w0"),
    gitCommit: envMocks.gitCommit,
    gameVersion: envMocks.gameVersion,
    gamePath: vi.fn((gameID: string) => `/w0/game/${gameID}`),
    gameHttpBase: vi.fn(() => "https://falk2-a.openfront.io"),
    gameWorkerPath: vi.fn(() => "w0"),
  },
}));

// Only the network half is stubbed. redirectToGameVersion is the real
// decision -- it is the thing under test below, and stubbing it would prove
// nothing about which games actually navigate.
vi.mock("../../src/client/ServerList", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/ServerList")>()),
  ensureServerList: vi.fn(async () => "api" as const),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    getUserProfile: vi.fn(async () => null),
  },
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

import { MatchmakingModal } from "../../src/client/Matchmaking";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  serverClose(code: number, reason: string) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }
}

const sockets: FakeWebSocket[] = [];

// A Steam-only session, exactly as the API sends it: `user.steam` and nothing
// else. See infra `users/@me/GET.ts` — buildLinkedIdentities() emits each
// identity independently, and the steam login path never writes players.email.
const STEAM_ONLY_USER = {
  steam: {
    steamId: "76561198000000000",
    personaName: "Player",
    avatarUrl: null,
  },
} as UserMeResponse["user"];

function userMe(
  clanTags: string[] = [],
  user: UserMeResponse["user"] = {
    email: "player@example.com",
  } as UserMeResponse["user"],
): UserMeResponse {
  return {
    user,
    player: {
      publicId: "player-id",
      adfree: false,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      achievements: { singleplayerMap: [] },
      clans: clanTags.map((tag) => ({
        tag,
        name: `Clan ${tag}`,
        role: "member" as const,
        joinedAt: "2026-01-01T00:00:00.000Z",
        memberCount: 2,
      })),
      friends: [],
      subscription: null,
    },
  };
}

function installClanSelection(tag: string | null) {
  const input = document.createElement("div") as HTMLDivElement & {
    getClanTag: () => string | null;
    clearClanTag: ReturnType<typeof vi.fn>;
  };
  input.setAttribute("data-test-username-input", "");
  input.getClanTag = () => tag;
  input.clearClanTag = vi.fn();
  vi.spyOn(document, "querySelector").mockImplementation((selector) =>
    selector === "username-input" ? input : null,
  );
  return input;
}

async function openAndJoin(mode: "1v1" | "2v2") {
  const modal = new MatchmakingModal();
  modal.mode = mode;
  modal.open();
  await vi.waitFor(() => expect(sockets).toHaveLength(1));

  sockets[0].open();
  await vi.advanceTimersByTimeAsync(2000);
  expect(sockets[0].sent).toHaveLength(1);
  return {
    modal,
    socket: sockets[0],
    message: JSON.parse(sockets[0].sent[0]) as Record<string, unknown>,
  };
}

describe("MatchmakingModal clan-aware joins", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.invalidateUserMe.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the selected current membership for 2v2", async () => {
    apiMocks.getUserMe.mockResolvedValue(userMe(["ALLY", "BETA"]));
    installClanSelection("ally");

    const { message } = await openAndJoin("2v2");

    expect(message).toEqual({
      type: "join",
      jwt: "play-token",
      clanTag: "ALLY",
    });
  });

  it("omits clanTag when 2v2 has no selected current membership", async () => {
    apiMocks.getUserMe.mockResolvedValue(userMe(["ALLY"]));
    installClanSelection("STALE");

    const { message } = await openAndJoin("2v2");

    expect(message).toEqual({ type: "join", jwt: "play-token" });
    expect(message).not.toHaveProperty("clanTag");
  });

  it("leaves 1v1 joins unchanged", async () => {
    apiMocks.getUserMe.mockResolvedValue(userMe(["ALLY"]));
    installClanSelection("ALLY");

    const { message } = await openAndJoin("1v1");

    expect(message).toEqual({ type: "join", jwt: "play-token" });
    expect(message).not.toHaveProperty("clanTag");
  });

  it("refreshes memberships and clears a stale selection on invalid_clan", async () => {
    apiMocks.getUserMe
      .mockResolvedValueOnce(userMe(["ALLY"]))
      .mockResolvedValueOnce(userMe());
    const input = installClanSelection("ALLY");
    const showMessage = vi.fn();
    window.addEventListener("show-message", showMessage);

    const { modal, socket } = await openAndJoin("2v2");
    socket.serverClose(CloseCode.InvalidClan, CloseReason.InvalidClan);

    await vi.waitFor(() => expect(apiMocks.getUserMe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(input.clearClanTag).toHaveBeenCalledWith("ALLY"),
    );
    expect(apiMocks.invalidateUserMe).toHaveBeenCalledOnce();
    expect(modal.isOpen()).toBe(false);
    expect(showMessage).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
    window.removeEventListener("show-message", showMessage);
  });

  it("shows a retryable error without reconnecting on verification failure", async () => {
    apiMocks.getUserMe.mockResolvedValue(userMe(["ALLY"]));
    installClanSelection("ALLY");
    const showMessage = vi.fn();
    window.addEventListener("show-message", showMessage);

    const { modal, socket } = await openAndJoin("2v2");
    socket.serverClose(
      CloseCode.ClanVerificationFailed,
      CloseReason.ClanVerificationFailed,
    );
    await vi.runAllTimersAsync();

    expect(modal.isOpen()).toBe(false);
    expect(apiMocks.invalidateUserMe).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
    window.removeEventListener("show-message", showMessage);
  });

  // The deployed matchmaking service still closes with 1008/1011 and a bare
  // reason. Until it ships the 41xx codes, those must land on the same
  // branches — not on the generic rejoin-with-backoff path.
  describe("legacy 1008/1011 rejections from the live service", () => {
    it("still stops on ranked_limit_reached", async () => {
      apiMocks.getUserMe.mockResolvedValue(userMe());
      const { modal, socket } = await openAndJoin("1v1");
      socket.serverClose(1008, "ranked_limit_reached");
      await vi.runAllTimersAsync();

      expect(modal.isOpen()).toBe(true);
      expect((modal as unknown as { limitReached: boolean }).limitReached).toBe(
        true,
      );
      expect(sockets).toHaveLength(1);
    });

    it("still clears the clan selection on invalid_clan", async () => {
      apiMocks.getUserMe
        .mockResolvedValueOnce(userMe(["ALLY"]))
        .mockResolvedValueOnce(userMe());
      const input = installClanSelection("ALLY");

      const { modal, socket } = await openAndJoin("2v2");
      socket.serverClose(1008, "invalid_clan");

      await vi.waitFor(() =>
        expect(input.clearClanTag).toHaveBeenCalledWith("ALLY"),
      );
      expect(modal.isOpen()).toBe(false);
      expect(sockets).toHaveLength(1);
    });

    it("still reports clan_verification_failed without reconnecting", async () => {
      apiMocks.getUserMe.mockResolvedValue(userMe(["ALLY"]));
      installClanSelection("ALLY");
      const showMessage = vi.fn();
      window.addEventListener("show-message", showMessage);

      const { modal, socket } = await openAndJoin("2v2");
      socket.serverClose(1011, "clan_verification_failed");
      await vi.runAllTimersAsync();

      expect(modal.isOpen()).toBe(false);
      expect(showMessage).toHaveBeenCalledOnce();
      expect(sockets).toHaveLength(1);
      window.removeEventListener("show-message", showMessage);
    });
  });
});

// The ranked lockout (OPE-260). A Steam-only account is a real, authenticated
// session, but the retired `hasLinkedAccount` predicate had no steam term, so
// this gate rejected it: must_login toast, modal closed, redirect to the
// account page — with no way through. Steam-only is the default state for
// anyone who buys on Steam and never links another provider.
describe("MatchmakingModal identity gate", () => {
  let showPage: Mock<(page: string) => void>;
  let showMessage: Mock<(event: Event) => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.invalidateUserMe.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    showPage = vi.fn<(page: string) => void>();
    (window as unknown as { showPage: unknown }).showPage = showPage;
    showMessage = vi.fn<(event: Event) => void>();
    window.addEventListener("show-message", showMessage);
    installClanSelection(null);
  });

  afterEach(() => {
    window.removeEventListener("show-message", showMessage);
    delete (window as unknown as { showPage?: unknown }).showPage;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function openWith(response: UserMeResponse | false) {
    apiMocks.getUserMe.mockResolvedValue(response);
    const modal = new MatchmakingModal();
    modal.mode = "1v1";
    modal.open();
    await vi.waitFor(() => expect(apiMocks.getUserMe).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(0);
    return modal;
  }

  it("admits a Steam-only account to ranked matchmaking", async () => {
    const modal = await openWith(userMe([], STEAM_ONLY_USER));

    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(modal.isOpen()).toBe(true);
    expect(showPage).not.toHaveBeenCalled();
    expect(showMessage).not.toHaveBeenCalled();
  });

  it("admits an email account to ranked matchmaking", async () => {
    await openWith(userMe());

    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    expect(showPage).not.toHaveBeenCalled();
  });

  it("still rejects a genuinely absent session", async () => {
    const modal = await openWith(false);

    await vi.waitFor(() =>
      expect(showPage).toHaveBeenCalledWith("page-account"),
    );
    expect(sockets).toHaveLength(0);
    expect(modal.isOpen()).toBe(false);
    expect(showMessage).toHaveBeenCalledOnce();
  });

  it("still rejects a session with no linked identity at all", async () => {
    const modal = await openWith(userMe([], {} as UserMeResponse["user"]));

    await vi.waitFor(() =>
      expect(showPage).toHaveBeenCalledWith("page-account"),
    );
    expect(sockets).toHaveLength(0);
    expect(modal.isOpen()).toBe(false);
  });
});

/**
 * What close() actually does, as opposed to who calls it.
 *
 * Main.blockedJoin calls this modal's close() when it refuses a matchmade
 * join -- on desktop, over a pending update or a lapsed session; backend
 * reachability is not a funnel input (OPE-439) -- and the tests for that spy
 * on close() because their claim is which joins reach it. That spy is only worth anything if the real close()
 * genuinely takes the player out of the queue -- so that half is pinned here,
 * against a real modal and its real socket, where it belongs.
 *
 * The queue is in-memory on the server and keyed to the socket, so "left the
 * queue" IS "the socket is shut". The timers matter just as much: the
 * watchdog exists to reconnect through a dropped connection, and a watchdog
 * left running after a close would put the player straight back in the queue
 * they just left.
 */
describe("MatchmakingModal.close() teardown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.invalidateUserMe.mockReset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shuts the queue socket and cancels the watchdog", async () => {
    apiMocks.getUserMe.mockResolvedValue(userMe());
    const { modal, socket } = await openAndJoin("1v1");
    expect(socket.readyState).toBe(FakeWebSocket.OPEN);

    modal.close();

    expect(socket.readyState).toBe(FakeWebSocket.CLOSED);
    // The watchdog fires after 15s of server silence and reconnects, which
    // would open a second socket and re-queue the player. Well past that and
    // past every reconnect backoff, there is still only the one.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("does not reconnect when the server's close frame lands afterwards", async () => {
    // Shutting a socket produces a close frame, and the ordinary handling of
    // one is "the service restarted, rejoin". After a deliberate close that
    // would silently put the player back in the queue they were just taken
    // out of, which is the failure mode intentionalClose exists to prevent.
    apiMocks.getUserMe.mockResolvedValue(userMe());
    const { modal, socket } = await openAndJoin("1v1");

    modal.close();
    socket.serverClose(1011, "");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });
});

// A match can land on a server running another build, and being bounced at
// join time costs a ranked game its start deadline (OPE-471). The question
// is asked exactly once: /exists has said there is a game, nothing has been
// joined yet.
describe("MatchmakingModal opens the match at its server's version", () => {
  const OWN = "bfd5563a11111111111111111111111111111111";
  const OLD = "5ccc50a722222222222222222222222222222222";
  // What `/v/<commit>/` carries: the bucket layout and the static Worker
  // both key on the first 7 characters.
  const SHORT_OLD = "5ccc50a";
  const GAME_ID = "cAbCd12345";

  const realLocation = window.location;
  let fetchMock: ReturnType<typeof vi.fn>;

  function stubLocation(host: string, pathname = "/") {
    const loc = {
      protocol: "https:",
      host,
      hostname: host,
      pathname,
      search: "",
      href: `https://${host}${pathname}`,
    };
    Object.defineProperty(window, "location", {
      value: loc,
      writable: true,
      configurable: true,
    });
    return loc;
  }

  // Drives a modal from an empty queue to just after checkGame has seen the
  // match's game exist.
  async function matchAndCheck() {
    const joined = vi.fn();
    const { modal, socket } = await openAndJoin("1v1");
    modal.addEventListener("join-lobby", joined);

    socket.onmessage!({
      data: JSON.stringify({ type: "match-assignment", gameId: GAME_ID }),
    });
    await vi.advanceTimersByTimeAsync(1000);

    return { modal, joined };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.getUserMe.mockResolvedValue(userMe());
    apiMocks.invalidateUserMe.mockReset();
    envMocks.gitCommit.mockReturnValue(OWN);
    envMocks.gameVersion.mockReturnValue(undefined);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ exists: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    delete (window as unknown as { openfrontDesktop?: unknown })
      .openfrontDesktop;
    stubLocation("openfront.io");
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: realLocation,
      writable: true,
      configurable: true,
    });
    delete (window as unknown as { openfrontDesktop?: unknown })
      .openfrontDesktop;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("joins directly when the match landed on this build", async () => {
    envMocks.gameVersion.mockReturnValue(OWN);
    const loc = stubLocation("openfront.io");

    const { joined } = await matchAndCheck();

    expect(joined).toHaveBeenCalledOnce();
    expect((joined.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      gameID: GAME_ID,
      source: "matchmaking",
    });
    expect(loc.href).toBe("https://openfront.io/");
  });

  it("goes to the game's version instead of joining on another build", async () => {
    envMocks.gameVersion.mockReturnValue(OLD);
    const loc = stubLocation("openfront.io");

    const { joined } = await matchAndCheck();

    expect(loc.href).toBe(`/v/${SHORT_OLD}/game/${GAME_ID}`);
    expect(joined).not.toHaveBeenCalled();
  });

  // Another beat would fire a second /exists, and a second navigation, at a
  // page already on its way out.
  it("stops polling once it has navigated", async () => {
    envMocks.gameVersion.mockReturnValue(OLD);

    await matchAndCheck();
    expect(fetchMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("joins when no version is known for the game", async () => {
    // Navigating on a guess is worse than joining and finding out.
    envMocks.gameVersion.mockReturnValue(undefined);
    const loc = stubLocation("openfront.io");

    const { joined } = await matchAndCheck();

    expect(joined).toHaveBeenCalledOnce();
    expect(loc.href).toBe("https://openfront.io/");
  });

  it("never navigates the desktop shell, which owns its own version", async () => {
    envMocks.gameVersion.mockReturnValue(OLD);
    const loc = stubLocation("openfront.io");
    (window as unknown as { openfrontDesktop?: unknown }).openfrontDesktop = {};

    const { joined } = await matchAndCheck();

    expect(joined).toHaveBeenCalledOnce();
    expect(loc.href).toBe("https://openfront.io/");
  });

  // replay.<domain> has no /v/<commit>/ routes, so that would 404.
  it("never navigates a replay shell", async () => {
    envMocks.gameVersion.mockReturnValue(OLD);
    const loc = stubLocation("replay.openfront.io");

    const { joined } = await matchAndCheck();

    expect(joined).toHaveBeenCalledOnce();
    expect(loc.href).toBe("https://replay.openfront.io/");
  });
});

// The shared queue is partitioned by build (OPE-470), so the join has to
// say which one this page is. A value that names no commit is left off: the
// API rejects a malformed version with a 400.
describe("MatchmakingModal queue join carries the page's build", () => {
  const OWN = "bfd5563a11111111111111111111111111111111";

  beforeEach(() => {
    vi.useFakeTimers();
    sockets.length = 0;
    apiMocks.getUserMe.mockReset();
    apiMocks.getUserMe.mockResolvedValue(userMe());
    envMocks.gitCommit.mockReturnValue(OWN);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    envMocks.gitCommit.mockReturnValue(OWN);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the commit this page was built from", async () => {
    const { socket } = await openAndJoin("1v1");

    expect(socket.url).toBe(
      `ws://matchmaking.test/matchmaking/join?instance_id=test-instance&mode=1v1&version=${OWN}`,
    );
  });

  it("omits the version for a build that names no commit", async () => {
    envMocks.gitCommit.mockReturnValue("DEV");

    const { socket } = await openAndJoin("2v2");

    expect(socket.url).toBe(
      "ws://matchmaking.test/matchmaking/join?instance_id=test-instance&mode=2v2",
    );
  });
});
