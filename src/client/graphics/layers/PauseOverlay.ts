import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GamePausedEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { Layer } from "./Layer";

@customElement("pause-overlay")
export class PauseOverlay extends LitElement implements Layer {
  public eventBus: EventBus;
  private isPaused = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(GamePausedEvent, (e) => {
      this.isPaused = e.paused;
      this.requestUpdate();
    });
  }

  render() {
    if (!this.isPaused) {
      return html``;
    }

    return html`
      <div
        class="fixed inset-0 flex items-center justify-center
                    bg-black bg-opacity-50 backdrop-blur-sm z-50"
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-gray-900 bg-opacity-90 rounded-lg p-8
                      text-white text-2xl  lg:text-4xl font-bold
                      border-2 border-gray-600"
        >
          <p class="mx-auto max-w-sm text-center">
            ${translateText("pause.game_paused")}
          </p>
        </div>
      </div>
    `;
  }
}
