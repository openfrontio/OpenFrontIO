import { describe, expect, it } from "vitest";
import {
  SINGLEPLAYER_PRESENCE_TTL_MS,
  SingleplayerPresence,
} from "../../src/server/SingleplayerPresence";

// activeGamesByPlatform() feeds the openfront.singleplayer_games.gauge
// metric: a game counts while its last heartbeat is younger than the TTL,
// and a fresh beat for the same id refreshes rather than duplicates it.
describe("SingleplayerPresence", () => {
  function make() {
    let now = 1_000_000;
    const presence = new SingleplayerPresence(
      SINGLEPLAYER_PRESENCE_TTL_MS,
      () => now,
    );
    return { presence, advance: (ms: number) => (now += ms) };
  }

  it("counts games per platform, zeros included", () => {
    const { presence } = make();
    expect(presence.activeGames()).toBe(0);
    presence.heartbeat("gameAAAA", "web");
    presence.heartbeat("gameBBBB", "steam");
    presence.heartbeat("gameCCCC", "web");
    expect(Object.fromEntries(presence.activeGamesByPlatform())).toEqual({
      web: 2,
      steam: 1,
      crazygames: 0,
      unknown: 0,
    });
    expect(presence.activeGames()).toBe(3);
  });

  it("refreshes a repeated id instead of counting it twice", () => {
    const { presence, advance } = make();
    presence.heartbeat("gameAAAA", "web");
    advance(SINGLEPLAYER_PRESENCE_TTL_MS - 1);
    presence.heartbeat("gameAAAA", "web");
    advance(SINGLEPLAYER_PRESENCE_TTL_MS - 1);
    expect(presence.activeGames()).toBe(1);
  });

  it("prunes expired games on heartbeat, without a gauge read", () => {
    const { presence, advance } = make();
    presence.heartbeat("gameAAAA", "web");
    advance(SINGLEPLAYER_PRESENCE_TTL_MS + 1);
    presence.heartbeat("gameBBBB", "web");
    expect((presence as any).lastSeen.size).toBe(1);
  });

  it("drops a game once its last beat is older than the TTL", () => {
    const { presence, advance } = make();
    presence.heartbeat("gameAAAA", "web");
    advance(SINGLEPLAYER_PRESENCE_TTL_MS - 1);
    expect(presence.activeGames()).toBe(1);
    advance(2);
    expect(presence.activeGames()).toBe(0);
  });
});
