import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const copyToClipboardMock = vi.hoisted(() =>
  vi.fn(async (_text: string) => {}),
);
const showToastMock = vi.hoisted(() => vi.fn());

const gamePortalMock = vi.hoisted(() => ({
  isOnGamePortal: vi.fn(() => false),
  createInviteLink: vi.fn(
    async (gameId: string): Promise<string | null> =>
      `https://crazygames.com/game?invite=${gameId}`,
  ),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  copyToClipboard: copyToClipboardMock,
  showToast: showToastMock,
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "common.copied": "Copied!",
      "common.failed_copy": "Failed to copy",
    };
    return translations[key] || key;
  }),
}));

vi.mock("../../src/client/GamePortal", () => ({
  gamePortal: gamePortalMock,
}));

import { ClientEnv, deriveShareOrigin } from "../../src/client/ClientEnv";
import { shareGame } from "../../src/client/utilities/ShareGame";

describe("shareGame", () => {
  function setBootstrapConfig(
    overrides: { jwtAudience?: string; serverHost?: string } = {},
  ) {
    (window as any).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "x",
      jwtAudience: "openfront.io",
      instanceId: "d",
      gitCommit: "t",
      ...overrides,
    };
    ClientEnv.reset();
  }

  beforeEach(() => {
    vi.spyOn(ClientEnv, "shareOrigin").mockReturnValue("https://openfront.io");
    setBootstrapConfig({ serverHost: "openfront.io" });
    copyToClipboardMock.mockClear();
    showToastMock.mockClear();
    gamePortalMock.isOnGamePortal.mockReturnValue(false);
    gamePortalMock.createInviteLink.mockClear();
  });

  afterEach(() => {
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
    vi.restoreAllMocks();
  });

  it("shows failure toast when game ID is undefined", async () => {
    await shareGame(undefined);

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when game ID is empty string", async () => {
    await shareGame("");

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("copies game link and shows success toast on the open web", async () => {
    const gameId = "game123456";
    await shareGame(gameId);

    const expectedUrl = `${ClientEnv.shareOrigin()}${ClientEnv.gamePath(gameId)}`;
    expect(copyToClipboardMock).toHaveBeenCalledWith(expectedUrl);
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("uses desktop share origin when running in desktop shell", async () => {
    vi.spyOn(ClientEnv, "shareOrigin").mockImplementation(() =>
      deriveShareOrigin(
        () => ({
          siteOrigin: ClientEnv.siteOrigin(),
          jwtAudience: "openfront.io",
        }),
        "app:",
        "app://openfront",
      ),
    );

    const gameId = "desk123456";
    await shareGame(gameId);

    expect(copyToClipboardMock).toHaveBeenCalledWith(
      `https://openfront.io${ClientEnv.gamePath(gameId)}`,
    );
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("uses gamePortal.createInviteLink on game portals", async () => {
    const gameId = "cg123456";
    gamePortalMock.isOnGamePortal.mockReturnValue(true);
    gamePortalMock.createInviteLink.mockResolvedValue(
      `https://crazygames.com/game?invite=${gameId}`,
    );

    await shareGame(gameId);

    expect(gamePortalMock.createInviteLink).toHaveBeenCalledWith(gameId);
    expect(copyToClipboardMock).toHaveBeenCalledWith(
      `https://crazygames.com/game?invite=${gameId}`,
    );
    expect(showToastMock).toHaveBeenCalledWith("Copied!", "green");
  });

  it("shows failure toast when portal invite link creation returns null", async () => {
    const gameId = "cgfail";
    gamePortalMock.isOnGamePortal.mockReturnValue(true);
    gamePortalMock.createInviteLink.mockResolvedValue(null);

    await shareGame(gameId);

    expect(copyToClipboardMock).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });

  it("shows failure toast when copyToClipboard rejects", async () => {
    copyToClipboardMock.mockRejectedValueOnce(new Error("clipboard denied"));

    await shareGame("game123456");

    expect(showToastMock).toHaveBeenCalledWith("Failed to copy", "red");
  });
});
