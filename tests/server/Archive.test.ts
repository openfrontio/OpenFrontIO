import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/core/configuration/ConfigLoader", () => ({
  getServerConfigFromServer: () => ({
    jwtIssuer: () => "https://archive.test.invalid",
    apiKey: () => "test-key",
    gitCommit: () => "DEV",
    subdomain: () => "test",
    domain: () => "test",
  }),
}));

vi.mock("../../src/server/Logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

vi.mock("../../src/core/Schemas", async () => {
  const actual = (await vi.importActual("../../src/core/Schemas")) as any;
  return {
    ...actual,
    GameRecordSchema: {
      safeParse: (data: any) => ({ success: true, data }),
    },
  };
});

import { GameType } from "../../src/core/game/Game";
import type { GameRecord } from "../../src/core/Schemas";
import { archive } from "../../src/server/Archive";

function buildRecord(gameType: GameType, flag: string | undefined): GameRecord {
  return {
    info: {
      gameID: "TEST123456",
      config: { gameType } as any,
      players: [
        {
          clientID: "client-1",
          username: "Test",
          clanTag: null,
          persistentID: "persist-1",
          stats: {} as any,
          cosmetics: flag ? { flag } : undefined,
        } as any,
      ],
    } as any,
    version: "v0.0.2",
    gitCommit: "DEV",
    subdomain: "test",
    domain: "test",
    turns: [],
  } as GameRecord;
}

function archivedBody(fetchMock: ReturnType<typeof vi.fn>): any {
  expect(fetchMock).toHaveBeenCalledOnce();
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe("archive() singleplayer flag sanitization", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves same-origin country flag paths", async () => {
    await archive(
      buildRecord(GameType.Singleplayer, "/flags/us.svg"),
      new Set(),
    );
    expect(archivedBody(fetchMock).info.players[0].cosmetics.flag).toBe(
      "/flags/us.svg",
    );
  });

  it("preserves manifest-resolved asset paths", async () => {
    await archive(
      buildRecord(GameType.Singleplayer, "/_assets/flags/us-abc123.svg"),
      new Set(),
    );
    expect(archivedBody(fetchMock).info.players[0].cosmetics.flag).toBe(
      "/_assets/flags/us-abc123.svg",
    );
  });

  it("preserves cosmetic flag URLs that are in the trusted set", async () => {
    const trustedUrl = "https://example.com/cool.png";
    await archive(
      buildRecord(GameType.Singleplayer, trustedUrl),
      new Set([trustedUrl]),
    );
    expect(archivedBody(fetchMock).info.players[0].cosmetics.flag).toBe(
      trustedUrl,
    );
  });

  it("drops attacker-controlled URLs not in the trusted set", async () => {
    await archive(
      buildRecord(
        GameType.Singleplayer,
        "https://attacker.example/payload.png",
      ),
      new Set(["https://example.com/cool.png"]),
    );
    expect(
      archivedBody(fetchMock).info.players[0].cosmetics?.flag,
    ).toBeUndefined();
  });

  it("drops http URLs regardless of case", async () => {
    await archive(
      buildRecord(GameType.Singleplayer, "HTTP://attacker.example/x.png"),
      new Set(),
    );
    expect(
      archivedBody(fetchMock).info.players[0].cosmetics?.flag,
    ).toBeUndefined();
  });

  it("preserves untouched player when no flag is set", async () => {
    await archive(buildRecord(GameType.Singleplayer, undefined), new Set());
    expect(archivedBody(fetchMock).info.players[0].cosmetics).toBeUndefined();
  });

  it("drops absolute URLs even when the trusted set is omitted", async () => {
    await archive(
      buildRecord(GameType.Singleplayer, "https://example.com/cool.png"),
    );
    expect(
      archivedBody(fetchMock).info.players[0].cosmetics?.flag,
    ).toBeUndefined();
  });
});

describe("archive() multiplayer paths skip sanitization", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, statusText: "OK" });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not modify cosmetics for public games", async () => {
    const attackerUrl = "https://attacker.example/payload.png";
    await archive(buildRecord(GameType.Public, attackerUrl));
    expect(archivedBody(fetchMock).info.players[0].cosmetics.flag).toBe(
      attackerUrl,
    );
  });

  it("does not modify cosmetics for private games", async () => {
    const attackerUrl = "https://attacker.example/payload.png";
    await archive(buildRecord(GameType.Private, attackerUrl));
    expect(archivedBody(fetchMock).info.players[0].cosmetics.flag).toBe(
      attackerUrl,
    );
  });
});
