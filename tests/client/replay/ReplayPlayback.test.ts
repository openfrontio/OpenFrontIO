import { gunzip as gunzipCb } from "zlib";
import {
  ReplayPlayback,
  STEP_LIMIT,
} from "../../../src/client/replay/ReplayPlayback";
import { GameType } from "../../../src/core/game/Game";
import { setup } from "../../util/Setup";
import { openReader, recordGame, type RecordedGame } from "./util/RecordGame";

const gunzip = (d: Uint8Array) =>
  new Promise<Uint8Array>((resolve, reject) =>
    gunzipCb(d, (err, out) =>
      err ? reject(err) : resolve(new Uint8Array(out)),
    ),
  );
const RULES = { allianceDuration: 100, doomsdayClockWarnTicks: 150 };

describe("ReplayPlayback", () => {
  let rec: RecordedGame;
  let playback: ReplayPlayback;
  let delivered: { frame: number; tick: number; seeked: boolean }[];

  beforeAll(async () => {
    const game = await setup(
      "big_plains",
      { bots: 10, gameType: GameType.Singleplayer },
      [],
      undefined,
      undefined,
      false,
    );
    rec = await recordGame(game, {
      ticks: 150,
      keyframeInterval: 25,
      splitAfter: 75,
      beforeTick: (g, t) => {
        if (t === 5) g.endSpawnPhase();
      },
    });
  }, 60_000);

  beforeEach(async () => {
    playback = await ReplayPlayback.open(rec.replay, gunzip, RULES);
    delivered = [];
    playback.onFrame = (fd, seeked) =>
      delivered.push({
        frame: playback.frame,
        tick: fd.tick,
        seeked,
      });
    playback.onError = (err) => {
      throw err;
    };
  });

  /** Tick of each frame, from the synchronous reader. */
  const tickOf = (frame: number) => openReader(rec.replay).seek(frame).tick;

  test("opens on nothing; the first seek delivers a full frame", async () => {
    expect(playback.frame).toBe(-1);
    expect(playback.totalFrames).toBe(150);
    await playback.seek(0);
    expect(delivered).toEqual([{ frame: 0, tick: tickOf(0), seeked: true }]);
  });

  test("a replay whose first frame won't decode fails to open", async () => {
    const [first, ...rest] = rec.replay.append.chunks;
    const broken = first.compressed.slice();
    broken.fill(0, 10, 40);
    const bad = {
      ...rec.replay,
      append: {
        ...rec.replay.append,
        chunks: [{ ...first, compressed: broken }, ...rest],
      },
    };
    await expect(ReplayPlayback.open(bad, gunzip, RULES)).rejects.toThrow();
  });

  test("plays frame by frame at 10 ticks/s times the speed", async () => {
    await playback.seek(0);
    delivered = [];
    playback.setSpeed(2);
    playback.play();
    playback.tick(1000); // starts the clock
    playback.tick(1500); // 0.5 s at 2x → 10 frames
    await vi.waitFor(() => expect(playback.frame).toBe(10));
    expect(delivered.map((d) => d.frame)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(delivered.every((d) => !d.seeked)).toBe(true);
    expect(delivered.map((d) => d.tick)).toEqual(
      delivered.map((d) => tickOf(d.frame)),
    );
  });

  test("playing into the next chunk sends only the tiles that changed", async () => {
    await playback.seek(20);
    const changed: (readonly number[] | null)[] = [];
    playback.onFrame = (fd) => changed.push(fd.changedTiles);
    await playback.seek(27); // 21 … 27, and 25 starts a chunk
    expect(changed).toHaveLength(7);
    // null would mean a full re-upload of the map.
    expect(changed.every((c) => c !== null)).toBe(true);
  });

  test("a big jump seeks; a small one plays through", async () => {
    await playback.seek(0);
    delivered = [];
    await playback.seek(STEP_LIMIT);
    expect(delivered).toHaveLength(STEP_LIMIT);
    expect(delivered[delivered.length - 1]).toMatchObject({
      frame: STEP_LIMIT,
      seeked: false,
    });

    delivered = [];
    await playback.seek(STEP_LIMIT * 2 + 1);
    expect(delivered).toEqual([
      {
        frame: STEP_LIMIT * 2 + 1,
        tick: tickOf(STEP_LIMIT * 2 + 1),
        seeked: true,
      },
    ]);

    delivered = [];
    await playback.seek(3); // backwards
    expect(delivered).toEqual([{ frame: 3, tick: tickOf(3), seeked: true }]);
  });

  test("only the latest of rapid seeks has to land", async () => {
    void playback.seek(120);
    void playback.seek(10);
    await playback.seek(77);
    expect(playback.frame).toBe(77);
    expect(delivered[delivered.length - 1]).toEqual({
      frame: 77,
      tick: tickOf(77),
      seeked: true,
    });
    expect(delivered.length).toBeLessThanOrEqual(3);
  });

  test("stops at the last frame, and play starts over", async () => {
    await playback.seek(145);
    playback.play();
    playback.tick(0);
    playback.tick(1000); // 10 frames wanted, 4 left
    await vi.waitFor(() => expect(playback.frame).toBe(149));
    expect(playback.playing).toBe(false);

    playback.play();
    await vi.waitFor(() => expect(playback.frame).toBe(0));
  });

  test("a hidden tab's long gap is capped at one second", async () => {
    await playback.seek(0);
    playback.play();
    playback.tick(0);
    playback.tick(60_000);
    await vi.waitFor(() => expect(playback.frame).toBe(10));
  });

  test("a device that can't keep up plays slower instead of seeking", async () => {
    await playback.seek(0);
    delivered = [];
    playback.setSpeed(32);
    playback.play();
    playback.tick(0);
    playback.tick(1000); // 320 frames wanted
    await vi.waitFor(() => expect(playback.frame).toBe(STEP_LIMIT));
    playback.tick(2000);
    await vi.waitFor(() => expect(playback.frame).toBe(STEP_LIMIT * 2));
    expect(delivered.map((d) => d.frame)).toEqual(
      Array.from({ length: STEP_LIMIT * 2 }, (_, i) => i + 1),
    );
    expect(delivered.every((d) => !d.seeked)).toBe(true);
  });

  test("playing doesn't pull back a seek that's still loading", async () => {
    await playback.seek(0);
    playback.play();
    playback.tick(0);
    const seeked = playback.seek(120);
    playback.tick(100);
    await seeked;
    expect(playback.frame).toBe(120);
  });

  test("refresh delivers the current frame again, as a seek", async () => {
    await playback.seek(40);
    delivered = [];
    await playback.refresh();
    expect(delivered).toEqual([{ frame: 40, tick: tickOf(40), seeked: true }]);
  });

  test("a failure says whether the replay or the renderer broke", async () => {
    const errors: boolean[] = [];
    playback.onError = (_err, inReplay) => errors.push(inReplay);
    playback.onFrame = () => {
      throw new Error("context lost");
    };
    await playback.seek(0);
    expect(errors).toEqual([false]);

    const broken = await ReplayPlayback.open(rec.replay, gunzip, RULES);
    broken.onError = (_err, inReplay) => errors.push(inReplay);
    vi.spyOn(
      (broken as unknown as { reader: { seek(f: number): unknown } }).reader,
      "seek",
    ).mockImplementation(() => {
      throw new Error("corrupt chunk");
    });
    await broken.seek(10);
    expect(errors).toEqual([false, true]);
  });

  test("a chunk that fails to load ahead stops playback", async () => {
    const errors: boolean[] = [];
    playback.onError = (_err, inReplay) => errors.push(inReplay);
    await playback.seek(0);
    const reader = (
      playback as unknown as { reader: { load(i: number): Promise<void> } }
    ).reader;
    vi.spyOn(reader, "load").mockImplementation((i) =>
      i === 0 ? Promise.resolve() : Promise.reject(new Error("bad gzip")),
    );
    playback.play();
    playback.tick(0);
    playback.tick(100);
    await vi.waitFor(() => expect(errors).toEqual([true]));
    expect(playback.playing).toBe(false);
    // Stopped for good: no more frames, and the error isn't repeated.
    delivered = [];
    await playback.seek(10);
    expect(delivered).toEqual([]);
    expect(errors).toEqual([true]);
  });

  test("clamps seeks to the replay", async () => {
    await playback.seek(-5);
    expect(playback.frame).toBe(0);
    await playback.seek(10_000);
    expect(playback.frame).toBe(149);
  });

  test("picks up more of a game that is still being processed", async () => {
    // What the viewer holds while the processor works: the frames so far.
    const live = await ReplayPlayback.open(
      { base: rec.base, append: rec.first! },
      gunzip,
      RULES,
    );
    const seen: number[] = [];
    live.onFrame = (_fd, _seeked, source) => seen.push(source.frame);
    expect(live.totalFrames).toBe(75);
    await live.seek(74);
    expect(live.frame).toBe(74);

    // The rest arrives: the position is kept and the timeline grows.
    live.append(rec.rest!);
    expect(live.totalFrames).toBe(150);
    expect(live.frame).toBe(74);
    // And it plays on from there.
    await live.seek(80);
    expect(live.frame).toBe(80);
    expect(seen[seen.length - 1]).toBe(80);
  }, 60_000);

  test("more frames are added without redrawing", async () => {
    const live = await ReplayPlayback.open(
      { base: rec.base, append: rec.first! },
      gunzip,
      RULES,
    );
    const seen: { frame: number; tick: number; seeked: boolean }[] = [];
    live.onFrame = (fd, seeked, source) =>
      seen.push({ frame: source.frame, tick: fd.tick, seeked });
    let positions = 0;
    live.onChange = () => {
      positions++;
      // The timeline never sees the position drop out.
      expect(live.frame).toBe(72);
    };
    await live.seek(72);
    seen.length = 0;
    positions = 0;

    live.append(rec.rest!);
    expect(seen).toEqual([]); // nothing redrawn
    expect(positions).toBe(1); // the timeline grew
    expect(live.totalFrames).toBe(150);
    expect(live.frame).toBe(72);

    // It plays on from the same place, frame by frame, as if nothing
    // happened - and matches what the whole file shows there.
    live.onChange = null;
    await live.seek(76);
    expect(seen.map((d) => [d.frame, d.seeked])).toEqual([
      [73, false],
      [74, false],
      [75, false],
      [76, false],
    ]);
    expect(seen.map((d) => d.tick)).toEqual([73, 74, 75, 76].map(tickOf));
  }, 60_000);

  test("live, it waits at the processed edge and plays on as more arrives", async () => {
    const live = await ReplayPlayback.open(
      { base: rec.base, append: rec.first! },
      gunzip,
      RULES,
    );
    live.live = true;
    await live.seek(70);
    live.play();
    live.tick(0);
    live.tick(1000); // 10 frames wanted, 4 processed
    await vi.waitFor(() => expect(live.frame).toBe(74));
    // Waiting, like a video buffering: still playing, and play doesn't
    // start over.
    live.tick(5000);
    expect(live.playing).toBe(true);
    live.play();
    expect(live.frame).toBe(74);

    live.append(rec.rest!);
    live.tick(5500); // 0.5 s → 5 frames; the wait isn't owed
    await vi.waitFor(() => expect(live.frame).toBe(79));

    // Finished: the end stops it again.
    live.live = false;
    await live.seek(148);
    live.tick(6500);
    await vi.waitFor(() => expect(live.frame).toBe(149));
    expect(live.playing).toBe(false);
  }, 60_000);
});
