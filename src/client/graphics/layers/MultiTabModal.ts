import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { GameType } from "../../../core/game/Game";
import { GameView } from "../../../core/game/GameView";
import { MultiTabDetector } from "../../MultiTabDetector";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("multi-tab-modal")
export class MultiTabModal extends LitElement implements Layer {
  public game: GameView;

  private detector: MultiTabDetector;

  @property({ type: Number }) duration: number = 5000;
  @state() private countdown: number = 5;
  @state() private isVisible: boolean = false;

  private intervalId?: number;

  // Disable shadow DOM to allow Tailwind classes to work
  createRenderRoot() {
    return this;
  }

  tick() {
    if (
      this.game.inSpawnPhase() ||
      this.game.config().gameConfig().gameType == GameType.Singleplayer
    ) {
      return;
    }
    if (!this.detector) {
      this.detector = new MultiTabDetector();
      this.detector.startMonitoring((duration: number) => {
        this.show(duration);
      });
    }
  }

  // Show the modal with penalty information
  public show(duration: number): void {
    if (!this.game.myPlayer()?.isAlive()) {
      return;
    }
    this.duration = duration;
    this.countdown = Math.ceil(duration / 1000);
    this.isVisible = true;

    // Start countdown timer
    this.intervalId = window.setInterval(() => {
      this.countdown--;

      if (this.countdown <= 0) {
        this.hide();
      }
    }, 1000);

    this.requestUpdate();
  }

  // Hide the modal
  public hide(): void {
    this.isVisible = false;

    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    // Dispatch event when modal is closed
    this.dispatchEvent(
      new CustomEvent("penalty-complete", {
        bubbles: true,
        composed: true,
      }),
    );

    this.requestUpdate();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <div
        class="fixed inset-0 z-50 overflow-auto bg-red-500/20 flex items-center justify-center"
      >
        <div
          class="relative p-6 bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full m-4 transition-all transform"
        >
          <h2 class="text-2xl font-bold mb-4 text-red-600 dark:text-red-400">
            ${translateText("multi_tab.warning")}
          </h2>

          <p class="mb-4 text-gray-800 dark:text-gray-200">
            ${translateText("multi_tab.detected")}
          </p>

          <p class="mb-4 text-gray-800 dark:text-gray-200">
            ${translateText("multi_tab.please_wait")}
            <span class="font-bold text-xl">${this.countdown}</span>
            ${translateText("multi_tab.seconds")}
          </p>

          <div
            class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-4"
          >
            <div
              class="bg-red-600 dark:bg-red-500 h-2.5 rounded-full transition-all duration-1000 ease-linear"
              style="width: ${(this.countdown / (this.duration / 1000)) * 100}%"
            ></div>
          </div>

          <p class="text-sm text-gray-600 dark:text-gray-400">
            ${translateText("multi_tab.explanation")}
          </p>
        </div>
      </div>
    `;
  }
}
