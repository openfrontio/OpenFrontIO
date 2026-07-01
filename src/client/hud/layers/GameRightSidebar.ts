import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { GameMode, GameType, PlayerType } from "../../../core/game/Game";
import {
  suddenDeathDrain,
  suddenDeathRequiredTiles,
  suddenDeathWaveState,
} from "../../../core/game/SuddenDeath";
import { Controller } from "../../Controller";
import { crazyGamesSDK } from "../../CrazyGamesSDK";
import { TogglePauseIntentEvent } from "../../InputHandler";
import { PauseGameIntentEvent, SendWinnerEvent } from "../../Transport";
import { renderTroops, translateText } from "../../Utils";
import { GameView } from "../../view";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { ShowReplayPanelEvent } from "./ReplayPanel";
import { ShowSettingsModalEvent } from "./SettingsModal";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
const exitIcon = assetUrl("images/ExitIconWhite.svg");
const FastForwardIconSolid = assetUrl("images/FastForwardIconSolidWhite.svg");
const pauseIcon = assetUrl("images/PauseIconWhite.svg");
const playIcon = assetUrl("images/PlayIconWhite.svg");
const settingsIcon = assetUrl("images/SettingIconWhite.svg");
const fullscreenIcon = assetUrl("images/FullscreenIconWhite.svg");
const exitFullscreenIcon = assetUrl("images/ExitFullscreenIconWhite.svg");
const suddenDeathIcon = assetUrl("images/SuddenDeathSkull.svg");

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

  @state()
  private timer: number = 0;

  private hasWinner = false;
  private isLobbyCreator = false;
  private spawnBarVisible = false;
  private immunityBarVisible = false;

  createRenderRoot() {
    // Stack the timer bar + sudden-death readout, centers aligned (the narrower
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
    this._isVisible = true;

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
      if (isReplayOrSingleplayer || this.isLobbyCreator) {
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
    this.onFullscreenChange();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
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
    } else {
      this.timer = elapsedSeconds;
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

  private async onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    await crazyGamesSDK.requestMidgameAd();
    await crazyGamesSDK.gameplayStop();
    // redirect to the home page
    window.location.href = "/";
  }

  private onSettingsButtonClick() {
    this.eventBus.emit(
      new ShowSettingsModalEvent(true, this._isSinglePlayer, this.isPaused),
    );
  }

  private onFullscreenButtonClick() {
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

    const timerColor =
      this.game.config().gameConfig().maxTimerValue !== undefined &&
      this.game.config().gameConfig().maxTimerValue !== null &&
      this.timer < 60
        ? "text-red-400"
        : "";

    return html`
      <aside
        class=${`w-fit flex flex-row items-center gap-3 py-2 px-3 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg transition-transform duration-300 ease-out transform text-white ${
          this._isVisible ? "translate-x-0" : "translate-x-full"
        }`}
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <!-- In-game time -->
        <div class=${timerColor}>${this.secondsToHms(this.timer)}</div>

        <!-- Buttons -->
        ${this.maybeRenderReplayButtons()}

        <div class="cursor-pointer" @click=${this.onSettingsButtonClick}>
          <img src=${settingsIcon} alt="settings" width="20" height="20" />
        </div>

        ${document.fullscreenEnabled
          ? html`<div
              class="cursor-pointer"
              @click=${this.onFullscreenButtonClick}
            >
              <img
                src=${this.isFullscreen ? exitFullscreenIcon : fullscreenIcon}
                alt=${this.isFullscreen
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
      ${this.renderSuddenDeath()}
    `;
  }

  // Fortnite-zone-style readout under the timer: the rising minimum-territory
  // bar, the local player's current share, and status. Empty unless enabled.
  /** Tiles the local player's side controls: their team's combined territory in
   *  team modes, otherwise just their own (matches the sim's per-side bar). */
  private sideTiles(me: ReturnType<GameView["myPlayer"]>): number {
    if (!me) return 0;
    const ffa = this.game.config().gameConfig().gameMode === GameMode.FFA;
    const myTeam = me.team();
    if (ffa || myTeam === null) return me.numTilesOwned();
    return this.game
      .playerViews()
      .filter(
        (p) =>
          p.team() === myTeam && p.isAlive() && p.type() !== PlayerType.Bot,
      )
      .reduce((sum, p) => sum + p.numTilesOwned(), 0);
  }

  private renderSuddenDeath() {
    const sd = this.game.config().suddenDeathConfig();
    if (!sd.enabled || this.hasWinner) return html``;

    const elapsed = Math.floor(this.game.elapsedGameSeconds());
    const land = this.game.numLandTiles() - this.game.numTilesWithFallout();
    const requiredTiles = suddenDeathRequiredTiles(sd.speed, land, elapsed);
    const wave = suddenDeathWaveState(sd.speed, elapsed);
    const me = this.game.myPlayer();
    const yourTiles = this.sideTiles(me);
    // Match the sim: no land -> no bar, no percentages (avoid div-by-zero / >100%).
    const requiredPct = land > 0 ? (requiredTiles / land) * 100 : 0;
    const yourPct = land > 0 ? (yourTiles / land) * 100 : 0;
    const flagged = me?.inSuddenDeath() ?? false;
    const secondsUnder = Math.floor((me?.suddenDeathTicks() ?? 0) / 10);
    const draining = flagged && secondsUnder >= sd.warnSeconds;
    // Safe but within 10% (relative) of the bar: e.g. at 9% when the bar is 10%,
    // or 0.9% when it's 1%. About to be caught, so it blinks red too.
    const nearDanger =
      !flagged && requiredTiles > 0 && yourPct <= requiredPct * 1.1;
    // In danger (caught/draining) or about to be: everything red.
    const redAlert = flagged || nearDanger;

    // Status word + detail line.
    let status: string;
    let statusClass: string;
    let detail = "";
    if (draining && me) {
      // Drain is a % of max-troop capacity, capped at current troops; show the
      // actual per-second loss (renderTroops handles the /10 display unit).
      const chunk = suddenDeathDrain(
        this.game.config().maxTroops(me),
        secondsUnder - sd.warnSeconds,
        sd,
      );
      status = translateText("sudden_death.draining", {
        rate: renderTroops(Math.min(me.troops(), chunk)),
      });
      statusClass = "text-red-400 font-bold";
    } else if (flagged) {
      // Caught below a wave: count down the cooldown before decay begins.
      status = translateText("sudden_death.danger");
      statusClass = "text-red-400 font-bold";
      detail = translateText("sudden_death.decay_in", {
        secs: Math.max(0, sd.warnSeconds - secondsUnder),
      });
    } else {
      status = translateText("sudden_death.safe");
      statusClass = nearDanger ? "text-orange-300 font-bold" : "text-green-400";
      detail = wave.done
        ? translateText("sudden_death.final", { pct: wave.currentPercent })
        : wave.growing
          ? translateText("sudden_death.growing", { pct: wave.targetPercent })
          : translateText("sudden_death.next_wave", {
              pct: wave.targetPercent,
              time: this.secondsToHms(wave.secondsToNextGrowth),
            });
    }

    // Panel edge cue: red pulse when in/near danger, orange pulse in the 10s
    // window around a wave firing.
    const edge = redAlert
      ? "sd-pulse-red"
      : wave.waveFlash
        ? "sd-pulse-orange"
        : "";
    const panel =
      "w-fit flex flex-col gap-1.5 py-2 px-4 bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg rounded-bl-lg text-white text-sm";

    return html`
      <style>
        @keyframes sd-red {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(248, 113, 113, 0);
          }
          50% {
            box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.95);
          }
        }
        @keyframes sd-orange {
          0%,
          100% {
            box-shadow: 0 0 0 0 rgba(251, 146, 60, 0);
          }
          50% {
            box-shadow: 0 0 0 3px rgba(251, 146, 60, 0.9);
          }
        }
        .sd-pulse-red {
          animation: sd-red 1s ease-in-out infinite;
        }
        .sd-pulse-orange {
          animation: sd-orange 1.8s ease-in-out infinite;
        }
      </style>
      <div class="${panel} ${edge}">
        <div class="flex items-center justify-between gap-3">
          <span
            class="flex items-center gap-1.5 font-bold tracking-wide text-red-400"
          >
            <img src=${suddenDeathIcon} alt="" width="20" height="20" />
            ${translateText("sudden_death.title")}
          </span>
          <span class=${statusClass}>${status}</span>
        </div>
        <div class="relative h-2.5 w-52 overflow-hidden rounded bg-gray-600/60">
          <!-- your held share (green) vs the target threshold (red bar): the gap
               between them shows how far you are from safe. -->
          <div
            class="absolute inset-y-0 left-0 bg-green-400"
            style="width:${Math.min(100, yourPct)}%"
          ></div>
          <div
            class="absolute inset-y-0 w-0.5 bg-red-500"
            style="left:${Math.min(100, requiredPct)}%"
          ></div>
        </div>
        <div class="flex items-center justify-between gap-3 text-gray-300">
          <span>
            ${translateText("sudden_death.hold", {
              pct: requiredPct.toFixed(1),
            })}
          </span>
          <span class=${redAlert ? "text-red-300" : "text-green-300"}>
            ${translateText("sudden_death.you", { pct: yourPct.toFixed(1) })}
          </span>
        </div>
        ${detail
          ? html`<div class="text-xs text-gray-400">${detail}</div>`
          : ""}
      </div>
    `;
  }

  maybeRenderReplayButtons() {
    const isReplayOrSingleplayer =
      this._isSinglePlayer || this.game?.config()?.isReplay();
    const showPauseButton = isReplayOrSingleplayer || this.isLobbyCreator;

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
    `;
  }
}
