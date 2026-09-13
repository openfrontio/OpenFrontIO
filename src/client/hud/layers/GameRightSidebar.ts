import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { createNextLobby } from "../../Api";
import { ClientEnv } from "../../ClientEnv";
import "../../components/DoomsdayClockPanel";
import "../../components/OvertimePanel";
import { Controller } from "../../Controller";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import {
  desktopDisplay,
  DISPLAY_SETTLE_TIMEOUT_MS,
  isDisplaySnapshot,
  type DesktopDisplayBridge,
  type DesktopDisplayMode,
} from "../../DesktopDisplay";
import { showInGameAlert, showInGameConfirm } from "../../InGameModal";
import { TogglePauseIntentEvent } from "../../InputHandler";
import { PauseGameIntentEvent, SendWinnerEvent } from "../../Transport";
import { homeHref, showToast, translateText } from "../../Utils";
import { GameView } from "../../view";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { ShowReplayPanelEvent } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
const exitIcon = assetUrl("images/ExitIconWhite.svg");
const FastForwardIconSolid = assetUrl("images/FastForwardIconSolidWhite.svg");
const pauseIcon = assetUrl("images/PauseIconWhite.svg");
const playIcon = assetUrl("images/PlayIconWhite.svg");
const newLobbyIcon = assetUrl("images/ReplayRegularIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");
const fullscreenIcon = assetUrl("images/FullscreenIconWhite.svg");
const exitFullscreenIcon = assetUrl("images/ExitFullscreenIconWhite.svg");

const LAST_MINUTE_SECONDS = 60;
const FLASH_TIMER_SECONDS = 30;
const FLASH_SIDEBAR_SECONDS = 10;
const ONE_MINUTE_WARNING_DURATION_MS = 4_000;

@customElement("game-right-sidebar")
export class GameRightSidebar extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  @state()
  private _isSinglePlayer: boolean = false;

  @state()
  private _isReplayVisible: boolean = false;

  @state()
  private _isVisible: boolean = true;

  @state()
  private isPaused: boolean = false;

  @state()
  private isFullscreen: boolean = false;

  // The desktop shell's window mode, or null when there is no shell to ask.
  // On the desktop this REPLACES `isFullscreen` as the button's truth: the
  // shell owns the window, and HTML fullscreen is not what the button does
  // there any more.
  @state()
  private displayMode: DesktopDisplayMode | null = null;

  // Captured once per mount rather than read per click, so one mount cannot
  // answer "desktop" to the click and "web" to the icon.
  private displayBridge: DesktopDisplayBridge | null = null;
  private displayUnsubscribe: (() => void) | null = null;

  // True between sending a mode change and the shell answering. A mode change
  // is a window transition, so a double-click would otherwise queue a second
  // one that lands mid-flight and leaves the window where it started.
  private displayBusy = false;

  // The ceiling on that guard. Without it a bridge that answers neither the
  // invoke nor the push disables the button for the rest of the match, and in
  // borderless the button is one of the few ways back to a titled window.
  private displayCeilingTimer: ReturnType<typeof setTimeout> | undefined;

  // Which write is the live one. Bumped on every click, on every push that
  // settles a write, and on teardown; mirrors displayRequestId in the Display
  // tab.
  //
  // A boolean alone is not enough once the ceiling exists. When a write
  // outlives its ceiling the button is handed back, so a SECOND write can
  // start while the first is still pending -- and when the first finally
  // answers it would otherwise adopt its now-stale snapshot, clear the second
  // write's timer, and release the guard on the second write's behalf,
  // letting a third click overlap it. Everything below no-ops unless it owns
  // the current operation.
  private displayOperation = 0;

  @state()
  private timer: number = 0;

  // CrazyGames provides its own fullscreen control in the game frame, so hide ours.
  private readonly onCrazyGames = crazyGamesSDK.isOnCrazyGames();
  private hasWinner = false;
  private isLobbyCreator = false;
  private isPrivateLobby = false;
  private hasShownOneMinuteWarning = false;
  // Guards the in-game "New lobby" button so a double click doesn't fire twice
  // before we navigate to the successor lobby.
  private newLobbyRequested = false;
  private spawnBarVisible = false;
  private immunityBarVisible = false;

  createRenderRoot() {
    // Stack the timer bar + doomsday-clock readout, centers aligned (the narrower
    // one sits centered under the wider one).
    this.style.display = "flex";
    this.style.flexDirection = "column";
    this.style.alignItems = "center";
    this.style.gap = "6px";
    return this;
  }

  init() {
    this._isSinglePlayer =
      this.game?.config()?.gameConfig()?.gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this.isPrivateLobby =
      this.game?.config()?.gameConfig()?.gameType === GameType.Private;
    this._isVisible = true;
    this.hasShownOneMinuteWarning = false;

    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
      this.updateParentOffset();
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
      this.updateParentOffset();
    });

    this.eventBus.on(SendWinnerEvent, () => {
      this.hasWinner = true;
      this.requestUpdate();
    });

    this.eventBus.on(TogglePauseIntentEvent, () => {
      const isReplayOrSingleplayer =
        this._isSinglePlayer || this.game?.config()?.isReplay();
      if (
        isReplayOrSingleplayer ||
        (this.isLobbyCreator && !this.game.config().listed)
      ) {
        this.onPauseButtonClick();
      }
    });

    this.requestUpdate();
  }

  private onFullscreenChange = () => {
    this.isFullscreen = !!document.fullscreenElement;
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    this.connectDisplayBridge();
    this.onFullscreenChange();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.disconnectDisplayBridge();
  }

  // ---- Desktop shell window mode ----
  //
  // Feature-detected, never version-parsed: desktopDisplay() is null on the
  // web and on any shell older than the display bridge, and both of those
  // keep the HTML-fullscreen behaviour below completely unchanged.

  private connectDisplayBridge(): void {
    const bridge = desktopDisplay();
    this.displayBridge = bridge;
    if (bridge === null) return;
    // Guarded like every other async path here. This one is the slowest to
    // matter and the easiest to miss: if the player toggles (or F11 pushes)
    // while the mount read is still in flight, the toggle updates displayMode
    // and then this read resolves and puts the PRE-toggle value back, leaving
    // the icon wrong until something else arrives. The same check stops a slow
    // read writing to an element disconnectDisplayBridge has already torn down.
    const operation = this.displayOperation;
    // Called through Promise.resolve() so that a bridge which THROWS rather
    // than rejecting cannot escape connectedCallback and abort the whole HUD
    // mount. The bridge is implemented in a separate repository on its own
    // release schedule, so "it returns a promise" is a claim about it, not a
    // guarantee -- and the failure mode has to be a dead button, never a
    // missing sidebar.
    void Promise.resolve()
      .then(() => bridge.getPrefs())
      .then(
        (snapshot) => {
          if (operation !== this.displayOperation) return;
          this.adoptDisplaySnapshot(snapshot);
        },
        // No state change: the icon keeps whatever it had until a snapshot we
        // can actually read turns up.
        () => undefined,
      );
    if (typeof bridge.subscribe !== "function") return;
    try {
      this.displayUnsubscribe = bridge.subscribe((snapshot) => {
        // A push settles a pending write, the same way it does in the Display
        // tab. The shell emits it as part of applying a change, so by the time
        // one arrives the transition has happened whether or not the invoke
        // ever answers -- and waiting out the ceiling after that would leave
        // the button disabled for up to two seconds with nothing left to wait
        // for. Guarded on a READABLE snapshot: adoptDisplaySnapshot drops what
        // it cannot parse, and an unparseable push is not evidence of
        // anything.
        if (!isDisplaySnapshot(snapshot)) return;
        // Settling retires the write, so anything it still had in flight is
        // answering a question already resolved.
        this.displayOperation++;
        this.adoptDisplaySnapshot(snapshot);
        this.clearDisplayCeiling();
        this.displayBusy = false;
      });
    } catch {
      this.displayUnsubscribe = null;
    }
  }

  private disconnectDisplayBridge(): void {
    const unsubscribe = this.displayUnsubscribe;
    this.displayUnsubscribe = null;
    this.displayBridge = null;
    this.displayBusy = false;
    this.displayOperation++;
    this.clearDisplayCeiling();
    try {
      unsubscribe?.();
    } catch {
      // Leaving a match must not fail because the shell's unsubscribe did.
    }
  }

  private adoptDisplaySnapshot(snapshot: unknown): void {
    if (!isDisplaySnapshot(snapshot)) return;
    this.displayMode = snapshot.prefs.mode;
  }

  /**
   * Bounds how long a click may leave the button disabled -- the same
   * treatment the Display tab gives its selects, and for the same reason: the
   * shell answers both the invoke and the push, so this only fires when
   * neither arrived, and "waiting" must never become "dead for the match".
   */
  private armDisplayCeiling(operation: number): void {
    this.clearDisplayCeiling();
    // No ownership check on the callback itself: every path that starts a new
    // operation clears this timer first, so a stale one cannot fire. The check
    // belongs on the re-read below, which CAN outlive the operation that asked
    // for it.
    this.displayCeilingTimer = setTimeout(() => {
      this.displayCeilingTimer = undefined;
      // Re-enabled BEFORE the re-read, not after it: the ceiling has to hold
      // even when getPrefs never answers either.
      this.displayBusy = false;
      const bridge = this.displayBridge;
      if (bridge === null) return;
      void Promise.resolve()
        .then(() => bridge.getPrefs())
        .then(
          (snapshot) => {
            if (operation !== this.displayOperation) return;
            this.adoptDisplaySnapshot(snapshot);
          },
          () => undefined,
        );
    }, DISPLAY_SETTLE_TIMEOUT_MS);
  }

  private clearDisplayCeiling(): void {
    if (this.displayCeilingTimer === undefined) return;
    clearTimeout(this.displayCeilingTimer);
    this.displayCeilingTimer = undefined;
  }

  /**
   * What the button is offering: true when it would LEAVE a filled screen.
   *
   * On the desktop that is the SHELL's window mode, and `isFullscreen` is
   * deliberately not consulted. The clan map and anything else that calls
   * requestFullscreen still fires `fullscreenchange` there, and repainting
   * this icon from it would report a mode the window is not in.
   */
  private get showingFilledScreen(): boolean {
    return this.displayBridge !== null
      ? this.displayMode === "borderless"
      : this.isFullscreen;
  }

  getTickIntervalMs() {
    return 250;
  }

  tick() {
    // Timer logic
    // Check if the player is the lobby creator
    if (!this.isLobbyCreator && this.game.myPlayer()?.isLobbyCreator()) {
      this.isLobbyCreator = true;
      this.requestUpdate();
    }

    if (this.game.inSpawnPhase()) {
      // Singleplayer has no spawn timer (SpawnTimerExecution isn't added), so
      // the spawn phase doesn't count down — keep the old static display.
      if (this.game.config().gameConfig().gameType === GameType.Singleplayer) {
        const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
        this.timer =
          maxTimerValue !== null && maxTimerValue !== undefined
            ? maxTimerValue * 60
            : 0;
        return;
      }
      const spawnPhaseDurationTicks = this.game.config().numSpawnPhaseTurns();
      const currentTicks = this.game.ticks();
      const remainingTicks = spawnPhaseDurationTicks - currentTicks;
      const remainingSeconds = Math.ceil(remainingTicks / 10);
      this.timer = Math.max(0, remainingSeconds);
      return;
    }

    const elapsedSeconds = Math.floor(this.game.elapsedGameSeconds());

    if (this.hasWinner) {
      return;
    }

    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    if (maxTimerValue !== null && maxTimerValue !== undefined) {
      this.timer = Math.max(0, maxTimerValue * 60 - elapsedSeconds);
      this.maybeShowOneMinuteWarning();
    } else {
      this.timer = elapsedSeconds;
    }
  }

  // Handing the notice to the heads-up toast layer means that layer owns the
  // dismissal timer, so there's nothing for us to tear down on disconnect or
  // when the game ends.
  private maybeShowOneMinuteWarning(): void {
    if (
      !this.hasWinner &&
      !this.game.inSpawnPhase() &&
      this.timer > 0 &&
      this.timer <= LAST_MINUTE_SECONDS &&
      !this.hasShownOneMinuteWarning
    ) {
      this.hasShownOneMinuteWarning = true;
      showToast(
        translateText("game_timer.one_minute_remaining"),
        "red",
        ONE_MINUTE_WARNING_DURATION_MS,
      );
    }
  }

  private updateParentOffset(): void {
    const offset =
      (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
    const parent = this.parentElement as HTMLElement;
    if (parent) {
      parent.style.marginTop = `${offset}px`;
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

  private toggleReplayPanel(): void {
    this._isReplayVisible = !this._isReplayVisible;
    this.eventBus.emit(
      new ShowReplayPanelEvent(this._isReplayVisible, this._isSinglePlayer),
    );
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      crazyGamesSDK.gameplayStop();
    } else {
      crazyGamesSDK.gameplayStart();
    }
    this.eventBus.emit(new PauseGameIntentEvent(this.isPaused));
  }

  private async onNewLobbyButtonClick() {
    if (this.newLobbyRequested) return;
    // Confirm so a stray click next to pause/exit doesn't yank everyone into a
    // new lobby mid-game.
    const isConfirmed = await showInGameConfirm(
      translateText("new_lobby_prompt.confirm"),
      { variant: "warning" },
    );
    if (!isConfirmed) return;
    if (this.newLobbyRequested) return; // clicked again while confirming
    this.newLobbyRequested = true;
    this.requestUpdate();
    try {
      // The worker mints the successor lobby and has the current game
      // broadcast its id, so everyone else gets the NewLobbyPrompt. We (the
      // host) navigate straight to the new host view from the response.
      const lobby = await createNextLobby(this.game.gameID());
      const id = lobby.gameID;
      // ?host routes the creator back into the host view on load.
      window.location.href = `${window.location.origin}/${ClientEnv.workerPath(id)}/game/${id}?host`;
    } catch (error) {
      console.error("Failed to create successor lobby", error);
      this.newLobbyRequested = false;
      this.requestUpdate();
      void showInGameAlert(translateText("new_lobby_prompt.failed"));
    }
  }

  private async onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = await showInGameConfirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    await crazyGamesSDK.requestMidgameAd();
    await crazyGamesSDK.gameplayStop();
    // redirect to the home page
    window.location.href = homeHref();
  }

  private onSettingsButtonClick() {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
  }

  private onFullscreenButtonClick() {
    const bridge = this.displayBridge;
    if (bridge !== null) {
      // Toggling the SHELL's window mode rather than the document's
      // fullscreen state. Calling requestFullscreen here would put the
      // Electron window into a fullscreen state the shell's stored preference
      // knows nothing about -- the last remaining way this client could
      // desync it, and the reason the shell carries a
      // leave-html-full-screen backstop at all.
      // One transition at a time. Unlike the Display tab there is no control
      // to disable here -- it is a single icon -- so the guard is the whole
      // of the protection against an impatient second click.
      if (this.displayBusy) return;
      this.displayBusy = true;
      this.displayOperation++;
      const operation = this.displayOperation;
      this.armDisplayCeiling(operation);
      const next: DesktopDisplayMode =
        this.displayMode === "borderless" ? "windowed" : "borderless";
      // Promise.resolve() for the same reason as the read above: a bridge
      // that throws synchronously must degrade the button, not blow up a
      // click handler in the middle of a match.
      void Promise.resolve()
        .then(() => bridge.setPrefs({ mode: next }))
        .then(
          (snapshot) => {
            if (operation !== this.displayOperation) return;
            this.adoptDisplaySnapshot(snapshot);
          },
          // The icon keeps showing the mode the window is really in. The
          // shell answers a patch it refuses with the current state rather
          // than a rejection, so this is a broken bridge, not a refusal.
          () => undefined,
        )
        .finally(() => {
          if (operation !== this.displayOperation) return;
          this.clearDisplayCeiling();
          this.displayBusy = false;
        });
      return;
    }
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn("Failed to enter fullscreen:", err);
      });
    } else {
      document.exitFullscreen().catch((err) => {
        console.warn("Failed to exit fullscreen:", err);
      });
    }
  }

  render() {
    if (this.game === undefined) return html``;

    const maxTimerValue = this.game.config().gameConfig().maxTimerValue;
    const isEndTimerActive =
      maxTimerValue !== undefined &&
      maxTimerValue !== null &&
      !this.game.inSpawnPhase() &&
      !this.hasWinner &&
      this.timer > 0;
    const isLastMinute = isEndTimerActive && this.timer <= LAST_MINUTE_SECONDS;
    const shouldFlashTimer =
      isEndTimerActive && this.timer <= FLASH_TIMER_SECONDS;
    const shouldFlashSidebar =
      isEndTimerActive && this.timer <= FLASH_SIDEBAR_SECONDS;

    const timerClass = shouldFlashTimer
      ? "game-end-timer-flash"
      : isLastMinute
        ? "game-end-timer-last-minute"
        : "";

    return html`
      <style>
        @keyframes game-end-timer-text-flash {
          0%,
          100% {
            color: rgb(248 113 113);
          }
          50% {
            color: white;
          }
        }
        @keyframes game-end-timer-sidebar-flash {
          0%,
          100% {
            background-color: rgb(0 0 0 / 0.92);
          }
          50% {
            background-color: rgb(185 28 28 / 0.96);
          }
        }
        .game-end-timer-last-minute {
          color: rgb(248 113 113);
        }
        .game-end-timer-flash {
          animation: game-end-timer-text-flash 1s ease-in-out infinite;
        }
        .game-end-timer-sidebar-flash {
          animation: game-end-timer-sidebar-flash 1s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .game-end-timer-flash {
            animation: none;
            color: white;
          }
          .game-end-timer-sidebar-flash {
            animation: none;
            background-color: rgb(185 28 28 / 0.96);
          }
        }
      </style>
      <aside
        class=${`w-fit flex flex-row items-center gap-3 py-2 px-3 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg transition-transform duration-300 ease-out transform text-white ${shouldFlashSidebar ? "game-end-timer-sidebar-flash" : ""} ${
          this._isVisible ? "translate-x-0" : "translate-x-full"
        }`}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <!-- In-game time -->
        <div data-game-timer class=${timerClass}>
          ${this.secondsToHms(this.timer)}
        </div>

        <!-- Buttons -->
        ${this.maybeRenderReplayButtons()}

        <div class="cursor-pointer" @click=${this.onSettingsButtonClick}>
          <img src=${settingsIcon} alt="settings" width="20" height="20" />
        </div>

        ${(document.fullscreenEnabled || this.displayBridge !== null) &&
        !this.onCrazyGames
          ? html`<div
              class="cursor-pointer"
              @click=${this.onFullscreenButtonClick}
            >
              <img
                src=${this.showingFilledScreen
                  ? exitFullscreenIcon
                  : fullscreenIcon}
                alt=${this.showingFilledScreen
                  ? translateText("fullscreen.exit")
                  : translateText("fullscreen.enter")}
                width="20"
                height="20"
              />
            </div>`
          : ""}

        <div class="cursor-pointer" @click=${this.onExitButtonClick}>
          <img src=${exitIcon} alt="exit" width="20" height="20" />
        </div>
      </aside>
      <doomsday-clock-panel
        .game=${this.game}
        .hasWinner=${this.hasWinner}
        .refreshKey=${this.timer}
      ></doomsday-clock-panel>
      <overtime-panel
        .game=${this.game}
        .hasWinner=${this.hasWinner}
        .refreshKey=${this.timer}
      ></overtime-panel>
    `;
  }

  maybeRenderReplayButtons() {
    const isReplayOrSingleplayer =
      this._isSinglePlayer || this.game?.config()?.isReplay();
    const showPauseButton =
      isReplayOrSingleplayer ||
      (this.isLobbyCreator && !this.game.config().listed);
    // The host of a private lobby can start a fresh lobby at any time, without
    // waiting to die or for the game to end.
    const showNewLobbyButton = this.isLobbyCreator && this.isPrivateLobby;

    return html`
      ${isReplayOrSingleplayer
        ? html`
            <div class="cursor-pointer" @click=${this.toggleReplayPanel}>
              <img
                src=${FastForwardIconSolid}
                alt="replay"
                width="20"
                height="20"
              />
            </div>
          `
        : ""}
      ${showPauseButton
        ? html`
            <div class="cursor-pointer" @click=${this.onPauseButtonClick}>
              <img
                src=${this.isPaused ? playIcon : pauseIcon}
                alt="play/pause"
                width="20"
                height="20"
              />
            </div>
          `
        : ""}
      ${showNewLobbyButton
        ? html`
            <div
              class="cursor-pointer ${this.newLobbyRequested
                ? "opacity-50 pointer-events-none"
                : ""}"
              @click=${this.onNewLobbyButtonClick}
              title=${translateText("win_modal.new_lobby")}
            >
              <img
                src=${newLobbyIcon}
                alt=${translateText("win_modal.new_lobby")}
                width="20"
                height="20"
              />
            </div>
          `
        : ""}
    `;
  }
}
