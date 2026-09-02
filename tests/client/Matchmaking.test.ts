import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import { CloseCode, CloseReason } from "../../src/core/CloseCodes";

const apiMocks = vi.hoisted(() => ({
  getUserMe: vi.fn(),
  invalidateUserMe: vi.fn(),
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
  },
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
