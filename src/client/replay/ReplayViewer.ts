/**
 * <replay-viewer> plays a replay with the game's WebGL renderer and HUD,
 * with play/pause, speed and a timeline to seek.
 *
 * Main opens it for `#replay-viewer=<gameID>`. It plays the replay stored
 * in this browser if there is one, otherwise it processes the game record
 * here and plays it as it grows (LocalProcessing). A game from another
 * build is sent to that build's versioned shell.
 */

import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Config } from "../../core/configuration/Config";
import { EventBus } from "../../core/EventBus";
import { Cell, Difficulty, PlayerType } from "../../core/game/Game";
import { loadTerrainMap } from "../../core/game/TerrainMapLoader";
import {
  GRAPHICS_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import type { GameRecord, GameStartInfo } from "../../core/Schemas";
import { generateID } from "../../core/Util";
import { MapLayerController } from "../controllers/MapLayerController";
import { ViewModeController } from "../controllers/ViewModeController";
import "../hud/layers/EventsDisplay";
import type { EventsDisplay } from "../hud/layers/EventsDisplay";
import "../hud/layers/PlayerInfoOverlay";
import type { PlayerInfoOverlay } from "../hud/layers/PlayerInfoOverlay";
import "../hud/layers/PlayerStats";
import type { PlayerStats } from "../hud/layers/PlayerStats";
import "../hud/layers/SettingsModal";
import {
  ShowSettingsModalEvent,
  type SettingsModal,
} from "../hud/layers/SettingsModal";
import { MouseMoveEvent } from "../InputHandler";
import type { JoinLobbyEvent } from "../Main";
import { buildTerrainRowSpans } from "../render/frame/derive/TerrainRowSpans";
import { uploadFrameData } from "../render/frame/Upload";
import {
  applyGraphicsOverrides,
  createRenderSettings,
  GLUnavailableError,
  MapRenderer,
  preloadAtlasData,
  renderDpr,
  showGLGate,
} from "../render/gl";
import { deepAssign } from "../render/gl/SettingsUtils";
import {
  ALL_UNIT_TYPES,
  type NameEntry,
  type PlayerState,
  type PlayerStatusData,
} from "../render/types";
import { terrainMapFileLoader } from "../TerrainMapFileLoader";
import type { TransformHandler } from "../TransformHandler";
import { GoToPlayerEvent } from "../TransformHandler";
import { PauseGameIntentEvent } from "../Transport";
import { translateText } from "../Utils";
import { gunzipInBrowser } from "./BrowserGzip";
import type {
  ReplayAppend,
  ReplayBase,
  ReplayData,
  ReplayHeader,
} from "./codec/ReplayTypes";
import { terrainOf } from "./codec/Terrain";
import "./ContinueGameModal";
import type {
  ContinueGameModal,
  ContinuePlayerOption,
} from "./ContinueGameModal";
import {
  extractSnapshotInWorker,
  processInBrowser,
  type Processing,
} from "./LocalProcessing";
import { ReplayAppearance } from "./ReplayAppearance";
import { CameraGestures, ReplayCamera } from "./ReplayCamera";
import { formatGameTime, timelineFrames } from "./ReplayControls";
import { classicReplayHref, versionedViewerUrl } from "./ReplayEntry";
import { ReplayGameView } from "./ReplayGameAdapter";
import { ReplayNukedLayers } from "./ReplayNukedLayers";
import type { ReplayPalette } from "./ReplayPalette";
import { ReplayPlayback, TICKS_PER_SECOND } from "./ReplayPlayback";
import { fetchReplayRecord } from "./ReplayRecord";
import "./ReplayStatus";
import type { Preparing } from "./ReplayStatus";
import { replayStore } from "./ReplayStore";
import { ReplayTerrain } from "./ReplayTerrain";

const WHEEL_ZOOM = 1.0015;

/** Render settings with the viewer's graphics overrides applied. */
function renderSettings(userSettings: UserSettings) {
  const settings = createRenderSettings();
  applyGraphicsOverrides(settings, userSettings.graphicsOverrides());
  return settings;
}

/** The game's Config, and playback with the rules it sets. */
async function openPlayback(
  source: ReplayData,
  userSettings: UserSettings,
): Promise<{ config: Config; playback: ReplayPlayback }> {
  const gsi = source.base.gameStartInfo as GameStartInfo;
  const config = new Config(
    gsi.config,
    userSettings,
    /* isReplay */ true,
    /* listed */ false,
    /* spectator */ true,
  );
  const playback = await ReplayPlayback.open(source, gunzipInBrowser, {
    allianceDuration: config.allianceDuration(),
    doomsdayClockWarnTicks:
      config.doomsdayClockConfig().warnSeconds * TICKS_PER_SECOND,
  });
  return { config, playback };
}

/** The replay couldn't be opened at all (a stored one may be damaged). */
class UnreadableReplayError extends Error {
  constructor(readonly reason: unknown) {
    super("the replay could not be read");
  }
}

@customElement("replay-viewer")
export class ReplayViewer extends LitElement {
  @property() gameID = "";

  @state() private status: "loading" | "processing" | "ready" | "error" =
    "loading";
  @state() private error = "";
  /** Progress while the game is being prepared. */
  @state() private progress: Preparing = { phase: "fetching", percent: 0 };
  /** Whether to offer the old client-side replay. */
  @state() private classicFallback = false;
  /** True while the game is still being processed. */
  @state() private growing = false;
  /** Length of the whole game in frames, known before processing ends. */
  @state() private gameLength: number | null = null;
  /**
   * Why processing stopped after the replay started playing. What was
   * processed stays watchable, with this shown over it.
   */
  @state() private stoppedEarly = "";
  @state() private continueModalOpen = false;
  @state() private continuePlayers: ContinuePlayerOption[] = [];
  @state() private continueInitialPlayerID = "";
  private continueRequestCount = 0;
  private continueAbortController: AbortController | null = null;

  private record: GameRecord | null = null;
  /** The processing worker, while it runs. */
  private processing: Processing | null = null;
  /** The game being processed (the worker's first message). */
  private base: ReplayBase | null = null;
  /** The replay on screen came from this browser's store. */
  private fromStore = false;
  /** Worker results are applied one at a time, in order. */
  private applying: Promise<void> = Promise.resolve();
  /** What the HUD components read (ReplayGameAdapter). */
  private adapter: ReplayGameView | null = null;
  /** Draws players an append brought in. Set once the replay is open. */
  private addAppendedPlayers: (() => void) | null = null;
  private hudTimer: number | null = null;
  /** Sends pointer moves to the HUD (InputHandler does this in game). */
  private readonly hudBus = new EventBus();
  /** The player being followed (the event feed's "you"). */
  @state() private focusName = "";
  @state() private frame = 0;
  @state() private tick = 0;
  @state() private playing = false;
  @state() private speed = 1;
  private playback: ReplayPlayback | null = null;
  private view: MapRenderer | null = null;
  private camera: ReplayCamera | null = null;
  private gestures: CameraGestures | null = null;
  private rafId: number | null = null;
  private readonly abort = new AbortController();

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", (e) => this.onKey(e), {
      signal: this.abort.signal,
    });
    void this.open();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.continueAbortController?.abort();
    this.continueAbortController = null;
    this.abort.abort();
    this.processing?.cancel();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.hudTimer !== null) clearInterval(this.hudTimer);
    this.playback?.pause();
    this.view?.dispose();
  }

  /**
   * Open the stored replay if there is one. Otherwise fetch the record and
   * process it here, playing it as it grows. A game from another build is
   * redirected to that build's versioned shell.
   */
  private async open(): Promise<void> {
    const stored = await replayStore.get(this.gameID);
    if (this.abort.signal.aborted) return;
    if (stored !== undefined) {
      this.fromStore = true;
      if ((await this.load(stored)) !== "unreadable") return;
      // A damaged copy: forget it and process the game again.
      this.fromStore = false;
      void replayStore.remove(this.gameID);
    }
    this.status = "processing";
    this.progress = { phase: "fetching", percent: 0 };

    const result = await fetchReplayRecord(this.gameID);
    if (this.abort.signal.aborted) return;
    switch (result.kind) {
      case "not_found":
        this.fail(translateText("replay_viewer.unavailable_not_found"));
        return;
      case "unreachable":
        this.fail(translateText("replay_viewer.unavailable_unreachable"));
        return;
      case "other_build": {
        const url = await versionedViewerUrl(this.gameID);
        if (this.abort.signal.aborted) return;
        if (url !== null) {
          window.location.assign(url);
          return;
        }
        this.fail(translateText("replay_viewer.unavailable_other_build"));
        return;
      }
      case "record":
        break;
    }

    const record = result.record;
    this.record = record;
    this.gameLength = record.info.num_turns;
    this.progress = { phase: "simulating", percent: 0 };
    this.processing = processInBrowser(record, {
      onProgress: (percent) => {
        this.progress = { phase: "simulating", percent };
      },
      onStart: (base) => {
        this.base = base;
      },
      onAppend: (append) => this.receive(append),
      onDone: () => {
        this.processing = null;
        this.receive("done");
      },
      onError: (message, desync) => {
        this.processing = null;
        console.error("replay viewer: processing failed:", message);
        this.stopProcessing(
          translateText(
            desync
              ? "replay_viewer.unavailable_desync"
              : "replay_viewer.unavailable_failed",
          ),
        );
      },
    });
  }

  /**
   * Handles results from the worker, one at a time. The first append opens
   * the replay and each one after adds to it. `done` comes after the last
   * append: the replay is complete and gets stored.
   */
  private receive(update: ReplayAppend | "done"): void {
    this.applying = this.applying.then(async () => {
      if (this.abort.signal.aborted || this.status === "error") return;
      if (update !== "done") {
        if (this.playback === null) {
          const source = { base: this.base!, append: update };
          if ((await this.load(source)) !== "ready") return;
        } else {
          try {
            this.playback.append(update);
            this.addAppendedPlayers?.();
          } catch (err) {
            this.reportError(err);
            return;
          }
        }
      }
      const complete = update === "done";
      this.growing = !complete;
      if (this.playback !== null) {
        this.playback.live = !complete;
        if (complete) void this.store(this.playback);
      }
      this.requestUpdate();
    });
  }

  /**
   * Processing failed. After appends that are still being applied, so a
   * replay that's playing by then keeps what it has: the processor only
   * hands out frames that match the recorded game. Before that, it's an
   * error.
   */
  private stopProcessing(message: string): void {
    this.applying = this.applying.then(() => {
      if (this.abort.signal.aborted || this.status === "error") return;
      if (this.playback === null || this.status !== "ready") {
        this.fail(message);
        return;
      }
      this.growing = false;
      this.playback.live = false;
      this.stoppedEarly = message;
    });
  }

  /** Keep a processed replay in this browser, so it opens at once next time. */
  private store(playback: ReplayPlayback): Promise<void> {
    return replayStore.put(this.gameID, playback.data());
  }

  /** Show an error and offer the client-side replay. */
  private fail(message: string): void {
    this.growing = false;
    if (this.playback !== null) this.playback.live = false;
    this.playback?.pause();
    this.playing = false;
    this.status = "error";
    this.error = message;
    this.classicFallback = true;
    this.processing?.cancel();
    this.processing = null;
  }

  /**
   * Start playing a replay. "unreadable" (one that doesn't open at all) is
   * left to the caller when it's a stored copy, every other failure is
   * shown.
   */
  private async load(
    source: ReplayData,
  ): Promise<"ready" | "failed" | "unreadable"> {
    this.status = "loading";
    this.classicFallback = false;
    this.error = "";
    try {
      await this.start(source);
    } catch (err) {
      if (this.fromStore && err instanceof UnreadableReplayError) {
        console.warn("replay viewer: stored replay unreadable:", err.reason);
        return "unreadable";
      }
      this.reportError(err);
      return "failed";
    }
    // Playback reports its decode errors itself (fail() sets the message).
    if (this.error !== "") return "failed";
    this.status = "ready";
    return "ready";
  }

  /**
   * `inReplay`: the replay itself is at fault (it didn't decode). A stored
   * copy is then forgotten, so the game gets processed again next time.
   * Anything else (no WebGL, a failed download) keeps it.
   */
  private reportError(err: unknown, inReplay = false): void {
    console.error("replay viewer:", err);
    if (inReplay && this.fromStore) void replayStore.remove(this.gameID);
    this.fail(translateText("replay_viewer.load_failed"));
  }

  private async start(source: ReplayData): Promise<void> {
    const userSettings = new UserSettings();
    const { config, playback } = await openPlayback(source, userSettings).catch(
      (err: unknown) => {
        throw new UnreadableReplayError(err);
      },
    );
    // Closing the viewer while it's still starting stops it here, before it
    // creates anything that would outlive it (the renderer, loops, timers).
    if (this.abort.signal.aborted) return;
    const header = playback.header;
    const gsi = header.gameStartInfo as GameStartInfo;
    const [terrain] = await Promise.all([
      loadTerrainMap(
        gsi.config.gameMap,
        gsi.config.gameMapSize,
        terrainMapFileLoader,
        false,
      ),
      preloadAtlasData(),
    ]);
    if (this.abort.signal.aborted) return;
    const map = terrain.gameMap;
    if (map.width() !== header.mapWidth || map.height() !== header.mapHeight) {
      throw new UnreadableReplayError(
        new Error(
          `map ${gsi.config.gameMap} is ${map.width()}x${map.height()}, ` +
            `the replay ${header.mapWidth}x${header.mapHeight}`,
        ),
      );
    }

    const appearance = new ReplayAppearance(
      header.players,
      gsi,
      userSettings,
      playback.frameBuilder,
    );
    const replayTerrain = new ReplayTerrain(terrainOf(map));
    const adapter = new ReplayGameView(
      appearance.palette.players,
      config,
      header.mapWidth,
      header.mapHeight,
      header.numLandTiles,
      replayTerrain.bytes,
    );
    this.adapter = adapter;
    const showEmojis = () => userSettings.emojis();
    adapter.showEmojis = showEmojis;
    playback.frameBuilder.showEmojis = showEmojis;

    await this.updateComplete;
    if (this.abort.signal.aborted) return;
    const canvas = this.querySelector<HTMLCanvasElement>("canvas")!;
    const { view, draw } = this.createRenderer(
      canvas,
      header,
      replayTerrain,
      appearance.palette,
      config,
      userSettings,
    );
    // The map's decoration layers, loaded in the background like in game.
    new MapLayerController(
      view,
      terrain,
      userSettings,
      gsi.config.gameMap,
      gsi.config.gameMapSize,
      terrainMapFileLoader,
      this.abort.signal,
    ).init();
    appearance.attach(view);
    this.view = view;
    this.addAppendedPlayers = () => appearance.addAppended(adapter);

    // Redraw the players when the graphics settings change (theme, or
    // which cosmetics are shown), like ClientGameRunner's
    // onGraphicsChanged.
    globalThis.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${GRAPHICS_KEY}`,
      () => {
        deepAssign(view.getSettings(), renderSettings(userSettings));
        view.rebuildTerrain();
        appearance.restyle(adapter);
      },
      { signal: this.abort.signal },
    );

    const camera = new ReplayCamera(header.mapWidth, header.mapHeight);
    camera.fit(canvas.clientWidth, canvas.clientHeight);
    this.camera = camera;
    this.gestures = new CameraGestures(camera);

    const nukedLayers = new ReplayNukedLayers(
      terrain.layers ?? [],
      header.mapWidth * header.mapHeight,
      header.nukeImpacts,
      view,
    );
    this.bindPlayback(playback, view, replayTerrain, nukedLayers, adapter);
    this.playback = playback;
    // A restored context is a new renderer, so add the players and state again.
    view.onContextRestored = () => {
      appearance.attach(view);
      void playback.refresh();
    };
    await playback.seek(0);
    // disconnectedCallback has disposed the renderer by now.
    if (this.abort.signal.aborted) return;

    let last: number | null = null;
    const loop = (now: number) => {
      camera.step(last === null ? 0 : now - last);
      last = now;
      playback.tick(now);
      view.setCameraState(camera.x, camera.y, camera.zoom * renderDpr());
      draw(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);

    this.attachHud(adapter, canvas, camera, view);
  }

  /** Send each frame to the renderer and the HUD, and follow playback. */
  private bindPlayback(
    playback: ReplayPlayback,
    view: MapRenderer,
    replayTerrain: ReplayTerrain,
    nukedLayers: ReplayNukedLayers,
    adapter: ReplayGameView,
  ): void {
    const mapWidth = playback.header.mapWidth;
    playback.onFrame = (fd, seeked, source) => {
      const changedTerrain = replayTerrain.apply(source);
      if (changedTerrain.length > 0) {
        const { rects, bytes } = buildTerrainRowSpans(
          changedTerrain,
          mapWidth,
          (ref) => replayTerrain.bytes[ref],
        );
        view.applyTerrainRects(rects, bytes);
      }
      if (seeked) nukedLayers.seek(fd.tick);
      else nukedLayers.advance(fd.tick);
      uploadFrameData(view, fd);
      // Snap names after a seek instead of animating them there.
      if (seeked) {
        view.updateNames(
          fd.names as Map<string, NameEntry>,
          fd.players as Map<number, PlayerState>,
          true,
          fd.playerStatus as Map<number, PlayerStatusData>,
        );
      }
      this.tick = fd.tick;
      adapter.update(
        source,
        replayTerrain.bytes,
        replayTerrain.landChange,
        fd.inSpawnPhase,
        seeked,
      );
    };
    playback.onChange = () => {
      this.frame = playback.frame;
      this.playing = playback.playing;
      this.speed = playback.speed;
    };
    playback.onError = (err, inReplay) => this.reportError(err, inReplay);
  }

  /**
   * The WebGL renderer. It draws when `draw` is called, from the viewer's
   * own animation frame right after the camera update, so they can't get
   * out of sync (ClientGameRunner does the same).
   */
  private createRenderer(
    canvas: HTMLCanvasElement,
    header: ReplayHeader,
    terrain: ReplayTerrain,
    palette: ReplayPalette,
    config: Config,
    userSettings: UserSettings,
  ): { view: MapRenderer; draw: (now: number) => void } {
    let pending: FrameRequestCallback | null = null;
    let view: MapRenderer;
    try {
      view = new MapRenderer(
        canvas,
        {
          mapWidth: header.mapWidth,
          mapHeight: header.mapHeight,
          unitTypes: [...ALL_UNIT_TYPES],
          players: [],
          maxPlayers: 1024,
        },
        () => terrain.bytes.slice(),
        palette.palette,
        config,
        renderSettings(userSettings),
        (cb) => {
          pending = cb;
          return 0;
        },
        () => {
          pending = null;
        },
      );
    } catch (err) {
      if (err instanceof GLUnavailableError) showGLGate(err.glStatus);
      throw err;
    }
    const draw = (now: number) => {
      const cb = pending;
      pending = null;
      cb?.(now);
    };
    return { view, draw };
  }

  /** Hook up the game's HUD (leaderboard, hover card, event feed). */
  private attachHud(
    adapter: ReplayGameView,
    canvas: HTMLCanvasElement,
    camera: ReplayCamera,
    view: MapRenderer,
  ): void {
    // The game's settings menu. Its terrain toggle works like in game, and
    // playback pauses while it's open.
    new ViewModeController(this.hudBus, view).init();
    this.hudBus.on(PauseGameIntentEvent, (e) => {
      if (e.paused) this.playback?.pause();
      else this.playback?.play();
    });
    const menu = this.querySelector<SettingsModal>("settings-modal");
    if (menu !== null) {
      menu.eventBus = this.hudBus;
      menu.init();
    }

    // The hover card needs to know what's under the pointer. The camera
    // stands in for the game's TransformHandler.
    const transform = {
      screenToWorldCoordinates: (sx: number, sy: number) => {
        const rect = canvas.getBoundingClientRect();
        const w = camera.worldAt(
          sx - rect.left,
          sy - rect.top,
          rect.width,
          rect.height,
        );
        return new Cell(Math.floor(w.x), Math.floor(w.y));
      },
    } as unknown as TransformHandler;
    // The event feed is written from one player's point of view, so we
    // follow the human player by default, or whoever gets clicked in the
    // leaderboard.
    adapter.focus =
      adapter
        .playerViews()
        .find((p) => p.clientID() !== null && p.type() === PlayerType.Human) ??
      null;
    this.focusName = adapter.focus?.displayName() ?? "";
    this.hudBus.on(GoToPlayerEvent, (e) => {
      const clicked = adapter.player(
        (e.player as unknown as { id(): string }).id(),
      );
      if (clicked === undefined) return;
      adapter.focus = clicked;
      this.focusName = clicked.displayName();
      // And look at them, like in game.
      const at = clicked.nameLocation();
      if (at !== undefined) camera.goTo(at.x, at.y);
    });

    const events = this.querySelector<EventsDisplay>("events-display");
    if (events !== null) {
      events.game = adapter.asGameView();
      events.eventBus = this.hudBus;
      events.init();
    }

    const overlay = this.querySelector<PlayerInfoOverlay>(
      "player-info-overlay",
    );
    if (overlay !== null) {
      overlay.game = adapter.asGameView();
      overlay.eventBus = this.hudBus;
      overlay.transform = transform;
      overlay.init();
    }

    // Rebuilding the leaderboard table isn't cheap, so update once a
    // second like the game does.
    this.hudTimer = window.setInterval(() => {
      this.querySelector<PlayerStats>("player-stats")?.refresh();
      overlay?.tick();
      events?.tick();
    }, 1000);
  }

  // ---- Input ----

  private onKey(e: KeyboardEvent): void {
    const p = this.playback;
    if (p === null || this.status !== "ready") return;
    // The settings or continue modal paused playback, so keys wait until it closes.
    if (
      this.continueModalOpen ||
      this.querySelector<SettingsModal>("settings-modal")?.open
    ) {
      return;
    }
    // The timeline keeps focus after a click, so it doesn't count as typing.
    // Its own arrow-key steps are prevented below so a key seeks once.
    if (e.target instanceof HTMLInputElement && e.target.type !== "range") {
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      this.togglePlay();
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      void p.seek(p.frame + (e.shiftKey ? 100 : 1));
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      void p.seek(p.frame - (e.shiftKey ? 100 : 1));
    }
  }

  private onPointerDown(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    this.gestures?.down(
      e.pointerId,
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  }

  private onPointerMove(e: PointerEvent): void {
    const g = this.gestures;
    if (this.status === "ready" && g?.active === false) {
      this.hudBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    g?.move(
      e.pointerId,
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
    );
  }

  private onPointerUp(e: PointerEvent): void {
    this.gestures?.up(e.pointerId);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    this.camera?.zoomAt(
      e.clientX - rect.left,
      e.clientY - rect.top,
      Math.pow(WHEEL_ZOOM, -e.deltaY),
      rect.width,
      rect.height,
    );
  }

  private onDoubleClick(e: MouseEvent): void {
    const el = e.currentTarget as HTMLElement;
    this.camera?.fit(el.clientWidth, el.clientHeight);
  }

  private togglePlay(): void {
    const p = this.playback;
    if (p === null) return;
    if (p.playing) p.pause();
    else p.play();
  }

  private openMenu(): void {
    this.hudBus.emit(
      new ShowSettingsModalEvent(
        true,
        /* shouldPause */ true,
        /* isPaused */ !this.playing,
      ),
    );
  }

  private openContinueModal(): void {
    const p = this.playback;
    if (p !== null && p.playing) {
      p.pause();
    }
    const adapter = this.adapter;
    let players: ContinuePlayerOption[] = [];
    if (adapter) {
      adapter.sync();
      const inSpawn = adapter.inSpawnPhase();
      const landTiles = adapter.numLandTiles();
      players = adapter
        .playerViews()
        .filter(
          (pv) => (inSpawn || pv.isAlive()) && pv.type() !== PlayerType.Bot,
        )
        .map((pv) => {
          const tiles = pv.numTilesOwned();
          const controlPercent = landTiles > 0 ? (tiles / landTiles) * 100 : 0;
          return {
            id: pv.id(),
            name: pv.displayName() || pv.name(),
            smallID: pv.smallID(),
            flag: pv.flag(),
            troops: pv.troops(),
            tiles,
            controlPercent,
          };
        });
    }
    this.continuePlayers = players;
    const focusID = adapter?.focus?.id();
    this.continueInitialPlayerID =
      players.find((p) => p.id === focusID)?.id ?? players[0]?.id ?? "";
    this.continueAbortController?.abort();
    this.continueAbortController = null;
    this.continueRequestCount++;
    this.continueModalOpen = true;
  }

  private closeContinueModal(): void {
    this.continueAbortController?.abort();
    this.continueAbortController = null;
    this.continueRequestCount++;
    this.continueModalOpen = false;
  }

  private async handleContinueGame(
    e: CustomEvent<{ playerID: string; difficulty: Difficulty }>,
  ): Promise<void> {
    const abortController = new AbortController();
    this.continueAbortController = abortController;
    const requestId = this.continueRequestCount;
    const modal = this.querySelector<ContinueGameModal>("continue-game-modal");
    modal?.setLoading(true);
    try {
      let record = this.record;
      if (!record) {
        const res = await fetchReplayRecord(this.gameID);
        if (this.continueRequestCount !== requestId) return;
        if (res.kind === "record") {
          this.record = res.record;
          record = res.record;
        } else {
          modal?.setLoading(
            false,
            translateText("replay_viewer.unavailable_failed"),
          );
          return;
        }
      }
      const localClientID = generateID();
      const { snapshot, gameStartInfo } = await extractSnapshotInWorker(
        record,
        this.tick,
        e.detail.playerID,
        localClientID,
        e.detail.difficulty,
        undefined,
        abortController.signal,
      );
      if (this.continueRequestCount !== requestId) return;

      document.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail: {
            gameID: gameStartInfo.gameID,
            gameStartInfo,
            source: "singleplayer",
            resumeSnapshot: snapshot,
          } satisfies JoinLobbyEvent,
          bubbles: true,
          composed: true,
        }),
      );
      this.closeContinueModal();
      modal?.setLoading(false);
    } catch (err) {
      if (this.continueRequestCount !== requestId) return;
      console.error("replay viewer: continue game failed:", err);
      modal?.setLoading(
        false,
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      if (this.continueAbortController === abortController) {
        this.continueAbortController = null;
      }
    }
  }

  // ---- Render ----

  render() {
    const loaded = this.playback?.totalFrames ?? 0;
    return html`
      <!-- Stays below the game's modals (z-[9999] and up) like the game
        does, so the settings menu shows on top. -->
      <div class="fixed inset-0 z-[9000] bg-black text-white select-none">
        <canvas class="absolute inset-0 w-full h-full"></canvas>
        <div
          class="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
          @pointercancel=${this.onPointerUp}
          @wheel=${this.onWheel}
          @dblclick=${this.onDoubleClick}
        ></div>
        ${this.status === "ready" ? this.renderStats() : nothing}
        ${this.status === "ready" && this.stoppedEarly !== ""
          ? this.renderStoppedEarly(loaded)
          : nothing}
        <player-info-overlay></player-info-overlay>
        <!-- Always in the DOM, like the overlay: attachHud wires it up while
          the replay is still loading. Its content is w-96 from 1200px up,
          so it widens with it there instead of spilling off the right. -->
        <events-display
          class="absolute right-3 bottom-20 w-80 max-w-[40vw] min-[1200px]:w-96 ${this
            .status === "ready"
            ? ""
            : "hidden"}"
        ></events-display>
        ${this.status === "ready"
          ? html`<replay-controls
              .frame=${this.frame}
              .tick=${this.tick}
              .loaded=${loaded}
              .total=${timelineFrames(loaded, this.gameLength, this.growing)}
              .playing=${this.playing}
              .speed=${this.speed}
              .canContinue=${true}
              @replay-toggle-play=${() => this.togglePlay()}
              @replay-seek=${(e: CustomEvent<number>) =>
                void this.playback?.seek(e.detail)}
              @replay-speed=${(e: CustomEvent<number>) =>
                this.playback?.setSpeed(e.detail)}
              @replay-menu=${() => this.openMenu()}
              @replay-continue=${() => this.openContinueModal()}
            ></replay-controls>`
          : html`<replay-status
              .gameID=${this.gameID}
              .status=${this.status}
              .progress=${this.progress}
              .error=${this.error}
              .classicFallback=${this.classicFallback}
            ></replay-status>`}
        <settings-modal></settings-modal>
        <continue-game-modal
          .open=${this.continueModalOpen}
          .tick=${this.tick}
          .players=${this.continuePlayers}
          .initialPlayerID=${this.continueInitialPlayerID}
          @close=${() => this.closeContinueModal()}
          @continue=${(
            e: CustomEvent<{ playerID: string; difficulty: Difficulty }>,
          ) => void this.handleContinueGame(e)}
        ></continue-game-modal>
      </div>
    `;
  }

  /** Over a replay that could only be processed part of the way. */
  private renderStoppedEarly(loaded: number) {
    // One frame per tick, so the last frame's tick is this far ahead.
    const lastTick = this.tick + (loaded - 1 - this.frame);
    return html`
      <div
        class="absolute top-3 left-1/2 -translate-x-1/2 w-[min(28rem,calc(100vw-2rem))] flex items-start gap-3 p-3 rounded-xl border border-red-500/40 bg-black/75 backdrop-blur-sm text-sm"
      >
        <div class="flex-1 flex flex-col gap-2">
          <p role="alert" class="font-medium text-red-300">
            ${this.stoppedEarly}
          </p>
          <p class="text-white/70">
            ${translateText("replay_viewer.partial", {
              time: formatGameTime(lastTick),
            })}
          </p>
          <o-button
            width="block"
            size="sm"
            translationKey="replay_viewer.watch_classic"
            @click=${() =>
              window.location.assign(classicReplayHref(this.gameID))}
          ></o-button>
        </div>
        <button
          class="px-1 text-lg leading-none text-white/60 hover:text-white cursor-pointer"
          aria-label=${translateText("common.close")}
          @click=${() => (this.stoppedEarly = "")}
        >
          ×
        </button>
      </div>
    `;
  }

  /** The game's leaderboard, in the same panel as in game (GameLeftSidebar). */
  private renderStats() {
    return html`
      <aside
        class="absolute top-0 left-0 flex flex-col gap-2 max-h-[calc(100vh-80px)] overflow-y-auto p-2 bg-gray-800/92 backdrop-blur-sm shadow-xs rounded-br-lg text-white max-[400px]:w-full max-[400px]:rounded-none"
      >
        <player-stats
          class="block min-w-0"
          .game=${this.adapter?.asGameView() ?? null}
          .visible=${true}
          .eventBus=${this.hudBus}
        ></player-stats>
        ${this.focusName === ""
          ? nothing
          : html`<span class="text-xs text-white/70"
              >${translateText("replay_viewer.following", {
                name: this.focusName,
              })}</span
            >`}
      </aside>
    `;
  }
}
