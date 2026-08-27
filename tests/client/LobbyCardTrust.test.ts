import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { UserMeResponse } from "../../src/core/ApiSchemas";
import { GameMapType, GameMode } from "../../src/core/game/Game";
import type { GameConfig, PublicGameInfo } from "../../src/core/Schemas";

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: {
    getMapData: vi.fn((map: GameMapType) => ({
      webpPath: `/maps/${map}.webp`,
    })),
  },
}));

vi.mock("../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  getMapName: vi.fn((m: string | undefined) => m ?? null),
  getModifierLabels: vi.fn(() => []),
}));

import {
  lobbyCard,
  trustRequiredDialog,
  viewerIsTrusted,
} from "../../src/client/components/LobbyCard";

function lobby(trusted?: boolean): PublicGameInfo {
  return {
    gameID: "game0001",
    numClients: 3,
    publicGameType: "ffa",
    gameConfig: {
      gameMap: GameMapType.World,
      gameMode: GameMode.FFA,
      maxPlayers: 8,
      ...(trusted === undefined ? {} : { trusted }),
    } as unknown as GameConfig,
  };
}

function renderCard(l: PublicGameInfo, viewerTrusted: boolean): HTMLElement {
  const host = document.createElement("div");
  render(
    lobbyCard({
      lobby: l,
      subtitle: "FFA",
      timeDisplay: "0:30",
      viewerTrusted,
      onClick: () => {},
    }),
    host,
  );
  return host;
}

function trustIcon(host: HTMLElement): HTMLElement | null {
  return host.querySelector("[data-trust]");
}

describe("lobbyCard trust lock", () => {
  it("shows no lock on a lobby that is not trusted-only", () => {
    expect(trustIcon(renderCard(lobby(), false))).toBeNull();
    expect(trustIcon(renderCard(lobby(), true))).toBeNull();
    expect(trustIcon(renderCard(lobby(false), false))).toBeNull();
  });

  it("shows a closed lock when the viewer can't join a trusted-only lobby", () => {
    const icon = trustIcon(renderCard(lobby(true), false));
    expect(icon?.dataset.trust).toBe("locked");
    expect(icon?.classList.contains("text-red-400")).toBe(true);
    expect(icon?.getAttribute("title")).toBe("public_lobby.trusted_locked");
  });

  it("shows an open lock when the viewer is trusted", () => {
    const icon = trustIcon(renderCard(lobby(true), true));
    expect(icon?.dataset.trust).toBe("unlocked");
    expect(icon?.classList.contains("text-green-400")).toBe(true);
    expect(icon?.getAttribute("title")).toBe("public_lobby.trusted_unlocked");
  });
});

describe("viewerIsTrusted", () => {
  const me = (trustTier: unknown) =>
    ({ player: { trustTier } }) as unknown as UserMeResponse;

  it("is true only for an explicit trusted tier", () => {
    expect(viewerIsTrusted(me("trusted"))).toBe(true);
    expect(viewerIsTrusted(me("untrusted"))).toBe(false);
    // null: the API's computation failed. undefined: an older API.
    expect(viewerIsTrusted(me(null))).toBe(false);
    expect(viewerIsTrusted(me(undefined))).toBe(false);
    expect(viewerIsTrusted(false)).toBe(false);
  });
});

describe("trustRequiredDialog", () => {
  function message(signedIn: boolean): unknown {
    const host = document.createElement("div");
    render(
      trustRequiredDialog(signedIn, () => {}),
      host,
    );
    return (
      host.querySelector("confirm-dialog") as unknown as { message: string }
    ).message;
  }

  it("tells a signed-in but untrusted viewer to play more games", () => {
    expect(message(true)).toBe("public_lobby.trust_required_body");
  });

  it("tells a signed-out viewer to sign in first", () => {
    expect(message(false)).toBe("public_lobby.trust_required_body_signed_out");
  });
});
