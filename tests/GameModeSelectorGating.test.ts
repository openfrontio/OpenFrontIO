import { describe, expect, it } from "vitest";
import {
  joinIsGateable,
  multiplayerAllowedForBackend,
  shouldBlockJoin,
  shouldBlockMultiplayerAction,
} from "../src/client/GameModeSelector";
import { GameType } from "../src/core/game/Game";

describe("shouldBlockMultiplayerAction", () => {
  it("allows everything when no desktop update state has arrived", () => {
    expect(shouldBlockMultiplayerAction(null, null, null)).toBe(false);
  });

  it("allows multiplayer when the client is current", () => {
    expect(
      shouldBlockMultiplayerAction(
        { status: "current", bytes: 0, total: 0 },
        null,
        null,
      ),
    ).toBe(false);
  });

  it("blocks while downloading and while staged", () => {
    expect(
      shouldBlockMultiplayerAction(
        {
          status: "downloading",
          bytes: 1,
          total: 2,
        },
        null,
        null,
      ),
    ).toBe(true);
    expect(
      shouldBlockMultiplayerAction(
        { status: "staged", bytes: 2, total: 2 },
        null,
        null,
      ),
    ).toBe(true);
  });

  it("does not block when the shell is too old to update", () => {
    expect(
      shouldBlockMultiplayerAction(
        { status: "blocked", bytes: 0, total: 0 },
        null,
        null,
      ),
    ).toBe(false);
  });

  // All four kinds asserted explicitly at the call site's own predicate, so a
  // future edit collapsing the gating/non-gating split fails here too.
  const failed = (kind: string) => ({
    status: "failed" as const,
    bytes: 0,
    total: 0,
    error: { kind, message: kind },
  });

  it("blocks a failed check when Retry is a real remedy", () => {
    expect(shouldBlockMultiplayerAction(failed("network"), null, null)).toBe(
      true,
    );
    expect(shouldBlockMultiplayerAction(failed("verify"), null, null)).toBe(
      true,
    );
  });

  it("does not block failures no player-side action can change", () => {
    expect(shouldBlockMultiplayerAction(failed("refused"), null, null)).toBe(
      false,
    );
    expect(shouldBlockMultiplayerAction(failed("parse"), null, null)).toBe(
      false,
    );
  });
});

describe("shouldBlockMultiplayerAction with a session", () => {
  const healthyUpdate = { status: "current", bytes: 0, total: 0 } as const;

  it("does not block when both are healthy", () => {
    expect(
      shouldBlockMultiplayerAction(
        healthyUpdate,
        { status: "signed-in" },
        null,
      ),
    ).toBe(false);
  });

  it("blocks on a signed-out session even when the update is current", () => {
    expect(
      shouldBlockMultiplayerAction(
        healthyUpdate,
        {
          status: "signed-out",
          reason: "steam-wedged",
        },
        null,
      ),
    ).toBe(true);
  });

  it("blocks on a pending update even when signed in", () => {
    expect(
      shouldBlockMultiplayerAction(
        { status: "staged", bytes: 0, total: 0 },
        {
          status: "signed-in",
        },
        null,
      ),
    ).toBe(true);
  });

  it("does not block on the web, where neither state exists", () => {
    expect(shouldBlockMultiplayerAction(null, null, null)).toBe(false);
  });
});

describe("multiplayerAllowedForBackend", () => {
  it("allows multiplayer before the first attempt has settled", () => {
    // OPE-439's central rule: unknown is not unreachable. Every page is in
    // this state for its first few hundred milliseconds, and gating there
    // would lock every player out of multiplayer on every load.
    expect(multiplayerAllowedForBackend(null)).toBe(true);
  });

  it("allows multiplayer when the API answered", () => {
    // "Answered" and not "served a usable list": a site with no list at all
    // still proves the backend is up.
    expect(multiplayerAllowedForBackend(true)).toBe(true);
  });

  it("blocks multiplayer once an attempt has failed outright", () => {
    expect(multiplayerAllowedForBackend(false)).toBe(false);
  });
});

describe("shouldBlockMultiplayerAction with backend reachability", () => {
  it("blocks on the web, where both desktop states are absent", () => {
    expect(shouldBlockMultiplayerAction(null, null, false)).toBe(true);
  });

  it("does not block on an unknown or reachable backend", () => {
    expect(shouldBlockMultiplayerAction(null, null, null)).toBe(false);
    expect(shouldBlockMultiplayerAction(null, null, true)).toBe(false);
  });

  it("still blocks on a desktop reason while the backend is fine", () => {
    expect(
      shouldBlockMultiplayerAction(
        { status: "staged", bytes: 0, total: 0 },
        { status: "signed-in" },
        true,
      ),
    ).toBe(true);
  });
});

describe("joinIsGateable", () => {
  // Matchmaking, deep links and the host/join modals all dispatch join-lobby
  // without passing a dimmed button, so the funnel gate is the only thing
  // standing between a signed-out player and the server's Turnstile close.
  it("gates an ordinary multiplayer join", () => {
    expect(joinIsGateable({ gameID: "g1", source: "public" } as any)).toBe(
      true,
    );
  });

  it("gates a matchmaking join", () => {
    expect(joinIsGateable({ gameID: "g2", source: "matchmaking" } as any)).toBe(
      true,
    );
  });

  // Runs entirely in-client -- no session, no server, nothing to gate.
  it("does not gate single-player", () => {
    expect(
      joinIsGateable({
        gameID: "g3",
        source: "private",
        gameStartInfo: { config: { gameType: GameType.Singleplayer } },
      } as any),
    ).toBe(false);
  });

  // Simulates from the archived record; there is no server to refuse it.
  it("does not gate a replay", () => {
    expect(
      joinIsGateable({
        gameID: "g4",
        source: "private",
        gameRecord: {},
      } as any),
    ).toBe(false);
  });
});

describe("shouldBlockJoin", () => {
  const mp = { gameID: "g", source: "matchmaking" } as any;
  const solo = {
    gameID: "g",
    source: "private",
    gameStartInfo: { config: { gameType: GameType.Singleplayer } },
  } as any;
  const healthy = { status: "current", bytes: 0, total: 0 } as const;

  it("allows a multiplayer join when both states are healthy", () => {
    expect(shouldBlockJoin(mp, healthy, { status: "signed-in" }, true)).toBe(
      false,
    );
  });

  it("blocks a multiplayer join when signed out", () => {
    expect(
      shouldBlockJoin(
        mp,
        healthy,
        {
          status: "signed-out",
          reason: "steam-wedged",
        },
        true,
      ),
    ).toBe(true);
  });

  // The claim that update-gating inherits the funnel fix, actually pinned.
  it("blocks a multiplayer join on a pending update even when signed in", () => {
    expect(
      shouldBlockJoin(
        mp,
        { status: "staged", bytes: 0, total: 0 },
        { status: "signed-in" },
        true,
      ),
    ).toBe(true);
  });

  it("never blocks single-player, whatever the states say", () => {
    expect(
      shouldBlockJoin(
        solo,
        { status: "staged", bytes: 0, total: 0 },
        { status: "signed-out", reason: "steam-wedged" },
        false,
      ),
    ).toBe(false);
  });

  it("does not block on the web, where neither desktop state exists", () => {
    expect(shouldBlockJoin(mp, null, null, true)).toBe(false);
    // Nor before the heartbeat's first attempt has settled.
    expect(shouldBlockJoin(mp, null, null, null)).toBe(false);
  });

  // OPE-439. The one input that gates on the web as well as on desktop.
  it("blocks a multiplayer join while the backend is unreachable", () => {
    expect(shouldBlockJoin(mp, null, null, false)).toBe(true);
    expect(shouldBlockJoin(mp, healthy, { status: "signed-in" }, false)).toBe(
      true,
    );
  });

  it("never blocks single-player on an unreachable backend", () => {
    // The desktop build's core offline promise: bot games run entirely
    // in-client, so an unreachable backend is no reason to refuse one.
    expect(shouldBlockJoin(solo, null, null, false)).toBe(false);
  });
});
