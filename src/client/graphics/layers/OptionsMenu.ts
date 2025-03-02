import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameType } from "../../../core/game/Game";
import { GameUpdateType } from "../../../core/game/GameUpdates";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import { AlternateViewEvent, RefreshGraphicsEvent } from "../../InputHandler";
import { PauseGameEvent } from "../../Transport";
import { Layer } from "./Layer";

const button = ({
  classes = "",
  onClick = () => {},
  title = "",
  children,
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

@customElement("options-menu")
export class OptionsMenu extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;
  private userSettings: UserSettings = new UserSettings();

  @state()
  private showPauseButton: boolean = true;

  @state()
  private isPaused: boolean = false;

  @state()
  private timer: number = 0;

  @state()
  private showSettings: boolean = false;

  private isVisible = false;

  private hasWinner = false;

  @state()
  private alternateView: boolean = false;

  private onTerrainButtonClick() {
    this.alternateView = !this.alternateView;
    this.eventBus.emit(new AlternateViewEvent(this.alternateView));
    this.requestUpdate();
  }

  private onExitButtonClick() {
    const isAlive = this.game.myPlayer()?.isAlive();
    if (isAlive) {
      const isConfirmed = confirm("Are you sure you want to exit the game?");
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
    this.eventBus.emit(new PauseGameEvent(this.isPaused));
  }

  private onToggleEmojisButtonClick() {
    this.userSettings.toggleEmojis();
    this.requestUpdate();
  }

  private onToggleDarkModeButtonClick() {
    this.userSettings.toggleDarkMode();
    this.requestUpdate();
    this.eventBus.emit(new RefreshGraphicsEvent());
  }

  init() {
    console.log("init called from OptionsMenu");
    this.showPauseButton =
      this.game.config().gameConfig().gameType == GameType.Singleplayer;
    this.isVisible = true;
    this.requestUpdate();
  }

  tick() {
    this.hasWinner =
      this.hasWinner ||
      this.game.updatesSinceLastTick()[GameUpdateType.WinUpdate].length > 0;
    if (this.game.inSpawnPhase()) {
      this.timer = 0;
    } else if (!this.hasWinner && this.game.ticks() % 10 == 0) {
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
        @contextmenu=${(e) => e.preventDefault()}
      >
        <div
          class="bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-lg backdrop-blur-md"
        >
          <div class="flex items-stretch gap-1 lg:gap-2">
            ${button({
              classes: !this.showPauseButton ? "hidden" : "",
              onClick: this.onPauseButtonClick,
              title: this.isPaused ? "Resume game" : "Pause game",
              children: this.isPaused ? "▶️" : "⏸",
            })}
            <div
              class="w-14 h-8 lg:w-20 lg:h-10 flex items-center justify-center 
                              bg-opacity-50 bg-gray-700 text-opacity-90 text-white 
                              rounded text-sm lg:text-xl"
            >
              ${this.timer}
            </div>
            ${button({
              onClick: this.onExitButtonClick,
              title: "Exit game",
              children: "❌",
            })}
            ${button({
              onClick: this.onSettingsButtonClick,
              title: "Settings",
              children: "⚙️",
            })}
          </div>
        </div>

        <div
          class="options-menu flex flex-wrap justify-around gap-y-3 mt-2 bg-opacity-60 bg-gray-900 p-1 lg:p-2 rounded-lg backdrop-blur-md ${!this
            .showSettings
            ? "hidden"
            : ""}"
        >
          ${button({
            onClick: this.onTerrainButtonClick,
            title: "Toggle Terrain",
            children: "🌲: " + (this.alternateView ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleEmojisButtonClick,
            title: "Toggle Emojis",
            children: "🙂: " + (this.userSettings.emojis() ? "On" : "Off"),
          })}
          ${button({
            onClick: this.onToggleDarkModeButtonClick,
            title: "Dark Mode",
            children: "🌙: " + (this.userSettings.darkMode() ? "On" : "Off"),
          })}
        </div>
      </div>
    `;
  }
}
