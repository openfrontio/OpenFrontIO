import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { dispatchUiAction, dispatchUiSnapshot, initDioxusRuntime } from "../../UiRuntimeBridge";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import {
  ReplaySpeedChangeEvent,
  ShowSettingsModalEvent,
} from "../../InputHandler";
import { PauseGameIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_EVENTS,
  UI_RUNTIME_SNAPSHOTS,
} from "../../runtime/UiRuntimeProtocol";
import { subscribeUiRuntimeEvents } from "../../runtime/UiRuntimeEventRouter";
import { parseUiRuntimePayload } from "../../runtime/UiRuntimeParsing";
import { Layer } from "./Layer";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../utilities/ReplaySpeedMultiplier";

import FastForwardIconSolid from "/images/FastForwardIconSolidWhite.svg?url";
import exitIcon from "/images/ExitIconWhite.svg?url";
import pauseIcon from "/images/PauseIconWhite.svg?url";
import playIcon from "/images/PlayIconWhite.svg?url";
import settingsIcon from "/images/SettingIconWhite.svg?url";

function dispatchInGameRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): void {
  if (!dispatchUiAction({ type: actionType, payload })) {
    console.warn(
      "[ReplayAndRightSidebarBridge] Failed to dispatch runtime action:",
      actionType,
    );
  }
}

export class ShowReplayPanelEvent {
  constructor(
    public visible: boolean = true,
    public isSingleplayer: boolean = false,
  ) {}
}

@customElement("dioxus-replay-panel")
export class DioxusReplayPanel extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state() private isLaunched = false;

  private visible: boolean = false;
  private isSingleplayer: boolean = false;
  private _replaySpeedMultiplier: number = defaultReplaySpeedMultiplier;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [UI_RUNTIME_EVENTS.uiInGameReplayPanelSpeed],
      (event) => {
        const payload = parseUiRuntimePayload(event.payload);
        const index = payload.index;
        if (typeof index === "number") {
          this.handleSpeedChange(index);
        }
      },
    );
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(UI_RUNTIME_ACTIONS.uiInGameReplayPanelLaunch);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      console.error("[DioxusReplayPanel] Failed to launch:", err);
    }
  }

  private handleSpeedChange = (index: number) => {
    const speeds: ReplaySpeedMultiplier[] = [
      ReplaySpeedMultiplier.slow,
      ReplaySpeedMultiplier.normal,
      ReplaySpeedMultiplier.fast,
      ReplaySpeedMultiplier.fastest,
    ];
    if (index >= 0 && index < speeds.length) {
      this._replaySpeedMultiplier = speeds[index];
      this.eventBus?.emit(new ReplaySpeedChangeEvent(speeds[index]));
    }
  };

  init() {
    if (this.eventBus) {
      this.eventBus.on(ShowReplayPanelEvent, (event: ShowReplayPanelEvent) => {
        this.visible = event.visible;
        this.isSingleplayer = event.isSingleplayer;
      });
    }
  }

  tick() {
    if (!this.isLaunched || !this.visible) return;
    if (!this.game) return;

    const currentTick = this.game.ticks();
    if (currentTick % 10 === 0) {
      const speeds: ReplaySpeedMultiplier[] = [
        ReplaySpeedMultiplier.slow,
        ReplaySpeedMultiplier.normal,
        ReplaySpeedMultiplier.fast,
        ReplaySpeedMultiplier.fastest,
      ];
      let selectedSpeed = 1;
      for (let i = 0; i < speeds.length; i++) {
        if (this._replaySpeedMultiplier === speeds[i]) {
          selectedSpeed = i;
          break;
        }
      }

      const state = {
        is_visible: this.visible,
        label: this.game.config().isReplay()
          ? translateText("replay_panel.replay_speed")
          : translateText("replay_panel.game_speed"),
        selected_speed: selectedSpeed,
        speed_labels: [
          "\u00d70.5",
          "\u00d71",
          "\u00d72",
          translateText("replay_panel.fastest_game_speed"),
        ],
      };

      if (
        !dispatchUiSnapshot({
          type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameReplayPanel,
          scope: "ingame",
          tick: currentTick,
          payload: { state },
        })
      ) {
        console.warn("[DioxusReplayPanel] Failed to dispatch runtime snapshot");
      }
    }
  }

  shouldTransform(): boolean {
    return false;
  }

  renderLayer(_ctx: CanvasRenderingContext2D) {}

  render() {
    return html`
      <div
        id="dioxus-replay-panel-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-replay-panel": DioxusReplayPanel;
  }
}

@customElement("dioxus-game-right-sidebar")
export class DioxusGameRightSidebar extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state() private isLaunched = false;

  private _isSinglePlayer: boolean = false;
  private _isReplayVisible: boolean = false;
  private _isVisible: boolean = true;
  private isPaused: boolean = false;
  private timer: number = 0;
  private hasWinner: boolean = false;
  private isLobbyCreator: boolean = false;
  private runtimeUnsubscribe?: () => void;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.launchDioxusComponent();
    this.runtimeUnsubscribe ??= subscribeUiRuntimeEvents(
      [
        UI_RUNTIME_EVENTS.uiInGameGameRightSidebarReplay,
        UI_RUNTIME_EVENTS.uiInGameGameRightSidebarPause,
        UI_RUNTIME_EVENTS.uiInGameGameRightSidebarSettings,
        UI_RUNTIME_EVENTS.uiInGameGameRightSidebarExit,
      ],
      (event) => {
        if (event.type === UI_RUNTIME_EVENTS.uiInGameGameRightSidebarReplay) {
          this.handleReplayClick();
          return;
        }
        if (event.type === UI_RUNTIME_EVENTS.uiInGameGameRightSidebarPause) {
          this.handlePauseClick();
          return;
        }
        if (event.type === UI_RUNTIME_EVENTS.uiInGameGameRightSidebarSettings) {
          this.handleSettingsClick();
          return;
        }
        if (event.type === UI_RUNTIME_EVENTS.uiInGameGameRightSidebarExit) {
          this.handleExitClick();
        }
      },
    );
  }

  disconnectedCallback() {
    this.runtimeUnsubscribe?.();
    this.runtimeUnsubscribe = undefined;
    super.disconnectedCallback();
  }

  private async launchDioxusComponent() {
    try {
      await initDioxusRuntime();
      await this.updateComplete;
      dispatchInGameRuntimeAction(
        UI_RUNTIME_ACTIONS.uiInGameGameRightSidebarLaunch,
      );
      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isLaunched = true;
    } catch (err) {
      console.error("[DioxusGameRightSidebar] Failed to launch:", err);
    }
  }

  init() {
    this._isSinglePlayer =
      this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this._isVisible = true;
  }

  tick() {
    if (!this.isLaunched || !this.game) return;
    const currentTick = this.game.ticks();

    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }

    if (!this.isLobbyCreator && this.game.myPlayer()?.isLobbyCreator()) {
      this.isLobbyCreator = true;
    }

    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    if (maxTimerValue !== undefined) {
      if (this.game.inSpawnPhase()) {
        this.timer = maxTimerValue * 60;
      } else if (!this.hasWinner && currentTick % 10 === 0) {
        this.timer = Math.max(0, this.timer - 1);
      }
    } else if (this.game.inSpawnPhase()) {
      this.timer = 0;
    } else if (!this.hasWinner && currentTick % 10 === 0) {
      this.timer++;
    }

    const isReplayOrSingleplayer =
      this._isSinglePlayer || this.game?.config()?.isReplay();

    const state = {
      isVisible: this._isVisible,
      timerText: this.secondsToHms(this.timer),
      timerRed: maxTimerValue !== undefined && this.timer < 60,
      showReplayButton: isReplayOrSingleplayer,
      showPauseButton: isReplayOrSingleplayer || this.isLobbyCreator,
      isPaused: this.isPaused,
      settingsIcon: settingsIcon,
      exitIcon: exitIcon,
      fastForwardIcon: FastForwardIconSolid,
      pauseIcon: pauseIcon,
      playIcon: playIcon,
    };

    if (
      !dispatchUiSnapshot({
        type: UI_RUNTIME_SNAPSHOTS.uiSnapshotInGameGameRightSidebar,
        scope: "ingame",
        tick: currentTick,
        payload: { state },
      })
    ) {
      console.warn(
        "[DioxusGameRightSidebar] Failed to dispatch runtime snapshot",
      );
    }
  }

  private secondsToHms = (d: number): string => {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);

    const h = Math.floor(d / 3600);
    const m = Math.floor((d % 3600) / 60);
    const s = Math.floor((d % 3600) % 60);

    if (h !== 0) {
      return `${pad(h)}:${pad(m)}:${pad(s)}`;
    } else {
      return `${pad(m)}:${pad(s)}`;
    }
  };

  private handleReplayClick = () => {
    this._isReplayVisible = !this._isReplayVisible;
    this.eventBus.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  };

  private handlePauseClick = () => {
    this.isPaused = !this.isPaused;
    this.eventBus.emit(new PauseGameIntentEvent(this.isPaused));
  };

  private handleSettingsClick = () => {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
  };

  private handleExitClick = () => {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(translateText("help_modal.exit_confirmation"));
      if (!isConfirmed) return;
    }
    crazyGamesSDK.gameplayStop().then(() => {
      window.location.href = "/";
    });
  };

  shouldTransform(): boolean {
    return false;
  }

  render() {
    return html`
      <div
        id="dioxus-game-right-sidebar-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-game-right-sidebar": DioxusGameRightSidebar;
  }
}
