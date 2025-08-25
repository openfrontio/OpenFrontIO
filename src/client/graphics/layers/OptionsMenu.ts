import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, RedrawGraphicsEvent } from "../../InputHandler";
import { PauseGameEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

const button = ({
  classes = "",
  onClick = () => {},
  title = "",
  children = "",
}) => html`
  <button
    class="flex items-center justify-center p-1
                               bg-opacity-70 bg-gray-700 text-opacity-90 text-white
                               border-none rounded cursor-pointer
                               hover:bg-opacity-60 hover:bg-gray-600
                               transition-colors duration-200
                               text-sm lg:text-xl ${classes}"
    @click=${onClick}
    aria-label=${title}
    title=${title}
  >
    ${children}
  </button>
`;

const secondsToHms = (d: number): string => {
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = Math.floor((d % 3600) % 60);
  let time = d === 0 ? "-" : `${s}s`;
  if (m > 0) time = `${m}m` + time;
  if (h > 0) time = `${h}h` + time;
  return time;
};

@customElement("options-menu")
export class OptionsMenu extends LitElement implements Layer {
  public game: GameView | undefined;
  public eventBus: EventBus | undefined;
  private readonly userSettings: UserSettings = new UserSettings();

  @state()
  private showPauseButton = true;

  @state()
  private isPaused = false;

  @state()
  private timer = 0;

  @state()
  private showSettings = false;

  private isVisible = false;

  private hasWinner = false;

  @state()
  private alternateView = false;

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus?.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onExitButtonClick() {
    const isAlive = this.game?.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm(
        translateText("help_modal.exit_confirmation"),
      );
      if (!isConfirmed) return;
    }
    // redirect to the home page
    window.location.href = "/";
  }

  createRenderRoot() {
    return this;
  }

  private onSettingsButtonClick() {
    this.showSettings = !this.showSettings;
    this.requestUpdate();
  }

  private onPauseButtonClick() {
    this.isPaused = !this.isPaused;
    this.eventBus?.emit(new PauseGameEvent(this.isPaused));
  }

  private onToggleEmojisButtonClick() {
    this.userSettings.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleAlertFrameButtonClick() {
    this.userSettings.toggleAlertFrame();
    this.requestUpdate();
  }

  private onToggleSpecialEffectsButtonClick() {
    this.userSettings.toggleFxLayer();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings.toggleDarkMode();
    this.requestUpdate();
    this.eventBus?.emit(new RedrawGraphicsEvent());
  }

  private onToggleRandomNameModeButtonClick() {
    this.userSettings.toggleRandomName();
  }

  private onToggleFocusLockedButtonClick() {
    this.userSettings.toggleFocusLocked();
    this.requestUpdate();
  }

  private onToggleLeftClickOpensMenu() {
    this.userSettings.toggleLeftClickOpenMenu();
  }

  private onToggleTerritoryPatterns() {
    this.userSettings.toggleTerritoryPatterns();
    this.requestUpdate();
  }

  private onTogglePerformanceOverlayButtonClick() {
    this.userSettings.togglePerformanceOverlay();
    this.requestUpdate();
  }

  init() {
    if (!this.game) throw new Error("Not initialzied");
    console.log("init called from OptionsMenu");
    this.showPauseButton =
      this.game.config().gameConfig().gameType === GameType.Singleplayer ||
      this.game.config().isReplay();
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    if (!this.game) throw new Error("Not initialzied");
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      this.hasWinner = this.hasWinner || updates[GameUpdateType.Win].length > 0;
    }
    if (this.game.inSpawnPhase()) {
      this.timer = 0;
    } else if (!this.hasWinner && this.game.ticks() % 10 === 0) {
      this.timer++;
    }
    this.isVisible = true;
    this.requestUpdate();
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }
    return html`
      <div
        class="top-0 lg:top-4 right-0 lg:right-4 z-50 pointer-events-auto"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-es-sm lg:rounded-lg backdrop-blur-md"
        >
          <div class="flex items-stretch gap-1 lg:gap-2">
            ${button({
              children: this.isPaused ? "▶️" : "⏸",
              classes: !this.showPauseButton ? "hidden" : "",
              onClick: this.onPauseButtonClick,
              title: this.isPaused ? "Resume game" : "Pause game",
            })}
            <div
              class="w-[55px] h-8 lg:w-24 lg:h-10 flex items-center justify-center
                              bg-opacity-50 bg-gray-700 text-opacity-90 text-white
                              rounded text-sm lg:text-xl"
            >
              ${secondsToHms(this.timer)}
            </div>
            ${button({
              children: "❌",
              onClick: this.onExitButtonClick,
              title: "Exit game",
            })}
            ${button({
              children: "⚙️",
              onClick: this.onSettingsButtonClick,
              title: "Settings",
            })}
          </div>
        </div>

        <div
          class="options-menu flex flex-col justify-around gap-y-3 mt-2
          bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-lg backdrop-blur-md
          ${!this.showSettings ? "hidden" : ""}"
        >
          ${button({
            children: "🌲: " + (this.alternateView ? "On" : "Off"),
            onClick: this.onTerrainButtonClick,
            title: "Toggle Terrain",
          })}
          ${button({
            children: "🙂: " + (this.userSettings.emojis() ? "On" : "Off"),
            onClick: this.onToggleEmojisButtonClick,
            title: "Toggle Emojis",
          })}
          ${button({
            children: "🚨: " + (this.userSettings.alertFrame() ? "On" : "Off"),
            onClick: this.onToggleAlertFrameButtonClick,
            title: "Toggle Alert frame",
          })}
          ${button({
            children: "💥: " + (this.userSettings.fxLayer() ? "On" : "Off"),
            onClick: this.onToggleSpecialEffectsButtonClick,
            title: "Toggle Special effects",
          })}
          ${button({
            children:
              "🏳️: " + (this.userSettings.territoryPatterns() ? "On" : "Off"),
            onClick: this.onToggleTerritoryPatterns,
            title: "Territory Patterns",
          })}
          ${button({
            children: "🌙: " + (this.userSettings.darkMode() ? "On" : "Off"),
            onClick: this.onToggleDarkModeButtonClick,
            title: "Dark Mode",
          })}
          ${button({
            children:
              "🥷: " + (this.userSettings.anonymousNames() ? "On" : "Off"),
            onClick: this.onToggleRandomNameModeButtonClick,
            title: "Random name mode",
          })}
          ${button({
            children:
              "🖱️: " +
              (this.userSettings.leftClickOpensMenu()
                ? "Opens menu"
                : "Attack"),
            onClick: this.onToggleLeftClickOpensMenu,
            title: "Left click",
          })}
          ${button({
            children:
              "🚀: " + (this.userSettings.performanceOverlay() ? "On" : "Off"),
            onClick: this.onTogglePerformanceOverlayButtonClick,
            title: "Performance Overlay",
          })}
          <!-- ${button({
            children:
              "🗺: " +
              (this.userSettings.focusLocked()
                ? "Focus locked"
                : "Hover focus"),
            onClick: this.onToggleFocusLockedButtonClick,
            title: "Lock Focus",
          })} -->
        </div>
      </div>
    `;
  }
}
