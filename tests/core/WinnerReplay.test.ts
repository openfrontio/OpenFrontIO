import { GameMapSize, RankedType } from "@openfront/engine-api/game/GameTypes";
import {
  GameUpdateType,
  WinUpdate,
} from "@openfront/engine-api/game/GameUpdates";
import { GameStartInfo, Turn } from "@openfront/engine-api/Schemas";
import { createGameRunner } from "@openfront/engine/GameRunner";
import { replayWinner } from "@openfront/engine/WinnerReplay";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { describe, expect, it } from "vitest";
import { scriptedGameStart, TestDataMapLoader } from "../util/ScriptedGame";

const [P1, P2] = ["HUMAN001", "HUMAN002"];

// A ranked 1v1 on plains: both players spawn, then `quitter` drops after the
// spawn phase, which hands the other the win on the next win check.
function gameStart(): GameStartInfo {
  const start = scriptedGameStart({
    gameMapSize: GameMapSize.Normal,
    rankedType: RankedType.OneVOne,
    nations: "disabled",
    bots: 0,
    doomsdayClock: { enabled: false, speed: "veryfast" },
  });
  return { ...start, players: start.players.slice(0, 2) };
}

// The plains files, as the host would read and pass them in.
const mapFiles = () =>
  loadMapFiles(
    new TestDataMapLoader("plains"),
    gameStart().config.gameMap,
    GameMapSize.Normal,
  );

// Plays the game live, the way a client would, and returns its turn log and
// the Win update the live game produced.
async function playLive(
  quitter: string,
): Promise<{ turns: Turn[]; win: WinUpdate }> {
  let win: WinUpdate | null = null;
  const runner = await createGameRunner(
    gameStart(),
    undefined,
    await mapFiles(),
    (gu) => {
      if ("errMsg" in gu) throw new Error(gu.errMsg);
      win ??= gu.updates[GameUpdateType.Win][0] ?? null;
    },
  );
  const game = runner.game;
  const turns: Turn[] = [];
  let quit = false;
  for (let tick = 0; win === null; tick++) {
    if (tick > 2000) throw new Error("live game never produced a winner");
    const turn: Turn = { turnNumber: tick, intents: [] };
    if (tick === 5) {
      turn.intents.push(
        { type: "spawn", tile: game.ref(20, 20), clientID: P1 },
        { type: "spawn", tile: game.ref(80, 80), clientID: P2 },
      );
    }
    if (!quit && !game.inSpawnPhase()) {
      turn.intents.push({
        type: "mark_disconnected",
        isDisconnected: true,
        clientID: quitter,
      });
      quit = true;
    }
    turns.push(turn);
    runner.addTurn(turn);
    runner.executeNextTick();
  }
  return { turns, win };
}

describe("replayWinner", () => {
  it("reaches the same result as the live game", async () => {
    const { turns, win } = await playLive(P2);
    expect(win.winner).toEqual(["player", P1]);

    const replayed = await replayWinner(gameStart(), turns, await mapFiles());

    expect(replayed.winner).toEqual(win.winner);
    expect(replayed.allPlayersStats).toEqual(win.allPlayersStats);
    expect(replayed.tick).toBe(turns.length);
  });

  it("follows the turn log, not anyone's claim", async () => {
    const { turns } = await playLive(P1);
    const replayed = await replayWinner(gameStart(), turns, await mapFiles());
    expect(replayed.winner).toEqual(["player", P2]);
  });

  it("reports no winner when the turns end before anyone wins", async () => {
    const { turns } = await playLive(P2);
    const replayed = await replayWinner(
      gameStart(),
      turns.slice(0, -20),
      await mapFiles(),
    );
    expect(replayed.winner).toBeUndefined();
    expect(replayed.tick).toBeNull();
    expect(Object.keys(replayed.allPlayersStats).sort()).toEqual([P1, P2]);
  });
});
