import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import {
  TERRITORY_RENDERER_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../../core/game/UserSettings";
import { TransformHandler } from "../TransformHandler";
import { ClassicTerritoryBackend } from "./ClassicTerritoryBackend";
import {
  TERRITORY_RENDERER_STATUS_EVENT,
  TerritoryBackend,
  TerritoryRendererId,
  TerritoryRendererStatus,
  selectTerritoryBackend,
  territoryRendererOrder,
} from "./TerritoryBackend";
import { WebGLTerritoryBackend } from "./WebGLTerritoryBackend";
import { WebGPUTerritoryBackend } from "./WebGPUTerritoryBackend";

export class TerritoryLayer implements TerritoryBackend {
  readonly id = "classic";

  private activeBackend: TerritoryBackend | null = null;
  private failedBackends = new Set<TerritoryRendererId>();
  private selectionToken = 0;
  private initialized = false;
  private readonly settingsChanged = () => {
    this.failedBackends.clear();
    this.publishStatus("Retrying renderer selection");
    void this.selectConfiguredBackend();
  };

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private transformHandler: TransformHandler,
    private userSettings: UserSettings,
  ) {}

  profileName(): string {
    return "TerritoryLayer:renderLayer";
  }

  shouldTransform(): boolean {
    return true;
  }

  init() {
    this.initialized = true;
    globalThis.addEventListener?.(
      `${USER_SETTINGS_CHANGED_EVENT}:${TERRITORY_RENDERER_KEY}`,
      this.settingsChanged,
    );

    // Keep the map visible while accelerated renderers initialize.
    this.activateBackend(
      this.createBackend("classic"),
      "Using Classic while accelerated renderer initializes",
    );
    void this.selectConfiguredBackend();
  }

  tick() {
    this.runActive("tick", (backend) => backend.tick?.());
  }

  redraw() {
    if (!this.initialized) {
      return;
    }
    this.runActive("redraw", (backend) => backend.redraw?.());
    void this.selectConfiguredBackend();
  }

  renderLayer(context: CanvasRenderingContext2D) {
    if (!this.activeBackend) {
      return;
    }

    if (this.activeBackend.id !== "webgpu") {
      this.fillBackground(context);
    }

    this.runActive("renderLayer", (backend) => backend.renderLayer?.(context));
  }

  dispose() {
    globalThis.removeEventListener?.(
      `${USER_SETTINGS_CHANGED_EVENT}:${TERRITORY_RENDERER_KEY}`,
      this.settingsChanged,
    );
    this.activeBackend?.dispose?.();
    this.activeBackend = null;
  }

  private async selectConfiguredBackend() {
    const token = ++this.selectionToken;
    const preference = this.userSettings.territoryRenderer();
    const order = territoryRendererOrder(preference, this.failedBackends);
    if (
      this.activeBackend?.id === order[0] &&
      !this.activeBackend.getFailureReason?.()
    ) {
      return;
    }

    const selection = await selectTerritoryBackend(
      preference,
      this.failedBackends,
      (id) => this.createBackend(id),
      () => token === this.selectionToken,
    );

    if (selection.cancelled) {
      return;
    }

    for (const failure of selection.failures) {
      console.warn(
        `[TerritoryLayer] ${failure.id} renderer unavailable: ${failure.reason}`,
        failure.error ?? "",
      );
      if (failure.id !== "classic") {
        this.failedBackends.add(failure.id);
      }
    }

    if (selection.backend !== null) {
      this.activateBackend(selection.backend);
    } else {
      this.publishStatus("No territory renderer is currently available");
    }
  }

  private async initializeCandidate(
    backend: TerritoryBackend,
    token: number,
  ): Promise<boolean> {
    try {
      await backend.init?.();
      if (token !== this.selectionToken) {
        return false;
      }
      if (backend.getFailureReason?.()) {
        console.warn(
          `[TerritoryLayer] ${backend.id} renderer unavailable: ${backend.getFailureReason()}`,
        );
        return false;
      }
      if (backend.whenReady) {
        const ready = await backend.whenReady();
        if (!ready || backend.getFailureReason?.()) {
          console.warn(
            `[TerritoryLayer] ${backend.id} renderer unavailable: ${
              backend.getFailureReason?.() ?? "initialization failed"
            }`,
          );
          return false;
        }
      }
      return true;
    } catch (error) {
      console.warn(
        `[TerritoryLayer] ${backend.id} renderer failed init`,
        error,
      );
      return false;
    }
  }

  private activateBackend(
    backend: TerritoryBackend,
    message: string | null = null,
  ) {
    if (this.activeBackend === backend) {
      return;
    }
    const previous = this.activeBackend;
    this.activeBackend = backend;
    previous?.dispose?.();
    console.info(`[TerritoryLayer] active renderer: ${backend.id}`);
    this.publishStatus(message);
  }

  private runActive(
    operation: "tick" | "redraw" | "renderLayer",
    run: (backend: TerritoryBackend) => void,
  ) {
    const backend = this.activeBackend;
    if (!backend) {
      return;
    }

    try {
      run(backend);
      const reason = backend.getFailureReason?.();
      if (reason) {
        this.handleBackendFailure(backend, `${operation}: ${reason}`);
      }
    } catch (error) {
      this.handleBackendFailure(backend, `${operation}: ${String(error)}`);
    }
  }

  private handleBackendFailure(backend: TerritoryBackend, reason: string) {
    console.warn(`[TerritoryLayer] ${backend.id} renderer failed: ${reason}`);
    if (backend.id !== "classic") {
      this.failedBackends.add(backend.id);
    }
    this.publishStatus(`${backend.id} failed: ${reason}`);
    if (this.activeBackend === backend) {
      this.activeBackend = null;
      backend.dispose?.();
      const classic = this.createBackend("classic");
      void this.initializeCandidate(classic, ++this.selectionToken).then(
        (ready) => {
          if (ready) {
            this.activateBackend(classic);
            void this.selectConfiguredBackend();
          }
        },
      );
    }
  }

  private createBackend(id: TerritoryRendererId): TerritoryBackend {
    if (id === "webgpu") {
      return new WebGPUTerritoryBackend(
        this.game,
        this.eventBus,
        this.transformHandler,
        this.userSettings,
      );
    }
    if (id === "webgl") {
      return new WebGLTerritoryBackend(
        this.game,
        this.eventBus,
        this.transformHandler,
      );
    }
    return new ClassicTerritoryBackend(
      this.game,
      this.eventBus,
      this.transformHandler,
    );
  }

  private fillBackground(context: CanvasRenderingContext2D) {
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = this.game.config().theme().backgroundColor().toHex();
    context.fillRect(0, 0, context.canvas.width, context.canvas.height);
    context.restore();
  }

  private publishStatus(message: string | null = null) {
    const detail: TerritoryRendererStatus = {
      active: this.activeBackend?.id ?? null,
      preference: this.userSettings.territoryRenderer(),
      failedBackends: Array.from(this.failedBackends),
      message,
    };

    globalThis.dispatchEvent?.(
      new CustomEvent(TERRITORY_RENDERER_STATUS_EVENT, { detail }),
    );
  }
}
