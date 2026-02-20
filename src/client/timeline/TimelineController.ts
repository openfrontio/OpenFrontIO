import { EventBus } from "../../core/EventBus";
import {
  GameUpdateType,
  GameUpdateViewData,
} from "../../core/game/GameUpdates";
import { GameView } from "../../core/game/GameView";
import { WorkerClient } from "../../core/worker/WorkerClient";
import { GameRenderer } from "../graphics/GameRenderer";
import { ReplaySpeedChangeEvent } from "../InputHandler";
import { defaultReplaySpeedMultiplier } from "../utilities/ReplaySpeedMultiplier";
import { TimelineArchive } from "./TimelineArchive";
import {
  TimelineGoLiveEvent,
  TimelineJumpEvent,
  TimelineModeChangedEvent,
  TimelineRangeEvent,
  TimelineRangeRequestEvent,
  TimelineSeekEvent,
} from "./TimelineEvents";
import { TimelineCheckpointRecord, TimelineTickRecord } from "./types";

const CHECKPOINT_EVERY_TICKS = 300;

export class TimelineController {
  private readonly archive = new TimelineArchive();
  private isLive = true;
  private isSeeking = false;
  private liveTick = 0;
  private displayTick = 0;
  private isPaused = false;
  private replaySpeedMultiplier = defaultReplaySpeedMultiplier;
  private playbackTimer: number | null = null;
  private syncingUntilTick: number | null = null;

  private pendingSeekTick: number | null = null;
  private seekScheduled = false;
  private seekToken = 0;

  private rewindCheckpointSnapshotInFlight = false;
  private rewindCheckpointSnapshotQueued = false;

  constructor(
    private worker: WorkerClient,
    private readonly gameView: GameView,
    private readonly renderer: GameRenderer,
    private readonly eventBus: EventBus,
  ) {
    this.eventBus.on(TimelineSeekEvent, (e) => this.requestSeek(e.targetTick));
    this.eventBus.on(TimelineGoLiveEvent, () => void this.goLive());
    this.eventBus.on(TimelineRangeRequestEvent, () => this.emitRange());
    this.eventBus.on(ReplaySpeedChangeEvent, (e) => {
      this.replaySpeedMultiplier = e.replaySpeedMultiplier;
      this.maybeSchedulePlayback();
    });
  }

  getDisplayTick(): number {
    return this.displayTick;
  }

  replaceWorker(worker: WorkerClient): void {
    this.worker = worker;
  }

  async beginRewriteAtTick(targetTick: number): Promise<void> {
    const clamped = Math.max(0, Math.min(targetTick, this.liveTick));

    // Cancel any in-flight seeks / replays.
    this.seekToken++;
    this.pendingSeekTick = null;
    this.syncingUntilTick = clamped;

    this.clearPlaybackTimer();
    this.setLive(false);
    this.isSeeking = true;

    // This becomes the new "present" for this timeline branch.
    this.liveTick = clamped;
    this.displayTick = clamped;
    this.emitRange();

    // Persist a checkpoint at the rewrite point, then drop everything after it.
    try {
      const cp = this.gameView.exportCheckpoint();
      this.archive.putCheckpoint({
        tick: cp.tick,
        mapStateBuffer: cp.mapState.buffer,
        numTilesWithFallout: cp.numTilesWithFallout,
        players: cp.players,
        units: cp.units,
        playerNameViewData: cp.playerNameViewData,
        toDeleteUnitIds: cp.toDeleteUnitIds,
        railroads: cp.railroads,
      });
    } catch {
      // ignore
    }

    await this.archive.truncateAfterTick(clamped);

    // Mop up any stale writes that were in-flight right before truncation.
    window.setTimeout(() => void this.archive.truncateAfterTick(clamped), 1000);

    this.emitRange();
  }

  async initialize(): Promise<void> {
    await this.archive.open();

    // Create a base checkpoint (usually tick 0) so rewind has a stable origin.
    try {
      const snapshot = await this.worker.snapshot();
      this.liveTick = snapshot.tick;
      this.displayTick = snapshot.tick;
      this.archive.putCheckpoint({
        tick: snapshot.tick,
        mapStateBuffer: snapshot.mapState.buffer,
        numTilesWithFallout: snapshot.numTilesWithFallout,
        players: snapshot.players,
        units: snapshot.units,
        playerNameViewData: snapshot.playerNameViewData,
        toDeleteUnitIds: snapshot.toDeleteUnitIds,
        railroads: snapshot.railroads,
      });

      this.gameView.importWorkerSnapshot(snapshot);
      this.renderer.redraw();
    } catch (e) {
      // If snapshot fails we can still function once we start receiving ticks.
      console.warn("Timeline init snapshot failed:", e);
    }

    this.emitRange();
  }

  onWorkerUpdate(gu: GameUpdateViewData): void {
    this.liveTick = Math.max(this.liveTick, gu.tick);

    const pauseUpdate = gu.updates?.[GameUpdateType.GamePaused]?.[0];
    if (pauseUpdate) {
      this.isPaused = pauseUpdate.paused;
    }

    const packedTileUpdatesBuffer =
      gu.packedTileUpdates.byteOffset === 0 &&
      gu.packedTileUpdates.byteLength === gu.packedTileUpdates.buffer.byteLength
        ? gu.packedTileUpdates.buffer
        : gu.packedTileUpdates.buffer.slice(
            gu.packedTileUpdates.byteOffset,
            gu.packedTileUpdates.byteOffset + gu.packedTileUpdates.byteLength,
          );

    const tickRecord: TimelineTickRecord = {
      tick: gu.tick,
      packedTileUpdatesBuffer,
      updates: gu.updates,
      playerNameViewData: gu.playerNameViewData,
    };
    this.archive.putTickRecord(tickRecord);

    if (this.syncingUntilTick !== null) {
      // During history rewrite we keep recording ticks, but avoid mutating the
      // displayed GameView until the new worker has reached the rewrite point.
      if (gu.tick >= this.syncingUntilTick) {
        this.syncingUntilTick = null;
        void this.goLive();
      }
      return;
    }

    if (this.isLive) {
      const before = this.displayTick;
      this.displayTick = gu.tick;

      this.gameView.update(gu);

      if (gu.tick % CHECKPOINT_EVERY_TICKS === 0) {
        const cp = this.gameView.exportCheckpoint();
        const cpRecord: TimelineCheckpointRecord = {
          tick: cp.tick,
          mapStateBuffer: cp.mapState.buffer,
          numTilesWithFallout: cp.numTilesWithFallout,
          players: cp.players,
          units: cp.units,
          playerNameViewData: cp.playerNameViewData,
          toDeleteUnitIds: cp.toDeleteUnitIds,
          railroads: cp.railroads,
        };
        this.archive.putCheckpoint(cpRecord);
      }

      // Normal live tick: let layers consume the delta for this tick.
      this.renderer.tick();
      this.emitRange();

      // Keep internal caches stable across big jumps (e.g., after snapshot init).
      if (gu.tick - before > 5) {
        this.renderer.redraw();
      }
    } else {
      // Rewinding: do not mutate view state, only extend timeline range.
      this.emitRange();

      // Still store checkpoints via worker snapshots so forward scrubs stay fast.
      if (gu.tick % CHECKPOINT_EVERY_TICKS === 0) {
        this.requestRewindCheckpointSnapshot();
      }

      this.maybeSchedulePlayback();
    }
  }

  private requestRewindCheckpointSnapshot(): void {
    this.rewindCheckpointSnapshotQueued = true;
    if (this.rewindCheckpointSnapshotInFlight) return;

    this.rewindCheckpointSnapshotInFlight = true;
    this.rewindCheckpointSnapshotQueued = false;

    void this.worker
      .snapshot()
      .then((snapshot) => {
        this.archive.putCheckpoint({
          tick: snapshot.tick,
          mapStateBuffer: snapshot.mapState.buffer,
          numTilesWithFallout: snapshot.numTilesWithFallout,
          players: snapshot.players,
          units: snapshot.units,
          playerNameViewData: snapshot.playerNameViewData,
          toDeleteUnitIds: snapshot.toDeleteUnitIds,
          railroads: snapshot.railroads,
        });
      })
      .catch(() => {
        // ignore; archive.storageError will be surfaced if persistent
      })
      .finally(() => {
        this.rewindCheckpointSnapshotInFlight = false;
        if (this.rewindCheckpointSnapshotQueued) {
          this.requestRewindCheckpointSnapshot();
        }
      });
  }

  private requestSeek(targetTick: number): void {
    this.pendingSeekTick = targetTick;
    if (this.isSeeking) return;
    if (this.seekScheduled) return;
    this.seekScheduled = true;
    requestAnimationFrame(() => {
      this.seekScheduled = false;
      const t = this.pendingSeekTick;
      this.pendingSeekTick = null;
      if (t === null) return;
      void this.seekTo(t);
    });
  }

  private setLive(isLive: boolean): void {
    if (this.isLive === isLive) return;
    this.isLive = isLive;
    this.eventBus.emit(new TimelineModeChangedEvent(isLive));
    if (isLive) {
      this.clearPlaybackTimer();
    } else {
      this.maybeSchedulePlayback();
    }
  }

  private emitRange(): void {
    this.eventBus.emit(
      new TimelineRangeEvent(
        this.liveTick,
        this.displayTick,
        this.isLive,
        this.isSeeking,
        this.archive.storageError,
      ),
    );
  }

  private async seekTo(targetTick: number): Promise<void> {
    const clamped = Math.max(0, Math.min(targetTick, this.liveTick));

    if (clamped === this.liveTick) {
      await this.goLive();
      return;
    }

    const token = ++this.seekToken;
    const fromTick = this.displayTick;
    this.setLive(false);
    this.isSeeking = true;
    this.emitRange();

    const checkpoint =
      (await this.archive.getCheckpointAtOrBefore(clamped)) ?? null;
    if (token !== this.seekToken) return;
    if (!checkpoint) {
      this.isSeeking = false;
      this.emitRange();
      return;
    }

    this.gameView.importCheckpoint({
      tick: checkpoint.tick,
      mapState: new Uint16Array(checkpoint.mapStateBuffer),
      numTilesWithFallout: checkpoint.numTilesWithFallout,
      players: checkpoint.players,
      units: checkpoint.units,
      playerNameViewData: checkpoint.playerNameViewData,
      toDeleteUnitIds: checkpoint.toDeleteUnitIds,
      railroads: checkpoint.railroads,
    });

    const tickRecords = await this.archive.getTickRecordsRange(
      checkpoint.tick + 1,
      clamped,
    );
    if (token !== this.seekToken) return;

    for (const rec of tickRecords) {
      if (token !== this.seekToken) return;
      this.gameView.update({
        tick: rec.tick,
        packedTileUpdates: new BigUint64Array(rec.packedTileUpdatesBuffer),
        updates: rec.updates,
        playerNameViewData: rec.playerNameViewData,
      });
    }

    this.displayTick = clamped;
    this.isSeeking = false;
    this.eventBus.emit(new TimelineJumpEvent(fromTick, clamped));
    this.renderer.redraw();
    this.renderer.tick();
    this.emitRange();
    this.maybeSchedulePlayback();

    if (this.pendingSeekTick !== null) {
      const next = this.pendingSeekTick;
      this.pendingSeekTick = null;
      this.requestSeek(next);
    }
  }

  private async goLive(): Promise<void> {
    const token = ++this.seekToken;
    const fromTick = this.displayTick;
    this.isSeeking = true;
    this.emitRange();

    try {
      const snapshot = await this.worker.snapshot();
      if (token !== this.seekToken) return;

      this.gameView.importWorkerSnapshot(snapshot);
      this.liveTick = Math.max(this.liveTick, snapshot.tick);
      this.displayTick = snapshot.tick;
      this.setLive(true);
      this.isSeeking = false;
      this.eventBus.emit(new TimelineJumpEvent(fromTick, snapshot.tick));
      this.renderer.redraw();
      this.renderer.tick();
      this.emitRange();
    } catch (e) {
      console.warn("Failed to go live via snapshot:", e);
      this.isSeeking = false;
      this.emitRange();
    }

    this.maybeSchedulePlayback();

    if (this.pendingSeekTick !== null) {
      const next = this.pendingSeekTick;
      this.pendingSeekTick = null;
      this.requestSeek(next);
    }
  }

  private clearPlaybackTimer(): void {
    if (this.playbackTimer === null) return;
    window.clearTimeout(this.playbackTimer);
    this.playbackTimer = null;
  }

  private maybeSchedulePlayback(): void {
    if (this.isLive) {
      this.clearPlaybackTimer();
      return;
    }
    if (this.isSeeking) return;
    if (this.syncingUntilTick !== null) return;
    if (this.pendingSeekTick !== null) return;
    if (this.isPaused) return;
    if (this.playbackTimer !== null) return;

    const baseMs = this.gameView.config().serverConfig().turnIntervalMs();
    const intervalMs = baseMs * this.replaySpeedMultiplier;

    if (intervalMs <= 0) {
      // "Fastest": step a few ticks per frame-like cadence without blocking.
      this.playbackTimer = window.setTimeout(() => {
        this.playbackTimer = null;
        void this.playbackFastStep();
      }, 0);
      return;
    }

    this.playbackTimer = window.setTimeout(() => {
      this.playbackTimer = null;
      void this.playbackSingleStep();
    }, intervalMs);
  }

  private async playbackSingleStep(): Promise<void> {
    if (this.isLive || this.isSeeking || this.isPaused) return;

    if (this.displayTick >= this.liveTick) {
      await this.goLive();
      return;
    }

    const nextTick = this.displayTick + 1;
    const rec = await this.archive.getTickRecord(nextTick);
    if (!rec) {
      // Tick record not available yet (worker still processing / IDB lag).
      this.maybeSchedulePlayback();
      return;
    }

    this.gameView.update({
      tick: rec.tick,
      packedTileUpdates: new BigUint64Array(rec.packedTileUpdatesBuffer),
      updates: rec.updates,
      playerNameViewData: rec.playerNameViewData,
    });
    this.displayTick = rec.tick;
    this.renderer.tick();
    this.emitRange();
    this.maybeSchedulePlayback();
  }

  private async playbackFastStep(): Promise<void> {
    if (this.isLive || this.isSeeking || this.isPaused) return;

    if (this.displayTick >= this.liveTick) {
      await this.goLive();
      return;
    }

    const start = performance.now();
    let steps = 0;
    while (
      steps < 10 &&
      this.displayTick < this.liveTick &&
      performance.now() - start < 8
    ) {
      const nextTick = this.displayTick + 1;
      const rec = await this.archive.getTickRecord(nextTick);
      if (!rec) break;
      this.gameView.update({
        tick: rec.tick,
        packedTileUpdates: new BigUint64Array(rec.packedTileUpdatesBuffer),
        updates: rec.updates,
        playerNameViewData: rec.playerNameViewData,
      });
      this.displayTick = rec.tick;
      steps++;
    }

    if (steps > 0) {
      this.renderer.tick();
      this.emitRange();
    }

    this.maybeSchedulePlayback();
  }
}
