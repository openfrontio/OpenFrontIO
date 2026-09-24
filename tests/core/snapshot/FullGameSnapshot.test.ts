import {
  Game,
  GameMode,
  GameType,
  HumansVsNations,
} from "../../../src/core/game/Game";
import { GameRunner } from "../../../src/core/GameRunner";
import { GameConfig, GameStartInfo } from "../../../src/core/Schemas";
import { EXECUTION_SNAPSHOT_TYPES } from "../../../src/core/snapshot/ExecutionRegistry";
import { decodeSnapshotValue } from "../../../src/core/snapshot/SnapshotCodec";
import {
  createScriptedRunner,
  restoreScriptedRunner,
  scriptedGameStart,
  stepScripted,
} from "../../util/ScriptedGame";
import { diffSnapshots } from "../../util/Snapshot";

/**
 * The oracle from the design doc: a game played straight through and the
 * same game snapshotted and restored along the way must agree on every
 * tick's hash and, at every checkpoint, on the snapshot bytes themselves
 * (the hash only covers troops, tiles and unit positions).
 */

const MAP = "world";
const TICKS = 1500;
const CHECK_EVERY = 100;
// Restore at every tick of this window, chaining each restore into the next.
const WINDOW_START = 700;
const WINDOW_TICKS = 40;
const TEST_TIMEOUT = 300_000;

function hash(game: Game): number {
  return (game as unknown as { hash(): number }).hash();
}

function execTypesIn(bytes: Uint8Array, into: Set<string>): void {
  const root = decodeSnapshotValue(bytes) as { execs: { t: string }[] };
  for (const e of root.execs) into.add(e.t);
}

interface Reference {
  hashes: number[];
  checkpoints: Map<number, Uint8Array>;
  final: Uint8Array;
  winnerTick: number | null;
  execTypes: Set<string>;
}

async function playReference(start: GameStartInfo): Promise<Reference> {
  const runner = await createScriptedRunner(MAP, start);
  const hashes: number[] = [];
  const checkpoints = new Map<number, Uint8Array>();
  const execTypes = new Set<string>();
  let winnerTick: number | null = null;
  while (runner.game.ticks() < TICKS) {
    const tick = runner.game.ticks();
    if (
      tick % CHECK_EVERY === 0 ||
      (tick >= WINDOW_START && tick < WINDOW_START + WINDOW_TICKS)
    ) {
      const bytes = runner.snapshot();
      if (tick % CHECK_EVERY === 0) checkpoints.set(tick, bytes);
      execTypesIn(bytes, execTypes);
    }
    stepScripted(runner);
    hashes[runner.game.ticks()] = hash(runner.game);
    if (winnerTick === null && runner.game.getWinner() !== null) {
      winnerTick = runner.game.ticks();
    }
  }
  return {
    hashes,
    checkpoints,
    final: runner.snapshot(),
    winnerTick,
    execTypes,
  };
}

function expectOnTrack(runner: GameRunner, ref: Reference): void {
  const tick = runner.game.ticks();
  if (hash(runner.game) !== ref.hashes[tick]) {
    throw new Error(`hash diverged at tick ${tick}`);
  }
  const checkpoint = ref.checkpoints.get(tick);
  if (checkpoint !== undefined) {
    const diffs = diffSnapshots(runner.snapshot(), checkpoint);
    if (diffs.length > 0) {
      throw new Error(`state diverged at tick ${tick}:\n${diffs.join("\n")}`);
    }
  }
}

const VARIANTS: [string, Partial<GameConfig>][] = [
  ["free for all", {}],
  // Water nukes rewrite terrain and the water graph mid-game.
  ["water nukes", { waterNukes: true }],
  ["teams", { gameMode: GameMode.Team, playerTeams: 2 }],
  [
    "humans vs nations",
    { gameMode: GameMode.Team, playerTeams: HumansVsNations },
  ],
  ["random spawn", { randomSpawn: true }],
  // No spawn timer; the spawn phase ends differently.
  ["singleplayer", { gameType: GameType.Singleplayer }],
  // Overtime from minute 1, so the shrinking win bar is live in the run.
  ["overtime", { overtime: { enabled: true, startMinutes: 1 } }],
];

describe.each(VARIANTS)("full game snapshots: %s", (_, overrides) => {
  const start = scriptedGameStart(overrides);
  let reference: Reference;

  beforeAll(async () => {
    reference = await playReference(start);
  }, TEST_TIMEOUT);
  test(
    "snapshot -> restore -> snapshot is byte-identical at every checkpoint",
    async () => {
      for (const [tick, bytes] of reference.checkpoints) {
        const restored = await restoreScriptedRunner(MAP, start, bytes);
        expect(restored.game.ticks()).toBe(tick);
        const diffs = diffSnapshots(restored.snapshot(), bytes);
        expect(diffs, `tick ${tick}`).toEqual([]);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "restoring every 100 ticks continues exactly like the straight run",
    async () => {
      let runner = await restoreScriptedRunner(
        MAP,
        start,
        reference.checkpoints.get(0)!,
      );
      let winnerTick: number | null = null;
      while (runner.game.ticks() < TICKS) {
        stepScripted(runner);
        expectOnTrack(runner, reference);
        if (winnerTick === null && runner.game.getWinner() !== null) {
          winnerTick = runner.game.ticks();
        }
        if (runner.game.ticks() % CHECK_EVERY === 0) {
          runner = await restoreScriptedRunner(MAP, start, runner.snapshot());
        }
      }
      expect(diffSnapshots(runner.snapshot(), reference.final)).toEqual([]);
      expect(winnerTick).toBe(reference.winnerTick);
    },
    TEST_TIMEOUT,
  );

  test(
    "restoring at every tick of a mid-game window stays on track",
    async () => {
      const from = Math.floor(WINDOW_START / CHECK_EVERY) * CHECK_EVERY;
      let runner = await restoreScriptedRunner(
        MAP,
        start,
        reference.checkpoints.get(from)!,
      );
      while (runner.game.ticks() < WINDOW_START) stepScripted(runner);
      while (runner.game.ticks() < WINDOW_START + WINDOW_TICKS) {
        runner = await restoreScriptedRunner(MAP, start, runner.snapshot());
        stepScripted(runner);
        expectOnTrack(runner, reference);
      }
    },
    TEST_TIMEOUT,
  );

  test(
    "the game exercised every execution type",
    () => {
      if (Object.keys(overrides).length > 0) return; // checked once, on FFA
      // Runs during the spawn phase and finishes inside init, so it is never
      // alive at a tick boundary. BasicExecutions.test.ts covers it directly.
      const neverStored = new Set(["Pause"]);
      const missing = EXECUTION_SNAPSHOT_TYPES.map((t) => t.name).filter(
        (name) => !reference.execTypes.has(name) && !neverStored.has(name),
      );
      expect(missing).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
