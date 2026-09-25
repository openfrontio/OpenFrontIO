import { Howl } from "howler";
import {
  html,
  ReactiveController,
  ReactiveControllerHost,
  TemplateResult,
} from "lit";
import { assetUrl } from "../../core/AssetUrls";
import { translateText } from "../Utils";

/**
 * The shared opt-in game-start alert used while waiting in either a lobby or
 * ranked matchmaking. It deliberately owns the whole behavior so the two
 * entry paths cannot drift: the bell, toast, audio priming, chime and desktop
 * notification are identical.
 */
export class GameStartAlertController implements ReactiveController {
  private armed = false;
  // SoundManager exists only after the game is running. Keep an independent
  // Howl at full volume so an alert the player explicitly armed is available
  // during the wait and is not silenced by an SFX slider that defaults to 0.
  private sound: Howl | null = null;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly isWaitingForGame: () => boolean,
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    document.addEventListener("game-starting", this.handleGameStarting);
  }

  hostDisconnected(): void {
    document.removeEventListener("game-starting", this.handleGameStarting);
  }

  renderBell(): TemplateResult {
    const label = translateText(
      this.armed ? "public_lobby.notify_on" : "public_lobby.notify_off",
    );
    return html`<button
      type="button"
      class="inline-flex ml-auto p-1 rounded-lg transition-colors ${this.armed
        ? "text-amber-300 hover:text-amber-200"
        : "text-white/40 hover:text-white"}"
      title=${label}
      aria-label=${label}
      aria-pressed=${this.armed}
      @click=${this.toggle}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill=${this.armed ? "currentColor" : "none"}
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="w-7 h-7"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    </button>`;
  }

  reset(): void {
    if (!this.armed) return;
    this.armed = false;
    this.host.requestUpdate();
  }

  private readonly toggle = (): void => {
    if (this.armed) {
      this.armed = false;
      this.host.requestUpdate();
      return;
    }

    this.armed = true;
    this.host.requestUpdate();
    window.dispatchEvent(
      new CustomEvent("show-message", {
        detail: {
          message: translateText("public_lobby.notify_armed"),
          duration: 3000,
          color: "green",
        },
      }),
    );

    // Keep both operations synchronous with the click. Safari only shows the
    // permission prompt from a user gesture, and creating the Howl here opens
    // Howler's AudioContext so a background tab can play the chime later.
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
    this.loadSound();
  };

  private loadSound(): Howl {
    this.sound ??= new Howl({
      src: [assetUrl("sounds/effects/game-start-alert.mp3")],
    });
    return this.sound;
  }

  private readonly handleGameStarting = (): void => {
    if (!this.armed || !this.isWaitingForGame()) return;

    try {
      this.loadSound().play();
    } catch (error) {
      console.warn("Failed to play game-start alert sound", error);
    }

    // The chime is unconditional. The desktop notification is an additional
    // channel where the browser and OS permit it, not a fallback for audio.
    if (
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) {
      return;
    }
    try {
      const notification = new Notification(
        translateText("public_lobby.notify_started"),
      );
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch (error) {
      // Some mobile browsers only allow notifications via a service worker.
      console.warn("Failed to show game-start notification", error);
    }
  };
}
