/**
 * <scenario-editor>, the full-page scenario editor (docs/ScenarioEditor.md,
 * "Editor runtime"). Main opens it for `#scenario-editor`, with or without
 * a draft (ScenarioEditorRoute).
 *
 * It owns the document and one editor engine in a worker. Each edit goes to
 * both; the worker's updates reach GameView, the renderer and the borrowed
 * HUD layers as in game. Resizing the map rebuilds the engine. Its tools
 * so far are the terrain and territory brushes and the nations panel.
 */

import { SetNationCommandSchema } from "@openfront/engine-api/EditorCommands";
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
import { customElement, property, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import Countries from "resources/countries.json" with { type: "json" };
import { ClientEnv } from "../ClientEnv";
import "../hud/layers/PlayerInfoOverlay";
import type { PlayerInfoOverlay } from "../hud/layers/PlayerInfoOverlay";
import { showInGameAlert } from "../InGameModal";
import { MouseMoveEvent } from "../InputHandler";
import { fallbackPlayerName } from "../PlayerName";
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
import type { UsernameInput } from "../UsernameInput";
import { UserSettings } from "../UserSettings";
import { homeHref, returnFromGameTo, translateText } from "../Utils";
import { GameView } from "../view/GameView";
import { WebGLFrameBuilder } from "../WebGLFrameBuilder";
import { WorkerClient } from "../WorkerClient";
import { DocumentEditor, type Edit } from "./DocumentEditor";
import {
  editorStartInfo,
  startEditorEngine,
  stockMapStart,
} from "./EditorEngine";
import {
  IMPASSABLE,
  isScenarioSize,
  land,
  MAX_NATIONS,
  MAX_SIDE,
  MAX_ELEVATION,
  newNation,
  newScenarioDocument,
  resizeScenarioDocument,
  type ScenarioDocument,
  type ScenarioNation,
  WATER,
} from "./ScenarioDocument";
import { type DraftInfo, scenarioDrafts } from "./ScenarioDrafts";
import { scenarioEditorHash } from "./ScenarioEditorRoute";
import { exportScenario } from "./ScenarioExport";
import { scenarioGameStart } from "./ScenarioStart";
import {
  type BrushStroke,
  TerrainStroke,
  TerritoryStroke,
} from "./TerrainBrush";

const WHEEL_ZOOM = 1.0015;
const MAX_BRUSH_RADIUS = 50;
/** How far, in CSS px, a finger moves before its touch is a stroke. */
const TOUCH_SLOP = 8;

type Tool = "pan" | "terrain" | "territory";
type TerrainKind = "water" | "land" | "impassable";
type NationFields = Omit<Extract<Edit, { type: "set_nation" }>, "type" | "id">;

/** The flags a nation can take, as the flag picker lists them. */
const FLAGS = Countries.filter((c) => c.code !== "xx" && c.restricted !== true);

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
  @state() private tool: Tool = "pan";
  @state() private terrainKind: TerrainKind = "land";
  @state() private elevation = 0;
  /** In tiles; 0 paints one tile. */
  @state() private brushRadius = 2;
  /**
   * The nation picked in the nations panel, which the territory brush
   * paints; null, or a nation since removed, erases.
   */
  @state() private nationId: string | null = null;
  /** The Play button's menu: the nations to play as, or why there are none. */
  @state() private playMenu = false;
  /** A test game is being exported and started. */
  @state() private starting = false;

  @query("#scenario-editor-brush") private brushPreview!: HTMLElement | null;

  private editor: DocumentEditor | null = null;
  private session: Session | null = null;
  private camera: ReplayCamera | null = null;
  private gestures: CameraGestures | null = null;
  /** The brush stroke in progress, by the pointer painting it. */
  private stroke: {
    pointerId: number;
    brush: BrushStroke;
    x: number;
    y: number;
    startX: number;
    startY: number;
    /**
     * A touch paints nothing until it moves or lifts: until then a second
     * finger may still make it a pinch.
     */
    confirmed: boolean;
  } | null = null;
  /** Where the pointer is over the map, in CSS px; null when off it. */
  private hover: { x: number; y: number } | null = null;
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
    // A test play starting exports from the current session; replacing it
    // would leave that export waiting on a terminated worker.
    if (doc === null || id === null || this.starting) return;
    if (!isScenarioSize(this.width, this.height)) return;
    if (this.width === doc.width && this.height === doc.height) return;
    // A stroke still open goes into the resized document.
    this.endStroke();
    this.status = "loading";
    try {
      const resized = resizeScenarioDocument(doc, this.width, this.height);
      await scenarioDrafts.save(id, resized);
      if (this.abort.signal.aborted) return;
      await this.startSession(resized);
    } catch (e) {
      console.error("scenario editor: resizing failed:", e);
      this.fail(translateText("scenario_editor.open_failed"));
    }
  }

  private undoOrRedo(redo: boolean): void {
    const editor = this.editor;
    // While a test play starts, its export reads the document (testPlay).
    if (editor === null || this.status !== "ready" || this.starting) return;
    // Mid-stroke, undo would split the stroke in two.
    if (this.stroke !== null) return;
    if (redo ? !editor.canRedo() : !editor.canUndo()) return;
    if (redo) editor.redo();
    else editor.undo();
    this.saveDraft();
    this.requestUpdate();
  }

  private saveDraft(): void {
    const editor = this.editor;
    const id = this.draftId;
    if (editor === null || id === null) return;
    void scenarioDrafts.save(id, editor.doc).catch((e: unknown) => {
      console.error("scenario editor: saving the draft failed:", e);
    });
  }

  // ---- Nations ----

  /** The nation the territory brush paints, unless removed since. */
  private selectedNation(): ScenarioNation | null {
    return this.doc?.nations.find((n) => n.id === this.nationId) ?? null;
  }

  /** Applies an edit as an undo step of its own, and saves. */
  private applyEdit(edit: Edit): void {
    const editor = this.editor;
    // While a test play starts, its export reads the document: an edit then
    // could, say, make the nation being played unplayable.
    if (editor === null || this.status !== "ready" || this.starting) return;
    // A stroke still open ends first, as its own step.
    this.endStroke();
    editor.apply(edit);
    editor.commit();
    this.saveDraft();
    this.requestUpdate();
  }

  private addNation(): void {
    const doc = this.doc;
    if (doc === null || doc.nations.length >= MAX_NATIONS) return;
    const nation = newNation(doc, (n) =>
      translateText("scenario_editor.new_nation_name", { n }),
    );
    this.applyEdit({ type: "add_nation", nation });
    this.nationId = nation.id;
  }

  /**
   * Changes the nation's fields as one undo step. Values that change
   * nothing or that the command schema rejects put the inputs back.
   */
  private setNation(nation: ScenarioNation, fields: NationFields): void {
    const edit: Edit = { type: "set_nation", id: nation.id, ...fields };
    const keys = Object.keys(fields) as (keyof NationFields)[];
    if (
      keys.every((k) => fields[k] === nation[k]) ||
      !SetNationCommandSchema.safeParse(edit).success
    ) {
      this.requestUpdate();
      return;
    }
    this.applyEdit(edit);
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target;
    // A text field keeps its keys, undo included. Other controls (a select,
    // a checkbox, a slider) keep only the brackets, so undo still works
    // after a change in one.
    if (
      t instanceof HTMLInputElement &&
      (t.type === "text" || t.type === "number")
    ) {
      return;
    }
    const control =
      t instanceof HTMLInputElement || t instanceof HTMLSelectElement;
    // Some layouts type the brackets with AltGr (Ctrl+Alt) or Option.
    if (!e.metaKey && (e.key === "[" || e.key === "]")) {
      if (control) return;
      this.setBrushRadius(this.brushRadius + (e.key === "]" ? 1 : -1));
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === "z") this.undoOrRedo(e.shiftKey);
    else if (key === "y") this.undoOrRedo(true);
    else return;
    e.preventDefault();
  }

  // ---- Test play ----

  private onPlay(): void {
    const playable = this.doc?.nations.filter((n) => n.playable) ?? [];
    if (playable.length === 1) void this.testPlay(playable[0].id);
    else this.playMenu = !this.playMenu;
  }

  /**
   * Plays the document as a singleplayer game, as `nationID`, from a bundle
   * exported in memory (docs/ScenarioEditor.md, "Test play from the
   * editor"). Leaving the game loads the page again on this draft, so the
   * draft is saved first; the undo history doesn't survive it.
   */
  private async testPlay(nationID: string): Promise<void> {
    const editor = this.editor;
    const worker = this.session?.worker ?? null;
    const id = this.draftId;
    if (editor === null || worker === null || id === null) return;
    if (this.status !== "ready" || this.starting) return;
    this.endStroke();
    this.playMenu = false;
    this.starting = true;
    try {
      await scenarioDrafts.save(id, editor.doc);
      const bundle = await exportScenario(
        editor.doc,
        (c) => worker.editorCommand(c),
        // Unpublished: the draft's id, and no version yet.
        { scenario: { id, version: 0 }, gitCommit: ClientEnv.gitCommit() },
      );
      const usernameInput = document.querySelector(
        "username-input",
      ) as UsernameInput | null;
      const name = usernameInput?.resolvedName() ?? fallbackPlayerName();
      const detail = await scenarioGameStart(bundle, nationID, {
        username: name.name,
        clanTag: usernameInput?.getClanTag() ?? null,
      });
      if (this.abort.signal.aborted) return;
      returnFromGameTo(scenarioEditorHash(id));
      this.dispatchEvent(
        new CustomEvent("join-lobby", {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    } catch (e) {
      console.error("scenario editor: test play failed:", e);
      void showInGameAlert(translateText("scenario_editor.play_failed"));
    } finally {
      this.starting = false;
    }
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
      // At most one terrain edit a frame, however often the pointer moves.
      if (this.stroke?.confirmed) this.stroke.brush.flush();
      this.placeBrushPreview(canvas);
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
    // A stroke still open is dropped with the editor it paints through.
    this.stroke = null;
    this.camera = null;
    this.gestures = null;
    // The overlay listens on the bus; a new one leaves the old listeners.
    this.hudBus = new EventBus();
  }

  // ---- Pointer ----

  // With a brush tool, the primary button or a single finger paints.
  // The other buttons and two fingers move the camera, as in pan mode.

  private onPointerDown(e: PointerEvent): void {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const stroke = this.stroke;
    if (stroke !== null) {
      // A second finger: the two pinch. A touch that hasn't painted yet
      // was the start of the pinch, so it paints nothing.
      if (stroke.confirmed) this.endStroke();
      else this.stroke = null;
      this.gestures?.down(stroke.pointerId, stroke.x, stroke.y);
    } else if (
      this.tool !== "pan" &&
      e.button === 0 &&
      this.gestures?.active === false &&
      this.startStroke(e.pointerId, e.pointerType !== "touch", x, y, rect)
    ) {
      return;
    }
    this.gestures?.down(e.pointerId, x, y);
  }

  private startStroke(
    pointerId: number,
    confirmed: boolean,
    x: number,
    y: number,
    rect: DOMRect,
  ): boolean {
    const editor = this.editor;
    // While a test play starts, the draft it plays is already saved, and a
    // stroke still open when the editor is removed would never be.
    if (editor === null || this.status !== "ready" || this.starting) {
      return false;
    }
    const terrain =
      this.terrainKind === "water"
        ? WATER
        : this.terrainKind === "land"
          ? land(this.elevation)
          : IMPASSABLE;
    const brush =
      this.tool === "terrain"
        ? new TerrainStroke(editor, terrain, this.brushRadius)
        : new TerritoryStroke(
            editor,
            this.selectedNation()?.id ?? null,
            this.brushRadius,
          );
    this.stroke = {
      pointerId,
      brush,
      x,
      y,
      startX: x,
      startY: y,
      confirmed,
    };
    this.paint(x, y, rect);
    return true;
  }

  /** Moves the stroke's brush to the tile under (x, y). */
  private paint(x: number, y: number, rect: DOMRect): void {
    const stroke = this.stroke;
    const camera = this.camera;
    if (stroke === null || camera === null) return;
    stroke.x = x;
    stroke.y = y;
    const world = camera.worldAt(x, y, rect.width, rect.height);
    stroke.brush.moveTo(Math.floor(world.x), Math.floor(world.y));
  }

  /** Applies what the stroke has left, as one undo step, and saves. */
  private endStroke(): void {
    const stroke = this.stroke;
    if (stroke === null) return;
    this.stroke = null;
    if (stroke.brush.end()) this.saveDraft();
    this.requestUpdate();
  }

  private onPointerMove(e: PointerEvent): void {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const stroke = this.stroke;
    if (stroke?.pointerId === e.pointerId) {
      if ((e.buttons & 1) !== 0) {
        const { x, y } = this.hover;
        if (Math.hypot(x - stroke.startX, y - stroke.startY) > TOUCH_SLOP) {
          stroke.confirmed = true;
        }
        this.paint(x, y, rect);
        return;
      }
      // The primary button is up but another is held (pointerup waits for
      // the last): the stroke ends and that button moves the camera.
      this.endStroke();
      this.gestures?.down(e.pointerId, this.hover.x, this.hover.y);
    }
    const g = this.gestures;
    if (this.status === "ready" && g?.active === false) {
      this.hudBus.emit(new MouseMoveEvent(e.clientX, e.clientY));
    }
    g?.move(
      e.pointerId,
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
    );
  }

  private onPointerCancel(e: PointerEvent): void {
    // A cancelled touch, as palm rejection sends, is not a lift: if it
    // hasn't painted yet, it paints nothing.
    if (this.stroke?.pointerId === e.pointerId && !this.stroke.confirmed) {
      this.stroke = null;
    }
    this.onPointerUp(e);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.stroke?.pointerId === e.pointerId) this.endStroke();
    this.gestures?.up(e.pointerId);
    // A finger lifted leaves nothing to preview the brush under.
    if (e.pointerType !== "mouse") this.hover = null;
  }

  private setBrushRadius(radius: number): void {
    this.brushRadius = Math.max(0, Math.min(MAX_BRUSH_RADIUS, radius));
  }

  /** Outlines the tiles the brush would paint under the pointer. */
  private placeBrushPreview(canvas: HTMLCanvasElement): void {
    const el = this.brushPreview;
    const camera = this.camera;
    const hover = this.hover;
    if (el === null) return;
    if (this.tool === "pan" || hover === null || camera === null) {
      el.style.display = "none";
      return;
    }
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const world = camera.worldAt(hover.x, hover.y, w, h);
    // The centre tile's centre, on screen; the disc reaches radius + 0.5.
    const cx = (Math.floor(world.x) + 0.5 - camera.x) * camera.zoom + w / 2;
    const cy = (Math.floor(world.y) + 0.5 - camera.y) * camera.zoom + h / 2;
    // A stroke keeps the radius it started with.
    const radius = this.stroke?.brush.radius ?? this.brushRadius;
    const size = (2 * radius + 1) * camera.zoom;
    el.style.display = "block";
    el.style.left = `${cx - size / 2}px`;
    el.style.top = `${cy - size / 2}px`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
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
    // With a brush tool, a double click is two dabs of paint.
    if (this.tool !== "pan") return;
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
          class="absolute inset-0 touch-none ${
            this.tool === "pan"
              ? "cursor-grab active:cursor-grabbing"
              : "cursor-crosshair"
          }"
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
          @pointercancel=${this.onPointerCancel}
          @pointerleave=${() => (this.hover = null)}
          @wheel=${this.onWheel}
          @dblclick=${this.onDoubleClick}
          @contextmenu=${(e: Event) => {
            // The right button pans while a brush tool is out.
            if (this.tool !== "pan") e.preventDefault();
          }}
        ></div>
        ${
          this.status === "ready"
            ? html`
                <!-- The frame loop places it (placeBrushPreview). -->
                <div
                  id="scenario-editor-brush"
                  class="pointer-events-none absolute hidden rounded-full border border-white/80 shadow-[0_0_0_1px_rgba(0,0,0,0.6)]"
                ></div>
              `
            : nothing
        }
        <!-- Its offset puts the hover card below the bar. -->
        <player-info-overlay
          style="--game-health-offset: 3.5rem"
        ></player-info-overlay>
        ${this.status === "ready" ? this.renderBar() : nothing}
        ${this.status === "ready" ? this.renderTools() : nothing}
        ${this.status === "ready" ? this.renderNations() : nothing}
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
                max: MAX_SIDE.toLocaleString(),
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
                    max: MAX_SIDE.toLocaleString(),
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
        <button
          class="${button} ml-auto"
          aria-expanded=${this.playMenu}
          ?disabled=${this.starting}
          @click=${() => this.onPlay()}
        >
          ${translateText(
            this.starting ? "scenario_editor.starting" : "scenario_editor.play",
          )}
        </button>
        <a class=${button} href=${homeHref()}>
          ${translateText("scenario_editor.exit")}
        </a>
      </div>
      ${this.playMenu ? this.renderPlayMenu() : nothing}
    `;
  }

  /** The playable nations to test play as, or why there are none. */
  private renderPlayMenu() {
    const playable = this.doc!.nations.filter((n) => n.playable);
    const button =
      "rounded bg-zinc-700 px-2 py-1 hover:bg-zinc-600 disabled:opacity-50";
    return html`
      <div
        class="absolute top-14 left-1/2 flex max-h-[calc(100%-4.5rem)] w-64 -translate-x-1/2 flex-col gap-2 overflow-y-auto rounded-lg bg-zinc-900/90 p-3 text-sm"
      >
        ${
          playable.length === 0
            ? html`<p>${translateText("scenario_editor.play_no_playable")}</p>`
            : html`
                <h2 class="font-semibold">
                  ${translateText("scenario_editor.play_as")}
                </h2>
                <ul class="flex flex-col gap-1">
                  ${playable.map(
                    (n) =>
                      html`<li>
                        <button
                          class="${button} w-full truncate text-left"
                          @click=${() => void this.testPlay(n.id)}
                        >
                          ${n.name}
                        </button>
                      </li>`,
                  )}
                </ul>
              `
        }
        <button class=${button} @click=${() => (this.playMenu = false)}>
          ${translateText("common.cancel")}
        </button>
      </div>
    `;
  }

  private renderTools() {
    const editor = this.editor!;
    const button =
      "rounded px-2 py-1 disabled:opacity-50 aria-pressed:bg-blue-600 bg-zinc-700 hover:bg-zinc-600 aria-pressed:hover:bg-blue-500";
    const choice = <T>(value: T, current: T, label: string, pick: () => void) =>
      html`<button
        class="${button} flex-1"
        aria-pressed=${value === current}
        @click=${pick}
      >
        ${translateText(label)}
      </button>`;
    const tool = (t: Tool, label: string) =>
      choice(t, this.tool, label, () => (this.tool = t));
    const kind = (k: TerrainKind, label: string) =>
      choice(k, this.terrainKind, label, () => (this.terrainKind = k));
    return html`
      <div
        class="absolute bottom-2 left-2 flex w-64 flex-col gap-2 rounded-lg bg-zinc-900/90 p-3 text-sm ${this.starting ? "opacity-50" : ""}"
        ?inert=${this.starting}
      >
        <div class="flex gap-1">
          ${tool("pan", "scenario_editor.tool_pan")}
          ${tool("terrain", "scenario_editor.tool_terrain")}
          ${tool("territory", "scenario_editor.tool_territory")}
        </div>
        <div class="flex gap-1">
          <button
            class="${button} flex-1"
            ?disabled=${!editor.canUndo()}
            @click=${() => this.undoOrRedo(false)}
          >
            ${translateText("scenario_editor.undo")}
          </button>
          <button
            class="${button} flex-1"
            ?disabled=${!editor.canRedo()}
            @click=${() => this.undoOrRedo(true)}
          >
            ${translateText("scenario_editor.redo")}
          </button>
        </div>
        ${
          this.tool === "terrain"
            ? html`
                <div class="flex gap-1">
                  ${kind("water", "scenario_editor.water")}
                  ${kind("land", "scenario_editor.land")}
                  ${kind("impassable", "scenario_editor.impassable")}
                </div>
                ${
                  this.terrainKind === "land"
                    ? html`<label class="flex flex-col gap-1">
                        ${translateText("scenario_editor.elevation", {
                          value: this.elevation,
                        })}
                        <input
                          type="range"
                          min="0"
                          max=${MAX_ELEVATION}
                          .value=${String(this.elevation)}
                          @input=${(e: Event) =>
                            (this.elevation = Number(
                              (e.target as HTMLInputElement).value,
                            ))}
                        />
                      </label>`
                    : nothing
                }
              `
            : nothing
        }
        ${
          this.tool !== "pan"
            ? html`
                <label
                  class="flex flex-col gap-1"
                  title=${translateText("scenario_editor.brush_size_keys")}
                >
                  ${translateText("scenario_editor.brush_size", {
                    value: this.brushRadius,
                  })}
                  <input
                    type="range"
                    min="0"
                    max=${MAX_BRUSH_RADIUS}
                    .value=${String(this.brushRadius)}
                    @input=${(e: Event) =>
                      this.setBrushRadius(
                        Number((e.target as HTMLInputElement).value),
                      )}
                  />
                </label>
              `
            : nothing
        }
      </div>
    `;
  }

  /**
   * The nations: picking one makes it what the territory brush paints, or
   * nobody to erase, and the picked one's fields are edited below the list.
   */
  private renderNations() {
    const doc = this.doc!;
    const selected = this.selectedNation();
    const button =
      "rounded px-2 py-1 disabled:opacity-50 aria-pressed:bg-blue-600 bg-zinc-700 hover:bg-zinc-600 aria-pressed:hover:bg-blue-500";
    const pick = (id: string | null, label: string) =>
      html`<li>
        <button
          class="${button} w-full truncate text-left"
          aria-pressed=${(selected?.id ?? null) === id}
          @click=${() => (this.nationId = id)}
        >
          ${label}
        </button>
      </li>`;
    return html`
      <!-- Inert while a test play starts, whose export reads the document:
           applyEdit ignores edits then, and an input mustn't show one. -->
      <div
        class="absolute top-14 right-2 flex max-h-[calc(100%-4.5rem)] w-64 flex-col gap-2 overflow-y-auto rounded-lg bg-zinc-900/90 p-3 text-sm ${this.starting ? "opacity-50" : ""}"
        ?inert=${this.starting}
      >
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-semibold">
            ${translateText("scenario_editor.nations", {
              count: doc.nations.length,
              max: MAX_NATIONS,
            })}
          </h2>
          <button
            class=${button}
            ?disabled=${doc.nations.length >= MAX_NATIONS}
            @click=${() => this.addNation()}
          >
            ${translateText("scenario_editor.add_nation")}
          </button>
        </div>
        <ul class="flex max-h-60 shrink-0 flex-col gap-1 overflow-y-auto">
          ${pick(null, translateText("scenario_editor.nobody"))}
          ${doc.nations.map((n) => pick(n.id, n.name))}
        </ul>
        ${selected === null ? nothing : this.renderNation(selected)}
      </div>
    `;
  }

  private renderNation(n: ScenarioNation) {
    const input = "rounded bg-zinc-800 px-2 py-1 text-white";
    const target = (e: Event) => e.target as HTMLInputElement;
    const flags =
      n.flag === null || FLAGS.some((c) => c.code === n.flag)
        ? FLAGS
        : [{ code: n.flag, name: n.flag }, ...FLAGS];
    return html`
      <div class="flex flex-col gap-2 border-t border-zinc-700 pt-2">
        <label class="flex flex-col gap-1">
          ${translateText("scenario_editor.name")}
          <input
            class=${input}
            maxlength="64"
            .value=${live(n.name)}
            @change=${(e: Event) =>
              this.setNation(n, { name: target(e).value.trim() })}
          />
        </label>
        <label class="flex flex-col gap-1">
          ${translateText("scenario_editor.flag")}
          <select
            class=${input}
            @change=${(e: Event) =>
              this.setNation(n, {
                flag: (e.target as HTMLSelectElement).value || null,
              })}
          >
            <option value="" .selected=${n.flag === null}>
              ${translateText("scenario_editor.no_flag")}
            </option>
            ${flags.map(
              (c) =>
                html`<option value=${c.code} .selected=${c.code === n.flag}>
                  ${c.name}
                </option>`,
            )}
          </select>
        </label>
        <label class="flex flex-col gap-1">
          ${translateText("scenario_editor.troops")}
          <input
            type="number"
            min="0"
            step="1"
            class=${input}
            .value=${live(String(n.troops))}
            @change=${(e: Event) =>
              this.setNation(n, { troops: target(e).valueAsNumber })}
          />
        </label>
        <label class="flex flex-col gap-1">
          ${translateText("scenario_editor.gold")}
          <input
            type="number"
            min="0"
            step="1"
            class=${input}
            .value=${live(String(n.gold))}
            @change=${(e: Event) =>
              this.setNation(n, { gold: target(e).valueAsNumber })}
          />
        </label>
        <label
          class="flex items-center gap-2"
          title=${translateText("scenario_editor.playable_hint")}
        >
          <input
            type="checkbox"
            .checked=${live(n.playable)}
            @change=${(e: Event) =>
              this.setNation(n, { playable: target(e).checked })}
          />
          ${translateText("scenario_editor.playable")}
        </label>
        <button
          class="rounded bg-red-700 px-2 py-1 hover:bg-red-600"
          @click=${() => this.applyEdit({ type: "remove_nation", id: n.id })}
        >
          ${translateText("scenario_editor.remove_nation")}
        </button>
      </div>
    `;
  }
}
