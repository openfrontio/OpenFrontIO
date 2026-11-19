/**
 * Only a worker started in editor mode takes editor commands. It answers
 * each with the updates it made, as a batch for the current tick, then the
 * result.
 */

import {
  CustomGameMap,
  GameMapSize,
} from "@openfront/engine-api/game/GameTypes";
import type {
  EditorCommandResultMessage,
  GameUpdateBatchMessage,
  MainThreadMessage,
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

async function init(editor: boolean): Promise<void> {
  const gameStartInfo = {
    ...scriptedGameStart({
      gameMap: CustomGameMap,
      gameMapSize: GameMapSize.Normal,
      nations: "disabled",
      bots: 0,
    }),
    players: [],
  };
  const map = await loadMapFiles(
    new TestDataMapLoader("half_land_half_ocean"),
    CustomGameMap,
    GameMapSize.Normal,
  );
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
