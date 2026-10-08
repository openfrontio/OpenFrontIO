/**
 * Which replay a "watch replay" click opens, and the record the viewer
 * processes: the viewer for a game this build can replay, the versioned
 * shell for one from another build, and the client-side replay when the
 * viewer sent the game back.
 */

import type { GameRecord } from "@openfront/shared/WireSchemas";
import { ClientEnv } from "../../../src/client/ClientEnv";
import {
  classicReplayHref,
  openReplayViewer,
  replayViewerHref,
  versionedViewerUrl,
} from "../../../src/client/replay/ReplayEntry";
import { fetchReplayRecord } from "../../../src/client/replay/ReplayRecord";
import { UserSettings } from "../../../src/client/UserSettings";

// jsdom can't change location.hostname, so a test says whether this page
// is a replay shell.
const shell = vi.hoisted(() => ({ host: false }));
vi.mock("../../../src/client/VersionedReplay", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../src/client/VersionedReplay")
  >()),
  isReplayShellHost: () => shell.host,
}));

const record = (gitCommit: string) =>
  ({
    gitCommit,
    info: { gameID: "abcd1234" },
  }) as unknown as GameRecord;

function config(gameEnv: string, jwtAudience: string) {
  (window as any).BOOTSTRAP_CONFIG = {
    gameEnv,
    numWorkers: 1,
    turnstileSiteKey: "x",
    jwtAudience,
    instanceId: "test",
    gitCommit: "test",
  };
  ClientEnv.reset();
}

beforeEach(() => {
  // The viewer is opt-in; these tests are about what happens once it's on.
  new UserSettings().setReplayViewer(true);
  shell.host = false;
  sessionStorage.clear();
  window.location.hash = "";
  config("dev", "localhost");
});

afterEach(() => {
  delete (window as any).BOOTSTRAP_CONFIG;
  ClientEnv.reset();
  vi.restoreAllMocks();
});

describe("openReplayViewer", () => {
  test("without the setting, the classic replay opens", () => {
    new UserSettings().setReplayViewer(false);
    expect(openReplayViewer("abcd1234", record("test"))).toBe(false);
    expect(window.location.hash).toBe("");
  });

  test("opens the viewer and hands it the record, so it isn't fetched again", async () => {
    const fetchFn = vi.fn();
    expect(openReplayViewer("abcd1234", record("test"))).toBe(true);
    expect(window.location.hash).toBe(
      new URL(replayViewerHref("abcd1234"), window.location.href).hash,
    );

    const got = await fetchReplayRecord("abcd1234", { fetchFn });
    expect(got).toEqual({ kind: "record", record: record("test") });
    expect(fetchFn).not.toHaveBeenCalled();
    // Taken once: a later open fetches.
    fetchFn.mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await fetchReplayRecord("abcd1234", { fetchFn })).toEqual({
      kind: "not_found",
    });
  });

  test("a game the viewer sent back stays on the client-side replay", () => {
    classicReplayHref("abcd1234");
    expect(openReplayViewer("abcd1234", record("test"))).toBe(false);
    expect(window.location.hash).toBe("");
    // Only that game.
    expect(openReplayViewer("efgh5678", record("test"))).toBe(true);
  });

  test("on a replay shell the client-side replay is the shell's own page", () => {
    // /game/<id> only exists on the game-server origin.
    expect(classicReplayHref("abcd1234")).toMatch(/\/game\/abcd1234$/);
    shell.host = true;
    expect(classicReplayHref("abcd1234")).toBe("/abcd1234");
  });
});

test("a game from another build is watched on its versioned shell", async () => {
  const fetchFn = vi.fn(
    async () => new Response("", { headers: { "content-type": "text/html" } }),
  );
  vi.stubGlobal("fetch", fetchFn);
  try {
    expect(await versionedViewerUrl("abcd1234")).toBeNull(); // dev: no shell host
    expect(fetchFn).not.toHaveBeenCalled();
    config("prod", "openfront.io");
    expect(await versionedViewerUrl("abcd1234")).toBe(
      "https://replay.openfront.io/abcd1234",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
