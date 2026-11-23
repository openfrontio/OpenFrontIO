// @vitest-environment node
/**
 * Starting a game from a scenario bundle (docs/ScenarioEditor.md, "Starting
 * a game from a bundle"): the restore hands each assigned nation to its
 * player, in list order, the same way on every run, and refuses the whole
 * start if any assignment is bad. The client's start path turns bundle bytes
 * into a singleplayer join on one nation.
 */

import {
  CustomGameMap,
  GameMapSize,
  PlayerType,
} from "@openfront/engine-api/game/GameTypes";
import {
  ErrorUpdate,
  GameUpdateViewData,
} from "@openfront/engine-api/game/GameUpdates";
import { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { GameStartInfo } from "@openfront/engine-api/Schemas";
import {
  createGameRunner,
  createGameRunnerFromSnapshot,
  GameRunner,
} from "@openfront/engine/GameRunner";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { WireGameStartInfoSchema } from "@openfront/shared/WireSchemas";
import { expect, test, vi } from "vitest";
import { DocumentEditor } from "../../../src/client/scenario/DocumentEditor";
import {
  blankMapFiles,
  editorStartInfo,
} from "../../../src/client/scenario/EditorEngine";
import {
  loadScenarioBundle,
  ScenarioBundleError,
  useScenarioMap,
} from "../../../src/client/scenario/ScenarioBundle";
import {
  land,
  newScenarioDocument,
} from "../../../src/client/scenario/ScenarioDocument";
import { exportScenario } from "../../../src/client/scenario/ScenarioExport";
import { replayDocument } from "../../../src/client/scenario/ScenarioReplay";
import { scenarioGameStart } from "../../../src/client/scenario/ScenarioStart";
import { terrainMapFileLoader } from "../../../src/client/TerrainMapFileLoader";
import { UnreadableSnapshotError } from "../../../src/client/WorkerClient";

// The page reads a snapshot's header on a worker of its own; here the
// engine reads it in place, unless a test stands in for the worker.
const worker = vi.hoisted(() => ({
  readHeader: null as ((snapshot: Uint8Array) => Promise<unknown>) | null,
}));
vi.mock("../../../src/client/WorkerClient", async (importOriginal) => {
  const { readSnapshotHeader } =
    await import("@openfront/engine/snapshot/GameSnapshot");
  return {
    ...(await importOriginal<
      typeof import("../../../src/client/WorkerClient")
    >()),
    readSnapshotHeader: async (snapshot: Uint8Array) =>
      worker.readHeader
        ? worker.readHeader(snapshot)
        : readSnapshotHeader(snapshot),
  };
});

const W = 100;
const H = 100;
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const SCENARIO = { id: "SCEN0001", version: 3 };
const ALICE = "ALICE001";
const BOB = "BOB00001";

function throwOnError(gu: GameUpdateViewData | ErrorUpdate): void {
  if ("errMsg" in gu) throw new Error(gu.errMsg);
}

function rect(x: number, y: number, w: number, h: number): number[] {
  const tiles: number[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) tiles.push((y + dy) * W + x + dx);
  }
  return tiles;
}

function nation(id: string, playable: boolean) {
  return {
    id,
    name: id.slice(0, 4),
    flag: null,
    troops: 5000,
    gold: 0,
    playable,
  };
}

async function engine(start: GameStartInfo, files: MapFiles) {
  return createGameRunner(start, undefined, files, throwOnError, true);
}

let bundle: Promise<Uint8Array> | undefined;

/**
 * Land with three nations on it, two of them playable, West and the AI one
 * allied; exported once.
 */
function scenarioBundle(): Promise<Uint8Array> {
  bundle ??= (async () => {
    const doc = newScenarioDocument("Test", W, H);
    const runner = await engine(editorStartInfo(), blankMapFiles(W, H));
    replayDocument(doc, (c) => runner.applyEditorCommand(c));
    const editor = new DocumentEditor(doc, (c) => runner.applyEditorCommand(c));
    const continent = rect(10, 10, 80, 80);
    editor.apply({
      type: "set_terrain",
      tiles: continent,
      terrain: continent.map(() => land(5)),
    });
    editor.apply({ type: "add_nation", nation: nation("WESTNAT1", true) });
    editor.apply({ type: "add_nation", nation: nation("EASTNAT1", true) });
    editor.apply({ type: "add_nation", nation: nation("MIDNAT01", false) });
    editor.apply({
      type: "set_owner",
      tiles: rect(10, 40, 20, 20),
      owner: "WESTNAT1",
    });
    editor.apply({
      type: "set_owner",
      tiles: rect(70, 40, 20, 20),
      owner: "EASTNAT1",
    });
    editor.apply({
      type: "set_owner",
      tiles: rect(40, 10, 20, 20),
      owner: "MIDNAT01",
    });
    editor.apply({ type: "add_alliance", nations: ["WESTNAT1", "MIDNAT01"] });
    editor.commit();
    return exportScenario(doc, async (c) => runner.applyEditorCommand(c), {
      scenario: SCENARIO,
      gitCommit: COMMIT,
      startEngine: async (start, files) => {
        const exporting = await engine(start, files);
        return {
          command: async (c) => exporting.applyEditorCommand(c),
          snapshot: async (gitCommit) => exporting.snapshot(gitCommit),
          close: () => {},
        };
      },
      renderThumbnail: async () =>
        new Uint8Array([
          ...new TextEncoder().encode("RIFF"),
          4,
          0,
          0,
          0,
          ...new TextEncoder().encode("WEBP"),
        ]),
    });
  })();
  return bundle;
}

function startInfo(
  assignments: { clientID: string; nationID: string }[],
  players = [ALICE, BOB],
): GameStartInfo {
  return {
    ...editorStartInfo(),
    gameID: "GAME0001",
    players: players.map((clientID) => ({
      clientID,
      username: clientID,
      clanTag: null,
    })),
    scenario: { ...SCENARIO, hash: "0".repeat(64), assignments },
  };
}

/** Restores the bundle's snapshot as a game with this start. */
async function start(
  gzipped: Uint8Array,
  gameStart: GameStartInfo,
): Promise<GameRunner> {
  const loaded = await loadScenarioBundle(gzipped);
  useScenarioMap(loaded);
  return createGameRunnerFromSnapshot(
    gameStart,
    loaded.snapshot,
    undefined,
    await loadMapFiles(terrainMapFileLoader, CustomGameMap, GameMapSize.Normal),
    throwOnError,
  );
}

function play(runner: GameRunner, turns: number): void {
  for (let turn = 0; turn < turns; turn++) {
    runner.addTurn({ turnNumber: turn, intents: [] });
    expect(runner.executeNextTick()).toBe(true);
  }
}

test("each assigned nation goes to its player, and every run reaches the same state", async () => {
  const gzipped = await scenarioBundle();
  const gameStart = startInfo([
    { clientID: BOB, nationID: "EASTNAT1" },
    { clientID: ALICE, nationID: "WESTNAT1" },
  ]);

  const runs: Uint8Array[] = [];
  for (let run = 0; run < 2; run++) {
    const runner = await start(gzipped, gameStart);
    const game = runner.game;
    for (const [clientID, nationID, name] of [
      [ALICE, "WESTNAT1", "WEST"],
      [BOB, "EASTNAT1", "EAST"],
    ]) {
      const player = game.playerByClientID(clientID)!;
      expect(player.id()).toBe(nationID);
      expect(player.type()).toBe(PlayerType.Human);
      // The nation keeps its name and land.
      expect(player.name()).toBe(name);
      expect(player.numTilesOwned()).toBe(400);
    }
    // The AI runs only the nation nobody took.
    expect(game.nations().map((n) => n.playerInfo.id)).toEqual(["MIDNAT01"]);
    // Alice starts allied with the nation West was allied with.
    const mid = game.player("MIDNAT01");
    expect(game.playerByClientID(ALICE)!.isAlliedWith(mid)).toBe(true);
    expect(game.playerByClientID(BOB)!.isAlliedWith(mid)).toBe(false);

    play(runner, 30);
    runs.push(runner.snapshot(COMMIT));
  }
  expect(runs[1]).toEqual(runs[0]);
}, 30_000);

test("without a scenario block the snapshot restores with every nation AI-run", async () => {
  const runner = await start(await scenarioBundle(), {
    ...startInfo([]),
    scenario: undefined,
  });
  expect(runner.game.nations()).toHaveLength(3);
  expect(runner.game.playerByClientID(ALICE)).toBeNull();
}, 30_000);

test.each([
  [
    "a nation that doesn't exist",
    startInfo([{ clientID: ALICE, nationID: "NOSUCH01" }], [ALICE]),
    "no nation NOSUCH01",
  ],
  [
    "a nation that isn't playable",
    startInfo([{ clientID: ALICE, nationID: "MIDNAT01" }], [ALICE]),
    "nation MIDNAT01 is not playable",
  ],
  [
    "a nation assigned twice",
    startInfo([
      { clientID: ALICE, nationID: "WESTNAT1" },
      { clientID: BOB, nationID: "WESTNAT1" },
    ]),
    "nation WESTNAT1 is assigned twice",
  ],
  [
    "a client that isn't a player",
    startInfo([{ clientID: BOB, nationID: "WESTNAT1" }], [ALICE]),
    "client BOB00001 is not a player",
  ],
  [
    "a player given two nations",
    startInfo(
      [
        { clientID: ALICE, nationID: "WESTNAT1" },
        { clientID: ALICE, nationID: "EASTNAT1" },
      ],
      [ALICE],
    ),
    "client ALICE001 has two nations",
  ],
  [
    "a player without a nation",
    startInfo([{ clientID: ALICE, nationID: "WESTNAT1" }]),
    "a player has no nation",
  ],
])(
  "the restore refuses %s",
  async (_, gameStart, message) => {
    await expect(start(await scenarioBundle(), gameStart)).rejects.toThrow(
      `scenario: ${message}`,
    );
  },
  30_000,
);

test("only a snapshot the worker can't decode reads as a newer build's", async () => {
  const gzipped = await scenarioBundle();
  const { header } = await loadScenarioBundle(gzipped);
  const player = { username: "Alice", clanTag: null };
  try {
    worker.readHeader = () =>
      Promise.reject(new UnreadableSnapshotError("snapshot format 9"));
    const unreadable = await scenarioGameStart(
      gzipped,
      header.nations[0].id,
      player,
    ).catch((e: unknown) => e);
    expect(unreadable).toBeInstanceOf(ScenarioBundleError);
    expect((unreadable as ScenarioBundleError).problem).toBe("format");

    const timeout = new Error("Timed out reading the snapshot");
    worker.readHeader = () => Promise.reject(timeout);
    await expect(
      scenarioGameStart(gzipped, header.nations[0].id, player),
    ).rejects.toBe(timeout);
  } finally {
    worker.readHeader = null;
  }
}, 30_000);

test("the start path makes a singleplayer join on the chosen nation", async () => {
  const gzipped = await scenarioBundle();
  const { header } = await loadScenarioBundle(gzipped);
  const event = await scenarioGameStart(gzipped, "EASTNAT1", {
    username: "Tester",
    clanTag: null,
  });

  expect(event.source).toBe("singleplayer");
  const gameStart = WireGameStartInfoSchema.parse(event.gameStartInfo);
  expect(gameStart.gameID).toBe(event.gameID);
  expect(gameStart.players).toHaveLength(1);
  const { clientID } = gameStart.players[0];
  expect(gameStart.scenario).toEqual({
    ...SCENARIO,
    hash: header.hash,
    assignments: [{ clientID, nationID: "EASTNAT1" }],
  });

  // The page's game restores it as the worker does: the map loader now
  // answers for the bundle's map.
  const runner = await createGameRunnerFromSnapshot(
    gameStart,
    event.snapshot!,
    clientID,
    await loadMapFiles(terrainMapFileLoader, CustomGameMap, GameMapSize.Normal),
    throwOnError,
  );
  expect(runner.game.playerByClientID(clientID)?.id()).toBe("EASTNAT1");
  play(runner, 10);
  expect(runner.game.player("EASTNAT1").isAlive()).toBe(true);
}, 30_000);

test("the start path refuses a bundle that isn't the version asked for", async () => {
  await expect(
    scenarioGameStart(
      await scenarioBundle(),
      "WESTNAT1",
      { username: "Tester", clanTag: null },
      "f".repeat(64),
    ),
  ).rejects.toThrow("not the scenario version asked for");
}, 30_000);
