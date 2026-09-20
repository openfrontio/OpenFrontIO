import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntentActor } from "../../src/server/IntentAuthorization";
import { makeClient, makeGame } from "../util/GameServerHarness";

describe("Rule change grace period", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a 30-second grace period when a private lobby changes rules", () => {
    const game = makeGame();
    // Two players
    const host = makeClient(1, "host-id");
    const joiner = makeClient(2, "joiner-id");
    game.joinClient(host);
    game.joinClient(joiner);

    const actor: IntentActor = {
      clientID: host.clientID,
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    };

    // Change a rule
    game.handleIntent(
      { type: "update_game_config", config: { infiniteGold: true } },
      actor,
    );

    // startsAt remains undefined if it wasn't running
    expect((game as any).startsAt).toBeUndefined();
    expect((game as any).gracePeriodUntil).toBeGreaterThanOrEqual(
      Date.now() + 30000,
    );
  });

  it("does not apply grace period if it is only cosmetic", () => {
    const game = makeGame();
    const host = makeClient(1, "host-id");
    const joiner = makeClient(2, "joiner-id");
    game.joinClient(host);
    game.joinClient(joiner);

    // Set a known start time
    const start = Date.now() + 5000;
    (game as any).setStartsAt(start);

    const actor: IntentActor = {
      clientID: host.clientID,
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    };

    // Change cosmetic setting
    game.handleIntent(
      { type: "update_game_config", config: { anonymizeNames: true } },
      actor,
    );

    // startsAt remains unchanged
    expect((game as any).startsAt).toBe(start);
  });

  it("extends an existing short timer if a rule is changed", () => {
    const game = makeGame();
    const host = makeClient(1, "host-id");
    const joiner = makeClient(2, "joiner-id");
    game.joinClient(host);
    game.joinClient(joiner);

    // Start countdown is running, 5 seconds left
    const start = Date.now() + 5000;
    (game as any).setStartsAt(start);

    const actor: IntentActor = {
      clientID: host.clientID,
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    };

    game.handleIntent(
      { type: "update_game_config", config: { donateGold: false } },
      actor,
    );

    // extended to at least 30 seconds
    expect((game as any).startsAt).toBeGreaterThanOrEqual(Date.now() + 30000);
  });

  it("respects the grace period when host presses start manually", () => {
    const game = makeGame();
    const host = makeClient(1, "host-id");
    const joiner = makeClient(2, "joiner-id");
    game.joinClient(host);
    game.joinClient(joiner);

    const actor: IntentActor = {
      clientID: host.clientID,
      isLobbyCreator: true,
      isAdmin: false,
      isAdminBot: false,
    };

    game.handleIntent(
      { type: "update_game_config", config: { instantBuild: true } },
      actor,
    );

    // Then host presses start
    game.handleIntent({ type: "toggle_game_start_timer" }, actor);

    // The delay must still be at least 30s because of the grace period
    expect((game as any).startsAt).toBeGreaterThanOrEqual(Date.now() + 30000);
  });
});
it("does not apply grace period to single player lobbies", () => {
  const game = makeGame();
  const host = makeClient(1, "host-id");
  game.joinClient(host);
  // joiner is missing, only host is present

  const actor: IntentActor = {
    clientID: host.clientID,
    isLobbyCreator: true,
    isAdmin: false,
    isAdminBot: false,
  };

  game.handleIntent(
    { type: "update_game_config", config: { instantBuild: true } },
    actor,
  );

  game.handleIntent({ type: "toggle_game_start_timer" }, actor);

  // No grace period, should start immediately or with normal delay
  // 5 seconds start delay is normal? default test config is 0 maybe?
  // it shouldn't be >= 30 seconds away.
  expect((game as any).startsAt).toBeLessThan(Date.now() + 29000);
});
