/**
 * Only a worker started in editor mode takes editor commands. It answers
 * each with the updates it made, as a batch for the current tick, then the
 * result.
 */

import type { EditorCommand } from "@openfront/engine-api/EditorCommands";
import {
  CustomGameMap,
  GameMapSize,
} from "@openfront/engine-api/game/GameTypes";
import type {
  EditorCommandResultMessage,
  GameUpdateBatchMessage,
  InitErrorMessage,
  MainThreadMessage,
  RunTurnsResultMessage,
  WorkerMessage,
} from "@openfront/engine-api/worker/WorkerMessages";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { scriptedGameStart, TestDataMapLoader } from "../../util/ScriptedGame";

const self = Object.assign(new EventTarget(), { postMessage: vi.fn() });

beforeAll(async () => {
  vi.stubGlobal("self", self);
  await import("@openfront/engine/worker/Worker.worker");
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  self.postMessage.mockClear();
});

function posted(): WorkerMessage[] {
  return self.postMessage.mock.calls.map((c) => c[0] as WorkerMessage);
}

/** Sends a message and waits for the reply of the given type. */
async function send<T extends WorkerMessage>(
  data: MainThreadMessage,
  reply: T["type"],
): Promise<T> {
  self.dispatchEvent(new MessageEvent("message", { data }));
  let found: T | undefined;
  await vi.waitFor(() => {
    found = posted().find((m) => m.type === reply && m.id === data.id) as T;
    expect(found).toBeDefined();
  });
  return found!;
}

function editorGameStart() {
  return {
    ...scriptedGameStart({
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
      bots: 0,
    }),
    players: [],
  };
}

function mapFiles() {
  return loadMapFiles(
    new TestDataMapLoader("half_land_half_ocean"),
    CustomGameMap,
    GameMapSize.Normal,
  );
}

async function init(editor: boolean): Promise<void> {
  const gameStartInfo = editorGameStart();
  const map = await mapFiles();
  await send(
    {
      type: "init",
      id: `init-${editor}`,
      gameStartInfo,
      clientID: undefined,
      map,
      ...(editor ? { editor } : {}),
    },
    "initialized",
  );
  self.postMessage.mockClear();
}

const ADD: MainThreadMessage = {
  type: "editor_command",
  id: "cmd1",
  command: { type: "add_nation", id: "FRANCE01", name: "France", flag: null },
};

test("a normal game rejects editor commands", async () => {
  await init(false);
  const result = await send<EditorCommandResultMessage>(
    ADD,
    "editor_command_result",
  );
  expect(result.error).toMatch(/not in editor mode/);
  expect(posted().map((m) => m.type)).toEqual(["editor_command_result"]);
});

test("an editor game applies a command and sends its updates", async () => {
  await init(true);
  const result = await send<EditorCommandResultMessage>(
    ADD,
    "editor_command_result",
  );
  expect(result.error).toBeUndefined();
  expect(posted().map((m) => m.type)).toEqual([
    "game_update_batch",
    "editor_command_result",
  ]);
  const batch = posted()[0] as GameUpdateBatchMessage;
  expect(batch.gameUpdates).toHaveLength(1);
  expect(batch.gameUpdates[0].tick).toBe(0);
});

test("an editor game rejects a bad command with the reason", async () => {
  await init(true);
  const result = await send<EditorCommandResultMessage>(
    {
      type: "editor_command",
      id: "cmd2",
      command: { type: "remove_nation", id: "NOBODY01" },
    },
    "editor_command_result",
  );
  expect(result.error).toMatch(/no nation NOBODY01/);
  expect(posted().map((m) => m.type)).toEqual(["editor_command_result"]);
});

test("an editor game takes no turns", async () => {
  await init(true);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    self.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "turn", turn: { turnNumber: 0, intents: [] } },
      }),
    );
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith("an editor engine doesn't take turns"),
    );
  } finally {
    warn.mockRestore();
  }
  const result = await send<RunTurnsResultMessage>(
    {
      type: "run_turns",
      id: "run1",
      turns: [{ turnNumber: 0, intents: [] }],
    },
    "run_turns_result",
  );
  expect(result.error?.errMsg).toMatch(/doesn't take turns/);
  expect(result.gameUpdates).toEqual([]);
  expect(posted().map((m) => m.type)).toEqual(["run_turns_result"]);
});

test("export_terrain answers with the map files written before the next command", async () => {
  await init(true);
  const command = (id: string, command: EditorCommand): MainThreadMessage => ({
    type: "editor_command",
    id,
    command,
  });
  // Sent together: each waits for the one before it to finish.
  self.dispatchEvent(
    new MessageEvent("message", {
      data: command("export1", { type: "export_terrain" }),
    }),
  );
  self.dispatchEvent(
    new MessageEvent("message", {
      data: command("water", {
        type: "set_terrain",
        tiles: [0],
        terrain: [0],
      }),
    }),
  );
  const second = await send<EditorCommandResultMessage>(
    command("export2", { type: "export_terrain" }),
    "editor_command_result",
  );
  const results = posted().filter(
    (m) => m.type === "editor_command_result",
  ) as EditorCommandResultMessage[];
  expect(results.map((m) => m.id)).toEqual(["export1", "water", "export2"]);
  const first = results[0];
  expect(first.error).toBeUndefined();
  expect(first.map!.map).toBe(CustomGameMap);
  // Tile 0 is land on this map until the set_terrain sent after the first
  // export makes it water.
  expect(first.map!.mapBin![0] & 0x80).toBe(0x80);
  expect(second.map!.mapBin![0] & 0x80).toBe(0);
  expect(second.map!.manifest.map.num_land_tiles).toBe(
    first.map!.manifest.map.num_land_tiles - 1,
  );
  // The files' buffers are transferred, not copied.
  const call = self.postMessage.mock.calls.find((c) => c[0] === first);
  expect(call![1]).toEqual([
    first.map!.mapBin!.buffer,
    first.map!.map4xBin!.buffer,
    first.map!.map16xBin!.buffer,
  ]);
});

test("an editor game can't start from a snapshot", async () => {
  const result = await send<InitErrorMessage>(
    {
      type: "init",
      id: "init-snapshot",
      gameStartInfo: editorGameStart(),
      clientID: undefined,
      map: await mapFiles(),
      snapshot: new Uint8Array(),
      editor: true,
    },
    "init_error",
  );
  expect(result.error).toMatch(/can't start from a snapshot/);
});
