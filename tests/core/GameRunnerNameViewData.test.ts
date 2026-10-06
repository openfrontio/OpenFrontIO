/**
 * Hosts hold on to updates: the worker posts several ticks in one message,
 * and run_turns a hundred. A tick's name placements must still read as
 * they were at that tick once later ticks have run.
 */

import { GameMapType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateViewData } from "@openfront/engine-api/game/GameUpdates";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { toWireGameStartInfo } from "@openfront/shared/SharedUtil";
import {
  config,
  human,
  mapLoader,
  spawnOnLand,
} from "../client/replay/util/ArchiveGame";

test("an update's name placements don't change as later ticks run", async () => {
  const start = toWireGameStartInfo({
    gameID: "nameView1",
    lobbyCreatedAt: 1_700_000_000_000,
    config: config({ gameMap: GameMapType.Onion, bots: 5 }),
    players: [human(1)],
  });
  const held: {
    data: NonNullable<GameUpdateViewData["playerNameViewData"]>;
    atTick: string;
  }[] = [];
  const runner = await createGameRunner(start, undefined, mapLoader, (gu) => {
    if ("updates" in gu && gu.playerNameViewData !== undefined) {
      held.push({
        data: gu.playerNameViewData,
        atTick: JSON.stringify(gu.playerNameViewData),
      });
    }
  });
  // Past the spawn phase, so territory grows and names move.
  for (let t = 0; t < 300; t++) {
    runner.addTurn({
      turnNumber: t,
      intents: t === 3 ? [spawnOnLand(runner.game, "client001", 1000)] : [],
    });
    expect(runner.executeNextTick()).toBe(true);
  }
  expect(new Set(held.map((h) => h.atTick)).size).toBeGreaterThan(2);
  for (const h of held) expect(JSON.stringify(h.data)).toBe(h.atTick);
}, 60_000);
