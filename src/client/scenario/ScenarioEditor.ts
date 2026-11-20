/**
 * <scenario-editor>, the full-page scenario editor (docs/ScenarioEditor.md,
 * "Editor runtime"). Main opens it for `#scenario-editor`, with or without
 * a draft (ScenarioEditorRoute).
 *
 * It owns the document and one editor engine in a worker. Each edit goes to
 * both; the worker's updates reach GameView, the renderer and the borrowed
 * HUD layers as in game. Resizing the map rebuilds the engine. The editing
 * tools come later; for now it opens or creates a draft and shows its map.
 */

import type { GameMap } from "@openfront/engine-api/game/GameMap";
import { Cell, GameMapSize } from "@openfront/engine-api/game/GameTypes";
import type { MapFiles } from "@openfront/engine-api/game/MapFiles";
import { maps } from "@openfront/engine-api/game/Maps.gen";
import { Config } from "@openfront/engine-lib/configuration/Config";
import { loadTerrainMap } from "@openfront/engine-lib/game/TerrainMapLoader";
import { EventBus } from "@openfront/shared/EventBus";
import { loadMapFiles } from "@openfront/shared/GameMapLoader";
import { generateID } from "@openfront/shared/SharedUtil";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "../hud/layers/PlayerInfoOverlay";
import type { PlayerInfoOverlay } from "../hud/layers/PlayerInfoOverlay";
import { MouseMoveEvent } from "../InputHandler";
import {
  applyGraphicsOverrides,
  createRenderSettings,
  GLUnavailableError,
  MapRenderer,
  preloadAtlasData,
  renderDpr,
  showGLGate,
} from "../render/gl";
import { ALL_UNIT_TYPES } from "../render/types";
import { CameraGestures, ReplayCamera } from "../replay/ReplayCamera";
import {
  loadCachedManifest,
  terrainMapFileLoader,
} from "../TerrainMapFileLoader";
import type { TransformHandler } from "../TransformHandler";
import { UserSettings } from "../UserSettings";
import { homeHref, translateText } from "../Utils";
import { GameView } from "../view/GameView";
import { WebGLFrameBuilder } from "../WebGLFrameBuilder";
import { WorkerClient } from "../WorkerClient";
import { DocumentEditor } from "./DocumentEditor";
import {
  editorStartInfo,
  startEditorEngine,
  stockMapStart,
} from "./EditorEngine";
import {
  isScenarioSize,
  MAX_AREA,
  newScenarioDocument,
  resizeScenarioDocument,
  type ScenarioDocument,
} from "./ScenarioDocument";
import { type DraftInfo, scenarioDrafts } from "./ScenarioDrafts";
import { scenarioEditorHash } from "./ScenarioEditorRoute";

const WHEEL_ZOOM = 1.0015;

/** Copies of the files' maps: the client and the worker each take theirs. */
function copyMapFiles(files: MapFiles): MapFiles {
  return {
    ...files,
    mapBin: files.mapBin?.slice(),
    map4xBin: files.map4xBin?.slice(),
  };
}

/** What runs while a document is open; a resize replaces it. */
interface Session {
  abort: AbortController;
  worker: WorkerClient | null;
  view: MapRenderer | null;
  canvas: HTMLCanvasElement | null;
  rafId: number | null;
}

@customElement("scenario-editor")
export class ScenarioEditor extends LitElement {
  /** The open draft, which the URL names; null on the start screen. */
  @property({ type: String }) draftId: string | null = null;

  @state() private status: "start" | "loading" | "ready" | "error" = "start";
  @state() private error = "";
  @state() private drafts: DraftInfo[] = [];
  @state() private name = "";
  @state() private width = 1000;
  @state() private height = 1000;
  @state() private stockMap = "";
  /** The picked stock map's size, once its manifest is in. */
  @state() private stockSize: { width: number; height: number } | null = null;
  @state() private doc: ScenarioDocument | null = null;

  private editor: DocumentEditor | null = null;
  private session: Session | null = null;
  private camera: ReplayCamera | null = null;
  private gestures: CameraGestures | null = null;
  /** Sends pointer moves to the HUD (InputHandler does this in game). */
  private hudBus = new EventBus();
  private readonly abort = new AbortController();

  createRenderRoot() {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("keydown", (e) => this.onKey(e), {
      signal: this.abort.signal,
    });
    if (this.draftId !== null) {
      void this.openDraft(this.draftId);
    } else {
      void this.listDrafts();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.abort.abort();
    this.endSession();
  }

  private async listDrafts(): Promise<void> {
    try {
      this.drafts = await scenarioDrafts.list();
    } catch (e) {
      console.error("scenario editor: listing drafts failed:", e);
    }
  }

  private async openDraft(id: string): Promise<void> {
    this.status = "loading";
    try {
      const doc = await scenarioDrafts.load(id);
      // Removed meanwhile (a lobby join): leave the URL and engine alone.
      if (this.abort.signal.aborted) return;
      if (doc === undefined) {
        this.fail(translateText("scenario_editor.draft_not_found"));
        return;
      }
      this.setDraft(id);
      await this.startSession(doc);
    } catch (e) {
      console.error("scenario editor: opening the draft failed:", e);
      this.fail(translateText("scenario_editor.open_failed"));
    }
  }

  private async createBlank(): Promise<void> {
    if (!isScenarioSize(this.width, this.height)) return;
    const doc = newScenarioDocument(this.draftName(), this.width, this.height);
    await this.create(async () => ({ doc }));
  }

  private async createFromStock(): Promise<void> {
    const map = maps.find((m) => m.type === this.stockMap);
    if (map === undefined) return;
    await this.create(async () =>
      stockMapStart(
        this.draftName(),
        await loadMapFiles(terrainMapFileLoader, map.type, GameMapSize.Normal),
      ),
    );
  }

  /** Saves a new draft, names it in the URL and opens it. */
  private async create(
    begin: () => Promise<{ doc: ScenarioDocument; files?: MapFiles }>,
  ): Promise<void> {
    this.status = "loading";
    try {
      const { doc, files } = await begin();
      const id = generateID();
      await scenarioDrafts.save(id, doc);
      if (this.abort.signal.aborted) return;
      this.setDraft(id);
      await this.startSession(doc, files);
    } catch (e) {
      console.error("scenario editor: creating the draft failed:", e);
      this.fail(translateText("scenario_editor.create_failed"));
    }
  }

  private draftName(): string {
    return this.name.trim() || translateText("scenario_editor.untitled");
  }

  private setDraft(id: string): void {
    this.draftId = id;
    history.replaceState(
      history.state,
      "",
      window.location.pathname +
        window.location.search +
        scenarioEditorHash(id),
    );
  }

  private fail(message: string): void {
    this.endSession();
    this.error = message;
    this.status = "error";
  }

  private async pickStockMap(type: string): Promise<void> {
    this.stockMap = type;
    this.stockSize = null;
    const map = maps.find((m) => m.type === type);
    if (map === undefined) return;
    try {
      const { width, height } = (await loadCachedManifest(map.type)).map;
      if (this.stockMap === type) this.stockSize = { width, height };
    } catch (e) {
      console.error("scenario editor: loading the map's manifest failed:", e);
    }
  }

  private async resize(): Promise<void> {
    const doc = this.doc;
    const id = this.draftId;
    if (doc === null || id === null) return;
    if (!isScenarioSize(this.width, this.height)) return;
    if (this.width === doc.width && this.height === doc.height) return;
    this.status = "loading";
    try {
      const resized = resizeScenarioDocument(doc, this.width, this.height);
      await scenarioDrafts.save(id, resized);
      await this.startSession(resized);
    } catch (e) {
      console.error("scenario editor: resizing failed:", e);
      this.fail(translateText("scenario_editor.open_failed"));
    }
  }

  private undoOrRedo(redo: boolean): void {
    const editor = this.editor;
    const id = this.draftId;
    if (editor === null || id === null || this.status !== "ready") return;
    if (redo ? !editor.canRedo() : !editor.canUndo()) return;
    if (redo) editor.redo();
    else editor.undo();
    void scenarioDrafts.save(id, editor.doc).catch((e: unknown) => {
      console.error("scenario editor: saving the draft failed:", e);
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    const key = e.key.toLowerCase();
    if (key === "z") this.undoOrRedo(e.shiftKey);
    else if (key === "y") this.undoOrRedo(true);
    else return;
    e.preventDefault();
  }

  // ---- The engine and the view ----

  /**
   * Builds the editor engine for the document, and the view of it: on the
   * stock map's files if given, else on a blank map with the document
   * replayed into it. Replaces the open session.
   */
  private async startSession(
    doc: ScenarioDocument,
    stockFiles?: MapFiles,
  ): Promise<void> {
    this.endSession();
    this.status = "loading";
    this.doc = null;
    this.editor = null;
    this.width = doc.width;
    this.height = doc.height;
    const session: Session = {
      abort: new AbortController(),
      worker: null,
      view: null,
      canvas: null,
      rafId: null,
    };
    this.session = session;
    const { signal } = session.abort;
    await Promise.all([preloadAtlasData(), this.updateComplete]);
    if (signal.aborted) return;

    const userSettings = new UserSettings();
    const start = editorStartInfo();
    const config = new Config(start.config, false);
    let gameView: GameView | null = null;
    let builder: WebGLFrameBuilder | null = null;
    const overlay = this.querySelector<PlayerInfoOverlay>(
      "player-info-overlay",
    );

    const send = await startEditorEngine(
      doc,
      async (files) => {
        const terrain = await loadTerrainMap(copyMapFiles(files));
        if (signal.aborted) throw new DOMException("closed", "AbortError");
        const worker = new WorkerClient(start, undefined, undefined, files);
        session.worker = worker;
        await worker.initialize();
        if (signal.aborted) {
          // endSession may have run before the worker existed.
          worker.cleanup();
          throw new DOMException("closed", "AbortError");
        }
        const view = new GameView(
          worker,
          config,
          terrain,
          undefined,
          "",
          null,
          start.gameID,
          [],
        );
        gameView = view;
        builder = this.createView(
          session,
          terrain.gameMap,
          view,
          config,
          userSettings,
        );
        worker.start((gu) => {
          if ("errMsg" in gu) {
            console.error("scenario editor: engine error:", gu.errMsg);
            return;
          }
          view.update(gu);
          builder?.update(view);
          overlay?.tick();
        });
        return (command) => {
          worker.editorCommand(command).catch((e: unknown) => {
            console.error("scenario editor: command failed:", command.type, e);
          });
        };
      },
      stockFiles,
    ).catch((e: unknown) => {
      if (signal.aborted) return null;
      throw e;
    });
    if (send === null || signal.aborted) return;

    this.editor = new DocumentEditor(doc, send);
    this.doc = doc;
    this.status = "ready";
    if (overlay !== null && gameView !== null) {
      overlay.game = gameView;
      overlay.eventBus = this.hudBus;
      overlay.transform = this.transform(session.canvas!);
      overlay.init();
    }
  }

  /** The renderer on a new canvas, and the frame loop that draws it. */
  private createView(
    session: Session,
    map: GameMap,
    gameView: GameView,
    config: Config,
    userSettings: UserSettings,
  ): WebGLFrameBuilder {
    const mapWidth = map.width();
    const mapHeight = map.height();
    // A new canvas each time: a disposed renderer leaves its context lost.
    const canvas = document.createElement("canvas");
    canvas.className = "absolute inset-0 w-full h-full";
    this.querySelector("#scenario-editor-canvas")!.replaceChildren(canvas);
    session.canvas = canvas;

    const settings = createRenderSettings();
    applyGraphicsOverrides(settings, userSettings.graphicsOverrides());
    let pending: FrameRequestCallback | null = null;
    let view: MapRenderer;
    try {
      view = new MapRenderer(
        canvas,
        {
          mapWidth,
          mapHeight,
          unitTypes: [...ALL_UNIT_TYPES],
          players: [],
          maxPlayers: 1024,
        },
        () => {
          const bytes = new Uint8Array(mapWidth * mapHeight);
          for (let t = 0; t < bytes.length; t++) bytes[t] = map.terrainByte(t);
          return bytes;
        },
        new Float32Array(4096 * 2 * 4),
        config,
        settings,
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
    session.view = view;
    const builder = new WebGLFrameBuilder(view);
    // The editor never ticks, so nothing else would redraw the state.
    view.onContextRestored = () => builder.restoreContext(gameView);

    const camera = new ReplayCamera(mapWidth, mapHeight);
    camera.fit(canvas.clientWidth, canvas.clientHeight);
    this.camera = camera;
    this.gestures = new CameraGestures(camera);
    let last: number | null = null;
    const loop = (now: number) => {
      camera.step(last === null ? 0 : now - last);
      last = now;
      view.setCameraState(camera.x, camera.y, camera.zoom * renderDpr());
      const cb = pending;
      pending = null;
      cb?.(now);
      session.rafId = requestAnimationFrame(loop);
    };
    session.rafId = requestAnimationFrame(loop);
    return builder;
  }

  /** The hover card's TransformHandler: the camera stands in for it. */
  private transform(canvas: HTMLCanvasElement): TransformHandler {
    return {
      screenToWorldCoordinates: (sx: number, sy: number) => {
        const rect = canvas.getBoundingClientRect();
        const w = this.camera!.worldAt(
          sx - rect.left,
          sy - rect.top,
          rect.width,
          rect.height,
        );
        return new Cell(Math.floor(w.x), Math.floor(w.y));
      },
    } as unknown as TransformHandler;
  }

  private endSession(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    session.abort.abort();
    if (session.rafId !== null) cancelAnimationFrame(session.rafId);
    session.view?.dispose();
    session.canvas?.remove();
    session.worker?.cleanup();
    this.camera = null;
    this.gestures = null;
    // The overlay listens on the bus; a new one leaves the old listeners.
    this.hudBus = new EventBus();
  }

  // ---- Pointer ----

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
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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

  // ---- Render ----

  render() {
    return html`
      <!-- Below the game's modals (z-[9999] and up), like the replay viewer. -->
      <div class="fixed inset-0 z-[9000] bg-black text-white">
        <div id="scenario-editor-canvas" class="absolute inset-0"></div>
        <div
          class="absolute inset-0 touch-none cursor-grab active:cursor-grabbing"
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
          @pointercancel=${this.onPointerUp}
          @wheel=${this.onWheel}
          @dblclick=${this.onDoubleClick}
        ></div>
        <player-info-overlay></player-info-overlay>
        ${this.status === "ready" ? this.renderBar() : nothing}
        ${this.status === "start" ? this.renderStart() : nothing}
        ${
          this.status === "loading"
            ? this.renderPanel(
                html`<p>${translateText("scenario_editor.loading")}</p>`,
              )
            : nothing
        }
        ${
          this.status === "error"
            ? this.renderPanel(html`
                <p class="mb-4">${this.error}</p>
                <a class="underline" href=${homeHref()}>
                  ${translateText("scenario_editor.exit")}
                </a>
              `)
            : nothing
        }
      </div>
    `;
  }

  private renderPanel(content: unknown) {
    return html`
      <div class="absolute inset-0 flex items-center justify-center p-4">
        <div
          class="w-full max-w-lg max-h-full overflow-y-auto rounded-lg bg-zinc-900 p-6 shadow-xl"
        >
          ${content}
        </div>
      </div>
    `;
  }

  private sizeInputs() {
    const valid = isScenarioSize(this.width, this.height);
    return html`
      <label class="flex items-center gap-1">
        ${translateText("scenario_editor.width")}
        <input
          type="number"
          step="4"
          class="w-24 rounded bg-zinc-800 px-2 py-1 text-white"
          .value=${String(this.width)}
          @input=${(e: Event) =>
            (this.width = Number((e.target as HTMLInputElement).value))}
        />
      </label>
      <label class="flex items-center gap-1">
        ${translateText("scenario_editor.height")}
        <input
          type="number"
          step="4"
          class="w-24 rounded bg-zinc-800 px-2 py-1 text-white"
          .value=${String(this.height)}
          @input=${(e: Event) =>
            (this.height = Number((e.target as HTMLInputElement).value))}
        />
      </label>
      ${
        valid
          ? nothing
          : html`<p class="w-full text-sm text-red-400">
              ${translateText("scenario_editor.size_rule", {
                max: MAX_AREA.toLocaleString(),
              })}
            </p>`
      }
    `;
  }

  private renderStart() {
    const button =
      "rounded bg-blue-600 px-3 py-1 hover:bg-blue-500 disabled:opacity-50";
    const stock = this.stockSize;
    const stockFits =
      stock !== null && isScenarioSize(stock.width, stock.height);
    const stockMaps = maps
      .filter((m) => m.hidden !== true)
      .map((m) => ({ type: m.type, name: translateText(m.translationKey) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return this.renderPanel(html`
      <h1 class="mb-4 text-2xl font-bold">
        ${translateText("scenario_editor.title")}
      </h1>
      ${
        this.drafts.length > 0
          ? html`
              <h2 class="mb-2 font-semibold">
                ${translateText("scenario_editor.drafts")}
              </h2>
              <ul class="mb-4 flex flex-col gap-1">
                ${this.drafts.map(
                  (d) => html`
                    <li>
                      <button
                        class="w-full rounded bg-zinc-800 px-3 py-2 text-left hover:bg-zinc-700"
                        @click=${() => void this.openDraft(d.id)}
                      >
                        ${d.name}
                        <span class="text-sm text-zinc-400">
                          ${new Date(d.savedAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  `,
                )}
              </ul>
            `
          : nothing
      }
      <h2 class="mb-2 font-semibold">
        ${translateText("scenario_editor.new_scenario")}
      </h2>
      <label class="mb-3 flex flex-col gap-1">
        ${translateText("scenario_editor.name")}
        <input
          class="rounded bg-zinc-800 px-2 py-1 text-white"
          maxlength="64"
          .value=${this.name}
          @input=${(e: Event) =>
            (this.name = (e.target as HTMLInputElement).value)}
        />
      </label>
      <div class="mb-2 flex flex-wrap items-center gap-3">
        ${this.sizeInputs()}
        <button
          class=${button}
          ?disabled=${!isScenarioSize(this.width, this.height)}
          @click=${() => void this.createBlank()}
        >
          ${translateText("scenario_editor.create_blank")}
        </button>
      </div>
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <select
          class="rounded bg-zinc-800 px-2 py-1 text-white"
          .value=${this.stockMap}
          @change=${(e: Event) =>
            void this.pickStockMap((e.target as HTMLSelectElement).value)}
        >
          <option value="">
            ${translateText("scenario_editor.pick_stock_map")}
          </option>
          ${stockMaps.map(
            (m) => html`<option value=${m.type}>${m.name}</option>`,
          )}
        </select>
        <button
          class=${button}
          ?disabled=${!stockFits}
          @click=${() => void this.createFromStock()}
        >
          ${translateText("scenario_editor.create_from_stock")}
        </button>
        ${
          stock === null
            ? nothing
            : html`<p class="w-full text-sm ${stockFits ? "" : "text-red-400"}">
                ${translateText(
                  stockFits
                    ? "scenario_editor.stock_size"
                    : "scenario_editor.stock_too_large",
                  {
                    width: stock.width,
                    height: stock.height,
                    max: MAX_AREA.toLocaleString(),
                  },
                )}
              </p>`
        }
      </div>
    `);
  }

  private renderBar() {
    const doc = this.doc!;
    const button =
      "rounded bg-zinc-700 px-3 py-1 hover:bg-zinc-600 disabled:opacity-50";
    return html`
      <div
        class="absolute top-0 left-0 right-0 flex flex-wrap items-center gap-3 bg-zinc-900/90 px-4 py-2"
      >
        <span class="font-semibold">${doc.meta.name}</span>
        ${this.sizeInputs()}
        <button
          class=${button}
          ?disabled=${
            !isScenarioSize(this.width, this.height) ||
            (this.width === doc.width && this.height === doc.height)
          }
          @click=${() => void this.resize()}
        >
          ${translateText("scenario_editor.resize")}
        </button>
        <a class="${button} ml-auto" href=${homeHref()}>
          ${translateText("scenario_editor.exit")}
        </a>
      </div>
    `;
  }
}
