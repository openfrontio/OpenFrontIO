import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractSnapshotInWorker } from "../../../src/client/replay/LocalProcessing";
import { fetchReplayRecord } from "../../../src/client/replay/ReplayRecord";
import { ReplayViewer } from "../../../src/client/replay/ReplayViewer";
import { Difficulty } from "../../../src/core/game/Game";

vi.mock("../../../src/client/replay/ReplayRecord", () => ({
  fetchReplayRecord: vi.fn(),
}));

vi.mock("../../../src/client/replay/LocalProcessing", () => ({
  processInBrowser: vi.fn(),
  extractSnapshotInWorker: vi.fn(),
}));

vi.mock("../../../src/client/replay/ReplayStore", () => ({
  replayStore: { get: vi.fn(), put: vi.fn(), remove: vi.fn() },
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
  classicReplayHref: () => "/game/test1234",
}));

describe("ReplayViewer continue game cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not dispatch join-lobby if modal is closed during fetchReplayRecord", async () => {
    const viewer = new ReplayViewer() as any;
    viewer.gameID = "test1234";

    let resolveFetch!: (value: any) => void;
    vi.mocked(fetchReplayRecord).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const joinLobbyListener = vi.fn();
    document.addEventListener("join-lobby", joinLobbyListener);

    viewer.openContinueModal();
    const continuePromise = viewer.handleContinueGame(
      new CustomEvent("continue", {
        detail: { playerID: "p1", difficulty: Difficulty.Medium },
      }),
    );

    // User closes modal before fetch completes
    viewer.closeContinueModal();

    resolveFetch({
      kind: "record",
      record: { info: { gameID: "test1234" } },
    });

    await continuePromise;

    expect(extractSnapshotInWorker).not.toHaveBeenCalled();
    expect(joinLobbyListener).not.toHaveBeenCalled();
    document.removeEventListener("join-lobby", joinLobbyListener);
  });

  it("does not dispatch join-lobby if modal is closed during extractSnapshotInWorker", async () => {
    const viewer = new ReplayViewer() as any;
    viewer.gameID = "test1234";
    viewer.record = { info: { gameID: "test1234" } } as any;

    let resolveExtract!: (value: any) => void;
    vi.mocked(extractSnapshotInWorker).mockReturnValue(
      new Promise((resolve) => {
        resolveExtract = resolve;
      }),
    );

    const joinLobbyListener = vi.fn();
    document.addEventListener("join-lobby", joinLobbyListener);

    viewer.openContinueModal();
    const continuePromise = viewer.handleContinueGame(
      new CustomEvent("continue", {
        detail: { playerID: "p1", difficulty: Difficulty.Medium },
      }),
    );

    // User closes modal before worker finishes
    viewer.closeContinueModal();

    resolveExtract({
      snapshot: new Uint8Array([1, 2, 3]),
      gameStartInfo: { gameID: "test1234_c" },
    });

    await continuePromise;

    expect(joinLobbyListener).not.toHaveBeenCalled();
    document.removeEventListener("join-lobby", joinLobbyListener);
  });

  it("dispatches join-lobby when the request remains active", async () => {
    const viewer = new ReplayViewer() as any;
    viewer.gameID = "test1234";
    viewer.record = { info: { gameID: "test1234" } } as any;

    vi.mocked(extractSnapshotInWorker).mockResolvedValue({
      snapshot: new Uint8Array([1, 2, 3]),
      gameStartInfo: { gameID: "test1234_c" } as any,
    });

    const joinLobbyListener = vi.fn();
    document.addEventListener("join-lobby", joinLobbyListener);

    viewer.openContinueModal();
    await viewer.handleContinueGame(
      new CustomEvent("continue", {
        detail: { playerID: "p1", difficulty: Difficulty.Medium },
      }),
    );

    expect(joinLobbyListener).toHaveBeenCalledTimes(1);
    expect(viewer.continueModalOpen).toBe(false);
    document.removeEventListener("join-lobby", joinLobbyListener);
  });
});
