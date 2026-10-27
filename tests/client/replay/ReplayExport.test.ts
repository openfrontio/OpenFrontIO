import { PlayerType, UnitType } from "@openfront/engine-api/game/GameTypes";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import {
  PlayerTypeEnum,
  type PlayerStatic,
} from "../../../src/client/render/types";
import { StreamingEncoder } from "../../../src/client/replay/codec/encode/StreamingEncoder";
import { ReplayControls } from "../../../src/client/replay/ReplayControls";
import {
  base64ToBytes,
  buildMatchStatsCsv,
  bytesToBase64,
  deserializeReplayArchive,
  downloadBlob,
  encodeGif89a,
  EXPORT_FORMATS,
  exportFilename,
  exportMatchStatsCsv,
  exportReplayGif,
  exportReplayJson,
  exportScreenshotPng,
  exportTimelapseWebm,
  exportVideo,
  sampleFrameIndices,
  serializeReplayArchive,
  type ReplayExportFormat,
} from "../../../src/client/replay/ReplayExport";
import { finish, gzip, inflate, openReader } from "./util/RecordGame";
import { frame, fullPlayer, partialPlayer, unit } from "./util/SyntheticFrames";

const P = GameUpdateType.Player;
const U = GameUpdateType.Unit;

async function buildSampleReplay(frames = 25, keyframeInterval = 10) {
  const terrain = new Uint8Array(8 * 4);
  terrain.fill(0x80, 0, 20); // first 20 tiles are land
  const enc = new StreamingEncoder({
    mapWidth: 8,
    mapHeight: 4,
    terrain,
    gzip,
    keyframeInterval,
    gameStartInfo: { gameID: "game1234", config: { gameMap: "World" } },
    numLandTiles: 20,
  });

  for (let t = 1; t <= frames; t++) {
    enc.pushFrame(
      frame(t, {
        packedTileUpdates: Uint32Array.from([(((t - 1) % 16) << 16) | 1]),
        updates:
          t === 1
            ? {
                [P]: [
                  fullPlayer(1, {
                    name: 'Alice, "The Great"',
                    displayName: 'Alice, "The Great"',
                    team: "Red",
                    tilesOwned: 12,
                    troops: 1500,
                    gold: 250n,
                    goldEarned: 300n,
                  }),
                  fullPlayer(2, {
                    clientID: null,
                    name: "BobBot",
                    displayName: "BobBot",
                    playerType: PlayerType.Nation,
                    tilesOwned: 8,
                    troops: 800,
                    gold: 100n,
                  }),
                ],
                [U]: [
                  unit(1, {
                    ownerID: 1,
                    unitType: UnitType.City,
                    isActive: true,
                  }),
                  unit(2, {
                    ownerID: 1,
                    unitType: UnitType.Port,
                    isActive: true,
                  }),
                ],
              }
            : t === 15
              ? {
                  [P]: [
                    partialPlayer(1, {
                      tilesOwned: 18,
                      troops: 2400,
                      gold: 500n,
                    }),
                    partialPlayer(2, {
                      isAlive: false,
                      tilesOwned: 0,
                      troops: 0,
                    }),
                  ],
                  [U]: [unit(2, { isActive: false })],
                }
              : {},
      }),
    );
  }
  const replay = await finish(enc);
  return { replay, terrain };
}

describe("ReplayExport utilities", () => {
  test("exportFilename generates sanitized filenames per format", () => {
    expect(exportFilename("abCD_12", "png", 420)).toBe(
      "openfront-abCD_12-t420.png",
    );
    expect(exportFilename("abCD_12", "mp4")).toBe("openfront-abCD_12-full.mp4");
    expect(exportFilename("abCD_12", "mp4", 0, "webm")).toBe(
      "openfront-abCD_12-full.webm",
    );
    expect(exportFilename("abCD_12", "webm")).toBe(
      "openfront-abCD_12-timelapse.webm",
    );
    expect(exportFilename("abCD_12", "gif")).toBe(
      "openfront-abCD_12-timelapse.gif",
    );
    expect(exportFilename("abCD_12", "json")).toBe(
      "openfront-abCD_12-replay.json",
    );
    expect(exportFilename("abCD_12", "csv")).toBe(
      "openfront-abCD_12-stats.csv",
    );
    expect(exportFilename("../bad/id!", "json")).toBe(
      "openfront-badid-replay.json",
    );
  });

  test("sampleFrameIndices picks evenly spaced indices including endpoints", () => {
    expect(sampleFrameIndices(0, 10)).toEqual([]);
    expect(sampleFrameIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleFrameIndices(100, 1)).toEqual([99]);
    expect(sampleFrameIndices(100, 5)).toEqual([0, 25, 50, 74, 99]);
  });

  test("bytesToBase64 and base64ToBytes round-trip binary buffers", () => {
    const original = new Uint8Array(1024);
    for (let i = 0; i < original.length; i++) original[i] = (i * 73) & 0xff;
    const b64 = bytesToBase64(original);
    expect(base64ToBytes(b64)).toEqual(original);
  });

  test("downloadBlob triggers an anchor download and cleans up", () => {
    vi.useFakeTimers();
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-export");
    const revokeUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    try {
      downloadBlob(new Blob(["hello"], { type: "text/plain" }), "test.txt");

      expect(createUrl).toHaveBeenCalledOnce();
      expect(clickSpy).toHaveBeenCalledOnce();
      expect(revokeUrl).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000);

      expect(revokeUrl).toHaveBeenCalledWith("blob:test-export");
    } finally {
      createUrl.mockRestore();
      revokeUrl.mockRestore();
      clickSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe("PNG screenshot export", () => {
  test("draws frame before capturing via canvas.toBlob", async () => {
    const order: string[] = [];
    const canvas = document.createElement("canvas");
    canvas.toBlob = (cb) => {
      order.push("toBlob");
      cb(new Blob(["png-bytes"], { type: "image/png" }));
    };

    const blob = await exportScreenshotPng(canvas, () => order.push("draw"));
    expect(order).toEqual(["draw", "toBlob"]);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
  });

  test("falls back to canvas.toDataURL when toBlob returns null", async () => {
    const canvas = document.createElement("canvas");
    canvas.toBlob = (cb) => cb(null);
    canvas.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";

    const blob = await exportScreenshotPng(canvas);
    expect(blob.type).toBe("image/png");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  });
});

describe("WebM timelapse export", () => {
  const origMediaRecorder = globalThis.MediaRecorder;

  afterEach(() => {
    globalThis.MediaRecorder = origMediaRecorder;
  });

  test("steps through sampled frames and records WebM stream", async () => {
    const seeked: number[] = [];
    const requestedFrames: number[] = [];
    const stoppedTracks: number[] = [];

    const canvas = document.createElement("canvas") as HTMLCanvasElement & {
      captureStream: () => MediaStream;
    };
    canvas.captureStream = () =>
      ({
        getVideoTracks: () => [{ requestFrame: () => requestedFrames.push(1) }],
        getTracks: () => [{ stop: () => stoppedTracks.push(1) }],
      }) as unknown as MediaStream;

    class FakeMediaRecorder {
      static isTypeSupported(mime: string) {
        return mime === "video/webm";
      }
      state = "inactive";
      mimeType = "video/webm";
      private listeners = new Map<string, ((e: any) => void)[]>();
      addEventListener(type: string, cb: (e: any) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        for (const cb of this.listeners.get("dataavailable") ?? []) {
          cb({ data: new Blob(["webm-chunk"], { type: "video/webm" }) });
        }
        for (const cb of this.listeners.get("stop") ?? []) {
          cb({});
        }
      }
    }
    globalThis.MediaRecorder =
      FakeMediaRecorder as unknown as typeof MediaRecorder;

    const blob = await exportTimelapseWebm({
      canvas,
      totalFrames: 20,
      maxFrames: 4,
      frameDelayMs: 0,
      seekAndDraw: async (f) => {
        seeked.push(f);
      },
    });

    expect(seeked).toEqual([0, 6, 13, 19]);
    expect(requestedFrames).toHaveLength(4);
    expect(stoppedTracks).toHaveLength(1);
    expect(blob.type).toBe("video/webm");
    expect(blob.size).toBeGreaterThan(0);
  });

  test("records every frame for full video export", async () => {
    const seeked: number[] = [];
    const canvas = document.createElement("canvas") as HTMLCanvasElement & {
      captureStream: () => MediaStream;
    };
    canvas.captureStream = () =>
      ({
        getVideoTracks: () => [{ requestFrame: () => {} }],
        getTracks: () => [{ stop: () => {} }],
      }) as unknown as MediaStream;

    class FakeMp4Recorder {
      static isTypeSupported(mime: string) {
        return mime.includes("mp4");
      }
      state = "inactive";
      mimeType = "video/mp4";
      private listeners = new Map<string, ((e: any) => void)[]>();
      addEventListener(type: string, cb: (e: any) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        for (const cb of this.listeners.get("dataavailable") ?? []) {
          cb({ data: new Blob(["mp4-data"], { type: "video/mp4" }) });
        }
        for (const cb of this.listeners.get("stop") ?? []) {
          cb({});
        }
      }
    }
    globalThis.MediaRecorder =
      FakeMp4Recorder as unknown as typeof MediaRecorder;

    const res = await exportVideo({
      canvas,
      totalFrames: 5,
      maxFrames: null,
      frameDelayMs: 0,
      preferredFormat: "mp4",
      seekAndDraw: async (f) => {
        seeked.push(f);
      },
    });

    expect(seeked).toEqual([0, 1, 2, 3, 4]);
    expect(res.ext).toBe("mp4");
    expect(res.blob.type).toBe("video/mp4");
  });

  test("aborts video recording early when AbortSignal triggers", async () => {
    const seeked: number[] = [];
    const canvas = document.createElement("canvas") as HTMLCanvasElement & {
      captureStream: () => MediaStream;
    };
    canvas.captureStream = () =>
      ({
        getVideoTracks: () => [{ requestFrame: () => {} }],
        getTracks: () => [{ stop: () => {} }],
      }) as unknown as MediaStream;

    class FakeAbortRecorder {
      static isTypeSupported(mime: string) {
        return mime.includes("webm") || mime.includes("mp4");
      }
      state = "inactive";
      mimeType = "video/webm";
      private listeners = new Map<string, ((e: any) => void)[]>();
      addEventListener(type: string, cb: (e: any) => void) {
        const list = this.listeners.get(type) ?? [];
        list.push(cb);
        this.listeners.set(type, list);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        for (const cb of this.listeners.get("dataavailable") ?? []) {
          cb({ data: new Blob(["chunk"], { type: "video/webm" }) });
        }
        for (const cb of this.listeners.get("stop") ?? []) {
          cb({});
        }
      }
    }
    globalThis.MediaRecorder =
      FakeAbortRecorder as unknown as typeof MediaRecorder;

    const controller = new AbortController();
    await exportVideo({
      canvas,
      totalFrames: 10,
      maxFrames: null,
      frameDelayMs: 0,
      signal: controller.signal,
      seekAndDraw: async (f) => {
        seeked.push(f);
        if (f === 2) controller.abort();
      },
    });

    expect(seeked).toEqual([0, 1, 2]);
  });

  test("stops recording and rejects if seekAndDraw throws", async () => {
    const canvas = document.createElement("canvas") as HTMLCanvasElement & {
      captureStream: () => MediaStream;
    };
    let stoppedTracks = 0;
    canvas.captureStream = () =>
      ({
        getVideoTracks: () => [{ requestFrame: () => {} }],
        getTracks: () => [{ stop: () => stoppedTracks++ }],
      }) as unknown as MediaStream;

    class FakeErrorRecorder {
      static isTypeSupported() {
        return true;
      }
      state = "inactive";
      mimeType = "video/webm";
      addEventListener() {}
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
      }
    }
    globalThis.MediaRecorder =
      FakeErrorRecorder as unknown as typeof MediaRecorder;

    await expect(
      exportVideo({
        canvas,
        totalFrames: 10,
        frameDelayMs: 0,
        seekAndDraw: async (f) => {
          if (f === 1) throw new Error("failed to seek to frame 1");
        },
      }),
    ).rejects.toThrow("failed to seek to frame 1");

    expect(stoppedTracks).toBeGreaterThan(0);
  });
});

describe("Animated GIF89a timelapse export", () => {
  test("encodeGif89a produces a valid GIF89a binary with loop extension and trailer", () => {
    const palette = new Uint8Array(256 * 3);
    const f1 = new Uint8Array([0, 1, 1, 0, 2, 3]);
    const f2 = new Uint8Array([1, 1, 4, 4, 2, 3]);
    const bytes = encodeGif89a([f1, f2], 3, 2, palette, 10);

    // Header "GIF89a"
    const header = String.fromCharCode(...bytes.subarray(0, 6));
    expect(header).toBe("GIF89a");
    // Width = 3, Height = 2 (little endian)
    expect(bytes[6] | (bytes[7] << 8)).toBe(3);
    expect(bytes[8] | (bytes[9] << 8)).toBe(2);
    // Trailer 0x3b
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });

  test("exportReplayGif renders replay frames into an image/gif Blob", async () => {
    const { replay, terrain } = await buildSampleReplay(15, 5);
    const blob = await exportReplayGif(replay, inflate, terrain, {
      maxFrames: 5,
      maxDimension: 16,
      delayCs: 6,
    });
    expect(blob.type).toBe("image/gif");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);
  });
});

describe("Replay archive JSON export & round-trip", () => {
  test("serializes and deserializes ReplayData losslessly", async () => {
    const { replay } = await buildSampleReplay(18, 8);
    const jsonBlob = await exportReplayJson("game1234", replay, gzip);
    expect(jsonBlob.type).toContain("application/json");

    const text = await jsonBlob.text();
    const restored = await deserializeReplayArchive(text, inflate);
    expect(restored.gameID).toBe("game1234");

    const origReader = openReader(replay);
    const restoredReader = openReader(restored.data);
    expect(restoredReader.header.totalFrames).toBe(
      origReader.header.totalFrames,
    );
    expect(restoredReader.header.players).toEqual(origReader.header.players);

    const fOrig = origReader.seek(14);
    const fRestored = restoredReader.seek(14);
    expect(fRestored.tick).toBe(fOrig.tick);
    expect(fRestored.tileState).toEqual(fOrig.tileState);
    expect([...fRestored.players.entries()]).toEqual([
      ...fOrig.players.entries(),
    ]);
  });

  test("serializeReplayArchive includes metadata and chunk counts", async () => {
    const { replay } = await buildSampleReplay(12, 5);
    const archive = await serializeReplayArchive("matchXYZ", replay, gzip);
    expect(archive.format).toBe("openfront-replay");
    expect(archive.gameID).toBe("matchXYZ");
    expect(archive.totalFrames).toBe(12);
    expect(archive.chunks.length).toBeGreaterThanOrEqual(2);
  });

  test("deserializeReplayArchive rejects archives with invalid format or unsupported version", async () => {
    await expect(
      deserializeReplayArchive({ format: "invalid" } as any, inflate),
    ).rejects.toThrow("invalid replay archive format");

    await expect(
      deserializeReplayArchive(
        { format: "openfront-replay", version: 9999 } as any,
        inflate,
      ),
    ).rejects.toThrow("unsupported replay archive version");
  });
});

describe("Match telemetry CSV export", () => {
  test("builds RFC-4180 CSV with player stats and active unit counts", async () => {
    const { replay } = await buildSampleReplay(20, 10);
    const csv = await buildMatchStatsCsv(replay, inflate, { frameStep: 10 });
    const lines = csv.trim().split("\n");

    expect(lines[0]).toBe(
      "tick,frame,player_id,small_id,name,type,team,is_alive,tiles_owned,troops,gold,gold_earned,trade_gold,train_gold,piracy_gold,betrayals,units_count",
    );
    // Sampled frames: 0, 10, 19 -> 2 players each = 6 data rows + 1 header = 7 lines
    expect(lines).toHaveLength(7);
    // Alice's name has comma and quotes -> properly CSV-quoted
    expect(lines[1]).toContain('"Alice, ""The Great"""');
    // Frame 0 (tick 1): Alice has 2 active units (City + Port)
    expect(lines[1].endsWith(",2")).toBe(true);
    // Frame 19 (tick 20, after tick 15 update): Port deactivated -> Alice has 1 active unit, BobBot isAlive = false
    const lastAlice = lines[5];
    const lastBob = lines[6];
    expect(lastAlice.endsWith(",1")).toBe(true);
    expect(lastBob).toContain(",false,0,0,");

    const blob = await exportMatchStatsCsv(replay, inflate, { frameStep: 10 });
    expect(blob.type).toContain("text/csv");
  });

  test("neutralizes formula injection characters in string cells without altering numbers or booleans", async () => {
    const { replay } = await buildSampleReplay(5, 5);
    const untrustedPlayers: PlayerStatic[] = [
      {
        id: "p1",
        smallID: 1,
        name: "=SUM(1+1)",
        displayName: "=SUM(1+1)",
        clientID: "c1",
        playerType: PlayerTypeEnum.Human,
        team: null,
        clanTag: null,
        isLobbyCreator: false,
      },
      {
        id: "p2",
        smallID: 2,
        name: "@dangerous",
        displayName: "-negative_name",
        clientID: "c2",
        playerType: PlayerTypeEnum.Human,
        team: null,
        clanTag: null,
        isLobbyCreator: false,
      },
    ];
    const csv = await buildMatchStatsCsv(replay, inflate, {
      frameStep: 10,
      players: untrustedPlayers,
    });
    // Formula-starting strings must be prefixed with a single quote
    expect(csv).toContain(",'=SUM(1+1),");
    expect(csv).toContain(",'-negative_name,");
    // Boolean and numbers must not have single quotes added
    expect(csv).toContain(",true,12,1500,250,");
    expect(csv).toContain(",true,8,800,100,");
  });
});

describe("<replay-controls> export menu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("disables controls and ignores seek and play inputs while exporting is true", async () => {
    const el = new ReplayControls();
    el.frame = 5;
    el.loaded = 100;
    el.total = 100;
    el.exporting = true;
    document.body.appendChild(el);
    await el.updateComplete;

    const timeline = el.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(timeline.disabled).toBe(true);

    const buttons = [...el.querySelectorAll("button")];
    const playBtn = buttons[0];
    const speedBtn = buttons[1];
    expect(playBtn.disabled).toBe(true);
    expect(speedBtn.disabled).toBe(true);

    let emitted = false;
    el.addEventListener("replay-toggle-play", () => (emitted = true));
    el.addEventListener("replay-seek", () => (emitted = true));
    el.addEventListener("replay-speed", () => (emitted = true));

    timeline.value = "10";
    timeline.dispatchEvent(new Event("input"));
    playBtn.click();
    speedBtn.click();

    expect(emitted).toBe(false);
  });

  test("toggles export menu and emits replay-export with chosen format", async () => {
    const el = new ReplayControls();
    el.frame = 5;
    el.tick = 50;
    el.loaded = 100;
    el.total = 100;
    document.body.appendChild(el);
    await el.updateComplete;

    const received: ReplayExportFormat[] = [];
    el.addEventListener("replay-export", (e) => {
      received.push((e as CustomEvent<ReplayExportFormat>).detail);
    });

    // Find export button by its icon src
    const buttons = [...el.querySelectorAll("button")];
    const exportBtn = buttons.find((b) =>
      b.querySelector("img")?.getAttribute("src")?.includes("ExportIconWhite"),
    );
    expect(exportBtn).toBeDefined();

    // Open export menu
    exportBtn!.click();
    await el.updateComplete;

    const formatButtons = [
      ...el.querySelectorAll<HTMLButtonElement>("[data-export-format]"),
    ];
    expect(formatButtons.map((b) => b.dataset.exportFormat)).toEqual([
      ...EXPORT_FORMATS,
    ]);

    // Click GIF export option
    const gifBtn = el.querySelector<HTMLButtonElement>(
      '[data-export-format="gif"]',
    )!;
    gifBtn.click();
    await el.updateComplete;

    expect(received).toEqual(["gif"]);
    // Menu closes after selecting a format
    expect(el.querySelector("[data-export-format]")).toBeNull();
  });
});
