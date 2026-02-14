import type { UserMeResponse } from "../../core/ApiSchemas";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe } from "../Api";
import type { JoinLobbyEvent } from "../Main";
import { translateText } from "../Utils";
import {
  dispatchUiAction,
  dispatchUiSnapshot,
  initDioxusRuntime,
} from "../UiRuntimeBridge";
import {
  UI_RUNTIME_ACTIONS,
  UI_RUNTIME_SNAPSHOTS,
} from "../runtime/UiRuntimeProtocol";
import {
  ensureUiApiReadRuntimeStarted,
} from "../runtime/UiApiReadRuntime";
import {
  ensureUiSessionRuntimeStarted,
  reportUiModalState,
  requestUiModalClose,
  UI_SESSION_RUNTIME_EVENTS,
  type UiSessionModalCloseDetail,
} from "../runtime/UiSessionRuntime";
import {
  ensureUiMatchmakingRuntimeStarted,
  requestUiMatchmakingCancel,
  requestUiMatchmakingOpen,
  UI_MATCHMAKING_RUNTIME_EVENTS,
  type UiMatchmakingErrorDetail,
  type UiMatchmakingJoinLobbyDetail,
  type UiMatchmakingStateDetail,
} from "../runtime/UiMatchmakingRuntime";

const MATCHMAKING_MODAL_ID = "matchmaking";

function dispatchProfileRuntimeAction(
  actionType: string,
  payload: Record<string, unknown> = {},
): boolean {
  const dispatched = dispatchUiAction({
    type: actionType,
    payload,
  });
  if (!dispatched) {
    console.warn("[DioxusMatchmakingModal] Failed runtime action:", actionType);
  }
  return dispatched;
}

function dispatchProfileRuntimeSnapshot(
  snapshotType: string,
  payload: Record<string, unknown>,
): boolean {
  const dispatched = dispatchUiSnapshot({
    type: snapshotType,
    payload,
  });
  if (!dispatched) {
    console.warn("[DioxusMatchmakingModal] Failed runtime snapshot:", snapshotType);
  }
  return dispatched;
}

interface DioxusMatchmakingState {
  isVisible: boolean;
  connected: boolean;
  gameId: string | null;
  elo: string;
}

interface DioxusMatchmakingTranslations {
  title: string;
  eloLabel: string;
  connecting: string;
  searching: string;
  waitingForGame: string;
  back: string;
}

@customElement("dioxus-matchmaking-modal")
export class DioxusMatchmaking extends LitElement {
  @state() private isVisible = false;
  @state() private connected = false;
  @state() private gameID: string | null = null;
  @state() private loading = false;
  @state() private error: string | null = null;

  private elo = "unknown";
  private isWasmLaunched = false;
  private activeRequestId: number | null = null;

  constructor() {
    super();
    document.addEventListener("userMeResponse", (event: Event) => {
      const customEvent = event as CustomEvent;
      if (!customEvent.detail) {
        return;
      }
      const userMeResponse = customEvent.detail as UserMeResponse;
      this.elo =
        userMeResponse.player?.leaderboard?.oneVone?.elo?.toString() ?? "unknown";
      this.pushStateToWasm();
    });
  }

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void ensureUiSessionRuntimeStarted();
    void ensureUiMatchmakingRuntimeStarted();
    document.addEventListener("dioxus-matchmaking-close", this.handleClose);
    window.addEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    window.addEventListener(
      UI_MATCHMAKING_RUNTIME_EVENTS.stateChanged,
      this.handleMatchmakingStateChanged as EventListener,
    );
    window.addEventListener(
      UI_MATCHMAKING_RUNTIME_EVENTS.joinLobby,
      this.handleMatchmakingJoinLobby as EventListener,
    );
    window.addEventListener(
      UI_MATCHMAKING_RUNTIME_EVENTS.error,
      this.handleMatchmakingError as EventListener,
    );
    this.launchDioxus();
  }

  disconnectedCallback() {
    if (this.isVisible) {
      reportUiModalState(MATCHMAKING_MODAL_ID, false);
    }
    void requestUiMatchmakingCancel("disconnect");
    document.removeEventListener("dioxus-matchmaking-close", this.handleClose);
    window.removeEventListener(
      UI_SESSION_RUNTIME_EVENTS.modalClose,
      this.handleSessionModalClose as EventListener,
    );
    window.removeEventListener(
      UI_MATCHMAKING_RUNTIME_EVENTS.stateChanged,
      this.handleMatchmakingStateChanged as EventListener,
    );
    window.removeEventListener(
      UI_MATCHMAKING_RUNTIME_EVENTS.joinLobby,
      this.handleMatchmakingJoinLobby as EventListener,
    );
    window.removeEventListener(
      UI_MATCHMAKING_RUNTIME_EVENTS.error,
      this.handleMatchmakingError as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleSessionModalClose = (
    event: CustomEvent<UiSessionModalCloseDetail>,
  ) => {
    if (!this.isVisible || event.detail?.modal !== MATCHMAKING_MODAL_ID) {
      return;
    }
    this.closeModal("session");
  };

  private handleClose = () => {
    requestUiModalClose(MATCHMAKING_MODAL_ID, "component");
  };

  private handleMatchmakingStateChanged = (
    event: CustomEvent<UiMatchmakingStateDetail>,
  ) => {
    const detail = event.detail;
    if (!detail) {
      return;
    }
    if (this.activeRequestId !== null && detail.requestId !== this.activeRequestId) {
      return;
    }

    this.connected = detail.connected;
    this.gameID = detail.gameId;
    if (detail.phase === "error" && detail.message) {
      this.error = detail.message;
    }
    if (detail.phase === "closed" && !this.isVisible) {
      this.connected = false;
      this.gameID = null;
    }
    this.pushStateToWasm();
  };

  private handleMatchmakingJoinLobby = (
    event: CustomEvent<UiMatchmakingJoinLobbyDetail>,
  ) => {
    const detail = event.detail;
    if (!detail) {
      return;
    }
    if (this.activeRequestId !== null && detail.requestId !== this.activeRequestId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: detail.gameID,
          clientID: detail.clientID,
        } satisfies JoinLobbyEvent,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private handleMatchmakingError = (
    event: CustomEvent<UiMatchmakingErrorDetail>,
  ) => {
    const detail = event.detail;
    if (!detail) {
      return;
    }
    if (this.activeRequestId !== null && detail.requestId !== this.activeRequestId) {
      return;
    }
    this.error = detail.message;
    this.pushStateToWasm();
  };

  private getTranslations(): DioxusMatchmakingTranslations {
    return {
      title: translateText("matchmaking_modal.title"),
      eloLabel: translateText("matchmaking_modal.elo", { elo: this.elo }),
      connecting: translateText("matchmaking_modal.connecting"),
      searching: translateText("matchmaking_modal.searching"),
      waitingForGame: translateText("matchmaking_modal.waiting_for_game"),
      back: translateText("common.back"),
    };
  }

  private buildState(): DioxusMatchmakingState {
    return {
      isVisible: this.isVisible,
      connected: this.connected,
      gameId: this.gameID,
      elo: this.elo,
    };
  }

  private async launchDioxus() {
    try {
      this.loading = true;
      this.error = null;
      this.requestUpdate();

      await initDioxusRuntime();

      this.loading = false;
      this.requestUpdate();
      await this.updateComplete;

      dispatchProfileRuntimeAction(
        UI_RUNTIME_ACTIONS.uiProfileMatchmakingModalLaunch,
        {
          state: this.buildState(),
          translations: this.getTranslations(),
        },
      );

      await new Promise((resolve) => requestAnimationFrame(resolve));
      this.isWasmLaunched = true;
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : "Failed to load Dioxus";
      console.error("[DioxusMatchmaking] Failed to launch:", err);
      this.requestUpdate();
    }
  }

  private pushStateToWasm() {
    if (!this.isWasmLaunched) {
      return;
    }
    dispatchProfileRuntimeSnapshot(
      UI_RUNTIME_SNAPSHOTS.uiSnapshotProfileMatchmakingModalState,
      {
        state: this.buildState(),
      },
    );
  }

  public async open() {
    await ensureUiSessionRuntimeStarted();
    await ensureUiApiReadRuntimeStarted();
    await ensureUiMatchmakingRuntimeStarted();

    const userMe = await getUserMe();
    const isLoggedIn =
      userMe &&
      userMe.user &&
      (userMe.user.discord !== undefined || userMe.user.email !== undefined);
    if (!isLoggedIn) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: translateText("matchmaking_button.must_login"),
            color: "red",
            duration: 3000,
          },
        }),
      );
      return;
    }

    this.error = null;
    this.connected = false;
    this.gameID = null;
    this.isVisible = true;
    reportUiModalState(MATCHMAKING_MODAL_ID, true);
    this.pushStateToWasm();
    this.activeRequestId = await requestUiMatchmakingOpen("open");
  }

  public close() {
    this.closeModal("component");
  }

  private closeModal(reason: string) {
    reportUiModalState(MATCHMAKING_MODAL_ID, false);
    this.isVisible = false;
    this.connected = false;
    this.gameID = null;
    void requestUiMatchmakingCancel(reason);
    this.pushStateToWasm();
    this.requestUpdate();
  }

  render() {
    if (this.loading) {
      return html``;
    }

    if (this.error) {
      return html`
        <div class="text-red-400 text-xs">Error: ${this.error}</div>
      `;
    }

    return html`
      <div
        id="dioxus-matchmaking-modal-root"
        @contextmenu=${(e: Event) => e.preventDefault()}
      ></div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dioxus-matchmaking-modal": DioxusMatchmaking;
  }
}

