import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { getUserMe, hasLinkedAccount } from "../Api";
import { userAuth } from "../Auth";
import { translateText } from "../Utils";
import { BaseModal } from "./BaseModal";
import { modalHeader } from "./ui/ModalHeader";

@customElement("ranked-modal")
export class RankedModal extends BaseModal {
  @state() private elo: number | string = "...";
  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private errorMessage: string | null = null;

  constructor() {
    super();
    this.id = "page-ranked";
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
  }

  disconnectedCallback() {
    document.removeEventListener(
      "userMeResponse",
      this.handleUserMeResponse as EventListener,
    );
    super.disconnectedCallback();
  }

  private handleUserMeResponse = (
    event: CustomEvent<UserMeResponse | false>,
  ) => {
    this.errorMessage = null;
    this.userMeResponse = event.detail;
    this.updateElo();
  };

  private updateElo() {
    if (this.errorMessage) {
      this.elo = translateText("map_component.error");
      return;
    }

    if (hasLinkedAccount(this.userMeResponse)) {
      this.elo =
        this.userMeResponse &&
        this.userMeResponse.player.leaderboard?.oneVone?.elo
          ? this.userMeResponse.player.leaderboard.oneVone.elo
          : translateText("matchmaking_modal.no_elo");
    }
  }

  protected override async onOpen(): Promise<void> {
    this.elo = "...";
    this.errorMessage = null;

    try {
      const userMe = await getUserMe();
      this.userMeResponse = userMe;
    } catch (error) {
      console.error("Failed to fetch user profile for ranked modal", error);
      this.userMeResponse = false;
      this.errorMessage = translateText("map_component.error");
      this.elo = translateText("map_component.error");
    } finally {
      this.updateElo();
    }
  }

  createRenderRoot() {
    return this;
  }

  render() {
    const content = html`
      <div class="${this.modalContainerClass}">
        ${modalHeader({
          title: translateText("mode_selector.ranked_title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
        })}
        <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            ${this.renderCard(
              translateText("mode_selector.ranked_1v1_title"),
              this.errorMessage ??
                (hasLinkedAccount(this.userMeResponse)
                  ? translateText("matchmaking_modal.elo", { elo: this.elo })
                  : translateText("mode_selector.ranked_title")),
              () => this.handleRanked(),
            )}
            ${this.renderDisabledCard(
              translateText("mode_selector.ranked_2v2_title"),
              translateText("mode_selector.coming_soon"),
            )}
            ${this.renderDisabledCard(
              translateText("mode_selector.coming_soon"),
              "",
            )}
            ${this.renderDisabledCard(
              translateText("mode_selector.coming_soon"),
              "",
            )}
          </div>
        </div>
      </div>
    `;

    if (this.inline) {
      return content;
    }

    return html`
      <o-modal ?hideHeader=${true} ?hideCloseButton=${true}>
        ${content}
      </o-modal>
    `;
  }

  private renderCard(title: string, subtitle: string, onClick: () => void) {
    return html`
      <button
        @click=${onClick}
        class="flex flex-col w-full h-28 sm:h-32 rounded-2xl bg-[color-mix(in_oklab,var(--frenchBlue)_70%,black)] border-0 transition-transform hover:scale-[1.02] active:scale-[0.98] p-6 items-center justify-center gap-3"
      >
        <div class="flex flex-col items-center gap-1 text-center">
          <h3
            class="text-lg sm:text-xl font-bold text-white uppercase tracking-widest leading-tight"
          >
            ${title}
          </h3>
          <p
            class="text-xs text-white/60 uppercase tracking-wider whitespace-pre-line leading-tight"
          >
            ${subtitle}
          </p>
        </div>
      </button>
    `;
  }

  private renderDisabledCard(title: string, subtitle: string) {
    return html`
      <div
        class="group relative isolate flex flex-col w-full h-28 sm:h-32 overflow-hidden rounded-2xl bg-slate-900/40 backdrop-blur-md border-0 shadow-none p-6 items-center justify-center gap-3 opacity-50 cursor-not-allowed"
      >
        <div class="flex flex-col items-center gap-1 text-center">
          <h3
            class="text-lg sm:text-xl font-bold text-white/60 uppercase tracking-widest leading-tight"
          >
            ${title}
          </h3>
          <p
            class="text-xs text-white/40 uppercase tracking-wider whitespace-pre-line leading-tight"
          >
            ${subtitle}
          </p>
        </div>
      </div>
    `;
  }

  private async handleRanked() {
    if ((await userAuth()) === false) {
      this.close();
      window.showPage?.("page-account");
      return;
    }

    document.dispatchEvent(new CustomEvent("open-matchmaking"));
  }
}
