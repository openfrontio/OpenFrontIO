/**
 * The viewer's orchestration around processing a game in the browser:
 * a replay this browser kept opens at once, a record is processed and
 * played as it grows, and every way that can fail ends in a visible error
 * with the client-side replay offered - never an endless "Preparing".
 */

import type { SettingsModal } from "../../../src/client/hud/layers/SettingsModal";
import { MapRenderer } from "../../../src/client/render/gl";
import type {
  ReplayAppend,
  ReplayBase,
  ReplayData,
} from "../../../src/client/replay/codec/ReplayTypes";
import {
  processInBrowser,
  type ProcessingHandlers,
} from "../../../src/client/replay/LocalProcessing";
import { ReplayPlayback } from "../../../src/client/replay/ReplayPlayback";
import { fetchReplayRecord } from "../../../src/client/replay/ReplayRecord";
import { replayStore } from "../../../src/client/replay/ReplayStore";
import { ReplayViewer } from "../../../src/client/replay/ReplayViewer";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import type { GameRecord } from "../../../src/core/Schemas";

vi.mock("../../../src/client/replay/ReplayRecord", () => ({
  fetchReplayRecord: vi.fn(),
}));
vi.mock("../../../src/client/replay/ReplayStore", () => ({
  replayStore: { get: vi.fn(), put: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../../src/client/replay/LocalProcessing", () => ({
  processInBrowser: vi.fn(),
}));
vi.mock("../../../src/core/game/TerrainMapLoader", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadTerrainMap: vi.fn(),
}));
vi.mock("../../../src/client/render/gl", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  preloadAtlasData: vi.fn(async () => {}),
  MapRenderer: vi.fn(),
}));
vi.mock("../../../src/client/replay/ReplayEntry", () => ({
  versionedViewerUrl: vi.fn(async () => null),
  classicReplayHref: () => "/game/dqKzit4cWu",
}));

const RECORD = {
  info: { gameID: "dqKzit4cWu", num_turns: 15691 },
} as unknown as GameRecord;
/** What the worker sends: the game's base, then appends. */
const BASE = {} as ReplayBase;
const FIRST = {} as ReplayAppend;
const MORE = {} as ReplayAppend;
/** A replay this browser kept. */
const STORED = { base: BASE, append: FIRST } as ReplayData;
/** One that doesn't open at all. */
const DAMAGED = {} as ReplayData;

interface FakePlayback {
  live: boolean;
  append: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  data: ReturnType<typeof vi.fn>;
}

// Exercise the viewer's async orchestration without creating a WebGL context.
function viewer() {
  const element = new ReplayViewer();
  element.gameID = "dqKzit4cWu";
  const v = element as unknown as {
    status: string;
    error: string;
    stoppedEarly: string;
    classicFallback: boolean;
    growing: boolean;
    gameLength: number | null;
    playback: FakePlayback | null;
    applying: Promise<void>;
    start(source: unknown): Promise<void>;
    open(): Promise<void>;
    reportError(err: unknown, inReplay?: boolean): void;
    view: unknown;
    disconnectedCallback(): void;
  };
  const playback: FakePlayback = {
    live: false,
    append: vi.fn(),
    pause: vi.fn(),
    data: vi.fn(() => STORED),
  };
  const start = vi.spyOn(v, "start").mockImplementation(async () => {
    v.playback = playback;
  });
  return { v, playback, start };
}

/** Starts processing and returns the handlers the viewer gave the worker. */
async function processing() {
  let handlers!: ProcessingHandlers;
  const cancel = vi.fn();
  vi.mocked(processInBrowser).mockImplementation((_record, h) => {
    handlers = h;
    return { cancel };
  });
  vi.mocked(fetchReplayRecord).mockResolvedValue({
    kind: "record",
    record: RECORD,
  });
  const { v, playback, start } = viewer();
  await v.open();
  handlers.onStart(BASE);
  return { v, playback, start, handlers, cancel };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(replayStore.get).mockResolvedValue(undefined);
  vi.mocked(replayStore.put).mockResolvedValue();
  vi.mocked(replayStore.remove).mockResolvedValue();
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test("a replay this browser kept opens without fetching or processing", async () => {
  vi.mocked(replayStore.get).mockResolvedValue(STORED);
  const { v, start } = viewer();
  await v.open();
  expect(start).toHaveBeenCalledWith(STORED);
  expect(v.status).toBe("ready");
  expect(fetchReplayRecord).not.toHaveBeenCalled();
  expect(processInBrowser).not.toHaveBeenCalled();
});

test("a stored replay that won't open is forgotten, and the game processed again", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(replayStore.get).mockResolvedValue(DAMAGED);
  vi.mocked(fetchReplayRecord).mockResolvedValue({
    kind: "record",
    record: RECORD,
  });
  vi.mocked(processInBrowser).mockReturnValue({ cancel: vi.fn() });
  const { v, start } = viewer();
  // The real start, so the replay really fails to open.
  start.mockRestore();
  await v.open();
  expect(replayStore.remove).toHaveBeenCalledWith("dqKzit4cWu");
  expect(processInBrowser).toHaveBeenCalledOnce();
  expect(v.status).toBe("processing");
});

test("a stored replay that breaks while playing is forgotten", async () => {
  vi.mocked(replayStore.get).mockResolvedValue(STORED);
  const { v } = viewer();
  await v.open();
  v.reportError(new Error("corrupt chunk"), /* inReplay */ true);
  expect(v.status).toBe("error");
  expect(replayStore.remove).toHaveBeenCalledWith("dqKzit4cWu");
});

test("a stored replay is kept when something else fails (no WebGL, a download)", async () => {
  vi.mocked(replayStore.get).mockResolvedValue(STORED);
  const { v, start } = viewer();
  start.mockRejectedValueOnce(new Error("WebGL unavailable"));
  await v.open();
  expect(v.status).toBe("error");
  v.reportError(new Error("context lost"));
  expect(replayStore.remove).not.toHaveBeenCalled();
});

test("closing the viewer while it starts creates no renderer", async () => {
  vi.mocked(replayStore.get).mockResolvedValue({
    base: { gameStartInfo: { config: {} } },
    append: FIRST,
  } as ReplayData);
  vi.spyOn(ReplayPlayback, "open").mockResolvedValue({
    header: {
      gameStartInfo: { config: {} },
      mapWidth: 4,
      mapHeight: 4,
      players: [],
    },
  } as unknown as ReplayPlayback);
  let terrainLoaded!: () => void;
  vi.mocked(loadTerrainMap).mockReturnValue(
    new Promise((resolve) => {
      terrainLoaded = () =>
        resolve({
          gameMap: { width: () => 4, height: () => 4 },
        } as unknown as Awaited<ReturnType<typeof loadTerrainMap>>);
    }),
  );
  const element = new ReplayViewer();
  element.gameID = "dqKzit4cWu";
  const v = element as unknown as {
    error: string;
    view: unknown;
    open(): Promise<void>;
  };
  const opened = v.open();
  await vi.waitFor(() => expect(loadTerrainMap).toHaveBeenCalled());
  element.disconnectedCallback();
  terrainLoaded();
  await opened;
  expect(MapRenderer).not.toHaveBeenCalled();
  expect(v.view).toBeNull();
  expect(v.error).toBe("");
});

test.each([
  ["not_found", "replay_viewer.unavailable_not_found"],
  ["unreachable", "replay_viewer.unavailable_unreachable"],
  // Another build, with no versioned shell to send it to (dev).
  ["other_build", "replay_viewer.unavailable_other_build"],
] as const)(
  "a record that can't be processed here (%s) is an error",
  async (kind, text) => {
    vi.mocked(fetchReplayRecord).mockResolvedValue({ kind });
    const { v } = viewer();
    await v.open();
    expect(v.status).toBe("error");
    expect(v.error).toBe(text);
    expect(v.classicFallback).toBe(true);
    expect(processInBrowser).not.toHaveBeenCalled();
  },
);

test("plays as the game is processed, and keeps the finished replay", async () => {
  const { v, playback, start, handlers } = await processing();
  expect(v.status).toBe("processing");
  // The timeline spans the whole game from the start.
  expect(v.gameLength).toBe(15691);

  handlers.onAppend(FIRST);
  await v.applying;
  expect(start).toHaveBeenCalledWith({ base: BASE, append: FIRST });
  expect(v.status).toBe("ready");
  expect(v.growing).toBe(true);
  expect(playback.live).toBe(true);

  handlers.onAppend(MORE);
  handlers.onDone();
  await v.applying;
  expect(start).toHaveBeenCalledOnce();
  expect(playback.append).toHaveBeenCalledExactlyOnceWith(MORE);
  expect(v.growing).toBe(false);
  expect(playback.live).toBe(false);
  // Stored from what the viewer holds.
  await vi.waitFor(() =>
    expect(replayStore.put).toHaveBeenCalledExactlyOnceWith(
      "dqKzit4cWu",
      STORED,
    ),
  );
});

test("a desync before any frames is an error, and the client-side replay is offered", async () => {
  const { v, handlers } = await processing();
  handlers.onError("diverged at turn 30", true);
  await v.applying;
  expect(v.status).toBe("error");
  expect(v.error).toBe("replay_viewer.unavailable_desync");
  expect(v.classicFallback).toBe(true);
  expect(v.growing).toBe(false);
});

test("a desync while playing keeps what was processed watchable", async () => {
  const { v, playback, handlers } = await processing();
  handlers.onAppend(FIRST);
  // The error comes while the first append is still being applied.
  handlers.onError("diverged at turn 3000", true);
  await v.applying;
  expect(v.status).toBe("ready");
  expect(v.stoppedEarly).toBe("replay_viewer.unavailable_desync");
  expect(v.growing).toBe(false);
  expect(playback.live).toBe(false);
  expect(playback.pause).not.toHaveBeenCalled();
  // A replay that isn't whole isn't kept.
  expect(replayStore.put).not.toHaveBeenCalled();
});

test("a renderer failure stops processing and ignores later appends", async () => {
  const { v, playback, start, handlers, cancel } = await processing();
  start.mockRejectedValueOnce(new Error("WebGL unavailable"));
  handlers.onAppend(FIRST);
  await v.applying;
  expect(v.status).toBe("error");
  expect(v.classicFallback).toBe(true);
  expect(cancel).toHaveBeenCalled();
  // Only a stored copy gets forgotten.
  expect(replayStore.remove).not.toHaveBeenCalled();

  handlers.onAppend(MORE);
  await v.applying;
  expect(playback.append).not.toHaveBeenCalled();
});

test("a longer replay that won't decode ends the wait with an error", async () => {
  const { v, playback, handlers } = await processing();
  handlers.onAppend(FIRST);
  await v.applying;
  playback.append.mockImplementationOnce(() => {
    throw new Error("corrupt chunk");
  });
  handlers.onAppend(MORE);
  await v.applying;
  expect(v.status).toBe("error");
  expect(v.growing).toBe(false);
  expect(playback.pause).toHaveBeenCalled();
});

test("closing the viewer stops the worker", async () => {
  const { v, cancel } = await processing();
  v.disconnectedCallback();
  expect(cancel).toHaveBeenCalled();
});

test("the HUD elements are in the page while the replay loads", async () => {
  vi.mocked(replayStore.get).mockResolvedValue(STORED);
  const element = new ReplayViewer();
  element.gameID = "dqKzit4cWu";
  // attachHud looks them up during start(), before the status is "ready".
  const found: string[] = [];
  const started = new Promise<void>((resolve) => {
    vi.spyOn(
      element as unknown as { start(s: unknown): Promise<void> },
      "start",
    ).mockImplementation(async () => {
      await element.updateComplete;
      for (const tag of ["events-display", "player-info-overlay"]) {
        if (element.querySelector(tag) !== null) found.push(tag);
      }
      resolve();
    });
  });
  document.body.appendChild(element);
  await started;
  element.remove();
  expect(found).toEqual(["events-display", "player-info-overlay"]);
});

test("playback keys do nothing while the settings menu is open", () => {
  const element = new ReplayViewer();
  const v = element as unknown as {
    status: string;
    playback: unknown;
    onKey(e: KeyboardEvent): void;
  };
  const playback = {
    playing: false,
    frame: 10,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(async () => {}),
  };
  v.status = "ready";
  v.playback = playback;
  const menu = document.createElement("settings-modal") as SettingsModal;
  element.appendChild(menu);
  const key = (code: string) => new KeyboardEvent("keydown", { code });

  menu.openModal();
  v.onKey(key("Space"));
  v.onKey(key("ArrowRight"));
  expect(playback.play).not.toHaveBeenCalled();
  expect(playback.seek).not.toHaveBeenCalled();

  menu.closeModal({ keepPause: true });
  v.onKey(key("Space"));
  v.onKey(key("ArrowRight"));
  expect(playback.play).toHaveBeenCalledOnce();
  expect(playback.seek).toHaveBeenCalledWith(11);
});
