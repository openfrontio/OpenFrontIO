import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { UserSettings } from "../../../core/game/UserSettings";
import "../../components/baseComponents/Button";
import { Controller } from "../../Controller";
import { RefreshGraphicsEvent } from "../../InputHandler";
import { translateText } from "../../Utils";

/**
 * Top-of-screen toolbar shown only during a skin preview. Lets the player flip
 * the map between light/dark themes to see the cosmetic both ways, and finish
 * the preview (the preview never auto-ends) — which opens
 * <preview-complete-modal>.
 */
@customElement("preview-finish-button")
export class PreviewFinishButton extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;

  private userSettings = new UserSettings();

  @state()
  private isPreview = false;

  @state()
  private isDark = false;

  createRenderRoot() {
    return this;
  }

  init() {
    this.isPreview = this.game?.config().isPreview() ?? false;
    this.isDark = this.userSettings.darkMode();
    this.requestUpdate();
  }

  tick() {}

  private onFinish() {
    const modal = document.querySelector("preview-complete-modal") as
      | (HTMLElement & { show?: () => void })
      | null;
    modal?.show?.();
  }

  private toggleTheme() {
    // Same path the in-game settings toggle uses: flip the darkMode setting
    // (a listener maps it to the renderer's day/night mode) and force a redraw.
    this.userSettings.toggleDarkMode();
    this.eventBus.emit(new RefreshGraphicsEvent());
    this.isDark = this.userSettings.darkMode();
  }

  render() {
    if (!this.isPreview) return html``;
    return html`
      <div
        class="fixed top-6 left-1/2 -translate-x-1/2 z-[10005] flex items-center gap-2"
      >
        <o-button
          variant="secondary"
          .title=${this.isDark
            ? translateText("preview.light_theme")
            : translateText("preview.dark_theme")}
          @click=${this.toggleTheme}
        ></o-button>
        <o-button
          variant="primary"
          translationKey="preview.finish"
          @click=${this.onFinish}
        ></o-button>
      </div>
    `;
  }
}
