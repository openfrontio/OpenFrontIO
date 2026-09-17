import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserSettings } from "../core/game/UserSettings";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { launchSteamJoin, type SteamHandoffMode } from "./SteamHandoff";
import { translateText } from "./Utils";

const BUTTON_BASE =
  "flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider rounded-xl " +
  "transition-all border-0";
const BUTTON_SECONDARY =
  "bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/80";
const BUTTON_PRIMARY = "bg-malibu-blue text-white hover:bg-aquarius";

@customElement("steam-handoff-modal")
export class SteamHandoffModal extends BaseModal {
  @state() private launched = false;
  @state() private remember = false;

  private userSettings = new UserSettings();
  private lobbyId: string | null = null;
  private onPlayInBrowser: (() => void) | null = null;
  private cancelLaunch: (() => void) | null = null;

  protected modalConfig() {
    return { maxWidth: "480px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("steam_handoff.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  public offer(
    lobbyId: string,
    mode: Exclude<SteamHandoffMode, "none">,
    onPlayInBrowser: () => void,
  ): void {
    // The URL handler re-runs on every hashchange and popstate; a repeat for
    // the lobby already on screen must not launch Steam a second time.
    if (this.isOpen() && this.lobbyId === lobbyId) return;
    this.lobbyId = lobbyId;
    this.onPlayInBrowser = onPlayInBrowser;
    this.remember = false;
    this.launched = false;
    this.open();
    if (mode === "steam") this.launch();
  }

  public open(args?: Record<string, unknown>): void {
    if (this.lobbyId === null) return;
    super.open(args);
  }

  protected onClose(): void {
    this.cancelLaunch?.();
    this.cancelLaunch = null;
    // Still set means the player dismissed the offer rather than choosing the
    // browser, so the lobby URL must go too or the next hashchange re-offers.
    if (
      this.onPlayInBrowser !== null &&
      this.lobbyId !== null &&
      window.location.pathname.includes(`/game/${this.lobbyId}`)
    ) {
      history.replaceState(null, "", "/");
    }
    this.lobbyId = null;
    this.onPlayInBrowser = null;
  }

  private launch(): void {
    if (this.lobbyId === null) return;
    this.launched = true;
    this.cancelLaunch?.();
    this.cancelLaunch = launchSteamJoin(this.lobbyId);
  }

  private chooseSteam(): void {
    if (this.remember) this.userSettings.setSteamLobbyLinks("steam");
    this.launch();
  }

  private chooseBrowser(): void {
    if (this.remember) this.userSettings.setSteamLobbyLinks("browser");
    const resume = this.onPlayInBrowser;
    this.onPlayInBrowser = null;
    this.close();
    resume?.();
  }

  protected renderBody() {
    return html`
      <div class="flex flex-col gap-4 p-6">
        <p class="text-sm text-white/80">
          ${translateText(
            this.launched ? "steam_handoff.launched" : "steam_handoff.prompt",
          )}
        </p>
        ${this.launched
          ? null
          : html`<label
              class="flex items-center gap-2 text-xs text-white/60 cursor-pointer"
            >
              <input
                type="checkbox"
                class="steam-handoff-remember"
                .checked=${this.remember}
                @change=${(e: Event) =>
                  (this.remember = (e.target as HTMLInputElement).checked)}
              />
              ${translateText("steam_handoff.remember")}
            </label>`}
        <div class="flex gap-3">
          <button
            class="steam-handoff-browser-btn ${BUTTON_BASE} ${BUTTON_SECONDARY}"
            @click=${() => this.chooseBrowser()}
          >
            ${translateText("steam_handoff.play_in_browser")}
          </button>
          <button
            class="steam-handoff-steam-btn ${BUTTON_BASE} ${BUTTON_PRIMARY}"
            @click=${() => (this.launched ? this.launch() : this.chooseSteam())}
          >
            ${translateText(
              this.launched
                ? "steam_handoff.try_again"
                : "steam_handoff.open_in_steam",
            )}
          </button>
        </div>
      </div>
    `;
  }
}
