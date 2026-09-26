/**
 * The HUD adapter, checked by rendering the game's own leaderboard against
 * a real recorded game. The point is that the component is untouched: if
 * it reaches for something the adapter doesn't have, this fails - which is
 * how a change to the HUD is meant to be caught.
 */

import "../../../src/client/hud/layers/EventsDisplay";
import type { EventsDisplay } from "../../../src/client/hud/layers/EventsDisplay";
import "../../../src/client/hud/layers/PlayerInfoOverlay";
import type { PlayerInfoOverlay } from "../../../src/client/hud/layers/PlayerInfoOverlay";
import "../../../src/client/hud/layers/PlayerStats";
import type { PlayerStats } from "../../../src/client/hud/layers/PlayerStats";
import type { ReplayReader } from "../../../src/client/replay/codec/decode/ReplayReader";
import { ReplayGameView } from "../../../src/client/replay/ReplayGameAdapter";
import { Config } from "../../../src/core/configuration/Config";
import { EventBus } from "../../../src/core/EventBus";
import { Cell, GameType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { UserSettings } from "../../../src/core/game/UserSettings";
import { setup } from "../../util/Setup";
import { config as gameConfig } from "./util/ArchiveGame";
import { openReader, recordGame, type RecordedGame } from "./util/RecordGame";

const EMPTY = new Uint8Array(0);

describe("ReplayGameAdapter", () => {
  let rec: RecordedGame;
  let reader: ReplayReader;
  let adapter: ReplayGameView;

  beforeAll(async () => {
    const game = await setup(
      "big_plains",
      { bots: 8, gameType: GameType.Singleplayer },
      [],
      undefined,
      undefined,
      false,
    );
    rec = await recordGame(game, {
      ticks: 120,
      keyframeInterval: 25,
      beforeTick: (g, t) => {
        if (t === 5) g.endSpawnPhase();
      },
    });
    reader = openReader(rec.replay);
    // The recorder stores a stub start info, so the config comes from the
    // same fixture the processor tests use.
    adapter = new ReplayGameView(
      reader.header.players,
      new Config(gameConfig(), new UserSettings(), true, false, true),
      reader.header.mapWidth,
      reader.header.mapHeight,
      reader.header.numLandTiles,
      new Uint8Array(reader.header.mapWidth * reader.header.mapHeight),
    );
  }, 60_000);

  test("reports what the frame says, player by player", () => {
    const frame = reader.seek(119);
    adapter.update(frame, new Uint8Array(0), 0, false);
    for (const view of adapter.playerViews()) {
      const state = frame.players.get(view.smallID());
      if (state === undefined) continue;
      expect(view.isAlive()).toBe(state.isAlive);
      expect(view.numTilesOwned()).toBe(state.tilesOwned);
      expect(view.troops()).toBe(state.troops);
      expect(Number(view.gold())).toBe(Math.round(state.gold));
      expect(view.goldEarned()).toBe(state.goldEarned);
      expect(view.betrayals()).toBe(state.betrayals);
      expect(
        view
          .allies()
          .map((a) => a.smallID())
          .sort(),
      ).toEqual([...state.allies].sort());
    }
    // A spectator's view: the replay belongs to nobody.
    expect(adapter.myPlayer()).toBeNull();
    expect(adapter.ticks()).toBe(frame.tick);
  });

  test("unit levels are totalled from the frame", () => {
    const frame = reader.seek(119);
    adapter.update(frame, new Uint8Array(0), 0, false);
    const expected = new Map<number, number>();
    for (const unit of frame.units.values()) {
      if (!unit.isActive) continue;
      expected.set(
        unit.ownerID,
        (expected.get(unit.ownerID) ?? 0) + unit.level,
      );
    }
    for (const [smallID, levels] of expected) {
      expect(adapter.playerBySmallID(smallID)?.totalUnitLevels()).toBe(levels);
    }
  });

  test("tile ownership and land come from the frame and the terrain", () => {
    const frame = reader.seek(60);
    const terrain = new Uint8Array(
      reader.header.mapWidth * reader.header.mapHeight,
    );
    terrain[5] = 1 << 7; // land
    adapter.update(frame, terrain, 0, false);
    expect(adapter.isLand(5)).toBe(true);
    expect(adapter.isLand(6)).toBe(false);

    const owned = [...frame.players.keys()].find((id) =>
      [...frame.tileState].some((t) => (t & 0xfff) === id),
    );
    if (owned !== undefined) {
      const ref = [...frame.tileState].findIndex((t) => (t & 0xfff) === owned);
      expect(adapter.owner(ref).isPlayer()).toBe(true);
      expect((adapter.owner(ref) as { smallID(): number }).smallID()).toBe(
        owned,
      );
    }
    const empty = [...frame.tileState].findIndex((t) => (t & 0xfff) === 0);
    expect(adapter.owner(empty).isPlayer()).toBe(false);
  });

  test("land and fallout follow the game, like GameMap's counts", () => {
    const frame = reader.seek(60);
    adapter.update(
      { ...frame, falloutTiles: 12 },
      EMPTY,
      -30, // water nukes sank 30 land tiles
      false,
    );
    expect(adapter.numLandTiles()).toBe(reader.header.numLandTiles - 30);
    expect(adapter.numTilesWithFallout()).toBe(12);
  });

  test("a player's name location is where the frame placed it", () => {
    const frame = reader.seek(119);
    const [playerID, placed] = [...frame.names].find(([, n]) => n.size > 0)!;
    adapter.update(frame, EMPTY, 0, false);
    expect(adapter.player(playerID)!.nameLocation()).toEqual(placed);
  });

  test("the game's own leaderboard renders from it", async () => {
    adapter.update(reader.seek(119), new Uint8Array(0), 0, false);
    const table = document.createElement("player-stats") as PlayerStats;
    table.game = adapter.asGameView();
    table.visible = true;
    document.body.appendChild(table);
    try {
      await table.updateComplete;
      table.refresh();
      await table.updateComplete;

      const text = table.textContent ?? "";
      const alive = adapter
        .playerViews()
        .filter((p) => p.isAlive())
        .map((p) => p.name());
      expect(alive.length).toBeGreaterThan(1);
      // Every living player is on the board, by name.
      for (const name of alive) expect(text).toContain(name);
      expect(table.querySelectorAll(".stats-table-row").length).toBeGreaterThan(
        0,
      );
    } finally {
      table.remove();
    }
  }, 30_000);

  test("the game's own hover card renders from it", async () => {
    const frame = reader.seek(119);
    adapter.update(frame, new Uint8Array(0), 0, false);
    // A tile somebody owns, and the player who owns it.
    const ref = [...frame.tileState].findIndex((t) => (t & 0xfff) !== 0);
    expect(ref).toBeGreaterThanOrEqual(0);
    const owner = adapter.playerBySmallID(frame.tileState[ref] & 0xfff)!;

    const overlay = document.createElement(
      "player-info-overlay",
    ) as PlayerInfoOverlay;
    overlay.game = adapter.asGameView();
    overlay.eventBus = new EventBus();
    overlay.transform = {
      screenToWorldCoordinates: () => new Cell(adapter.x(ref), adapter.y(ref)),
    } as never;
    document.body.appendChild(overlay);
    try {
      overlay.init();
      overlay.maybeShow(10, 10);
      await overlay.updateComplete;
      // Give profile() (a promise, as in the live client) a turn.
      await Promise.resolve();
      overlay.tick();
      await overlay.updateComplete;
      expect(overlay.textContent ?? "").toContain(owner.displayName());
    } finally {
      overlay.remove();
    }
  }, 30_000);

  test("players follow the latest frame, read when the HUD asks", () => {
    const early = reader.seek(0);
    const late = reader.seek(119);
    adapter.update(early, EMPTY, 0, true);
    expect(adapter.inSpawnPhase()).toBe(true);
    // Frames in between are never read; the HUD sees the last one.
    adapter.update(reader.seek(60), EMPTY, 0, false);
    adapter.update(late, EMPTY, 0, false);
    expect(adapter.inSpawnPhase()).toBe(false);
    for (const view of adapter.playerViews()) {
      const state = late.players.get(view.smallID());
      expect(view.troops()).toBe(state?.troops ?? 0);
    }
  });

  test("the HUD's flags and crowns follow a restyle", () => {
    const view = adapter.playerViews()[0];
    const before = view.info;
    try {
      adapter.restyle([{ ...before, flag: "/f.svg", crown: "/c.svg" }]);
      expect(view.cosmetics).toEqual({
        flag: "/f.svg",
        crown: { url: "/c.svg" },
      });
      adapter.restyle([{ ...before, flag: undefined, crown: undefined }]);
      expect(view.cosmetics).toEqual({});
    } finally {
      adapter.restyle([before]);
    }
  });

  test("events are kept until the HUD asks, and dropped on a seek", () => {
    // The HUD ticks about once a second; frames arrive ten times faster.
    const withEvents = (tick: number, misc: Record<string, unknown[]>) =>
      ({ ...reader.seek(tick), miscUpdates: misc }) as never;
    adapter.update(
      withEvents(10, { DonateEvent: [{ a: 1 }] }),
      EMPTY,
      0,
      false,
    );
    adapter.update(
      withEvents(11, { DonateEvent: [{ a: 2 }] }),
      EMPTY,
      0,
      false,
    );
    const drained = adapter.updatesSinceLastTick();
    expect(drained[GameUpdateType.DonateEvent]).toEqual([{ a: 1 }, { a: 2 }]);
    // Drained: the same events are not shown twice.
    expect(adapter.updatesSinceLastTick()[GameUpdateType.DonateEvent]).toEqual(
      [],
    );

    adapter.update(
      withEvents(12, { DonateEvent: [{ a: 3 }] }),
      EMPTY,
      0,
      false,
    );
    adapter.update(
      withEvents(99, { Emoji: [{ e: 1 }] }),
      EMPTY,
      0,
      false,
      true,
    );
    const afterSeek = adapter.updatesSinceLastTick();
    expect(afterSeek[GameUpdateType.DonateEvent]).toEqual([]);
    expect(afterSeek[GameUpdateType.Emoji]).toEqual([{ e: 1 }]);
  });

  test("the game's own event feed renders for the followed player", async () => {
    const frame = reader.seek(119);
    const alive = adapter.playerViews().find((p) => {
      adapter.update(frame, EMPTY, 0, false);
      return p.isAlive();
    })!;
    adapter.focus = alive;

    const feed = document.createElement("events-display") as EventsDisplay;
    feed.game = adapter.asGameView();
    feed.eventBus = new EventBus();
    document.body.appendChild(feed);
    try {
      feed.init();
      // A message the game would send this player.
      adapter.update(
        {
          ...frame,
          miscUpdates: {
            DisplayEvent: [
              {
                messageType: 0,
                message: "replay feed works",
                playerID: alive.smallID(),
                gold: undefined,
                params: {},
              },
            ],
          },
        } as never,
        EMPTY,
        0,
        false,
      );
      feed.tick();
      await feed.updateComplete;
      expect(feed.textContent ?? "").toContain("replay feed works");
    } finally {
      feed.remove();
    }
  }, 30_000);
});
