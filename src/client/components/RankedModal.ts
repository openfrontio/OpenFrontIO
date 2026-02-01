import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getUserMe } from "../Api";
import { userAuth } from "../Auth";
import { translateText } from "../Utils";
import { BaseModal } from "./BaseModal";
import { modalHeader } from "./ui/ModalHeader";

@customElement("ranked-modal")
export class RankedModal extends BaseModal {
  @state() private elo: number | string = "...";
  @state() private isLoggedIn = false;

  constructor() {
    super();
    this.id = "page-ranked";
  }

  protected override async onOpen(): Promise<void> {
    this.elo = "...";
    this.isLoggedIn = false;
    const userMe = await getUserMe();
    if (userMe) {
      this.isLoggedIn = true;
      this.elo =
        userMe.player.leaderboard?.oneVone?.elo ??
        translateText("matchmaking_modal.no_elo");
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
          onBack: this.close,
          ariaLabel: translateText("common.back"),
        })}
        <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            ${this.renderCard(
              translateText("mode_selector.ranked_1v1_title"),
              this.isLoggedIn
                ? translateText("matchmaking_modal.elo", { elo: this.elo })
                : translateText("mode_selector.ranked_title"),
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

    const usernameInput = document.querySelector("username-input") as any;
    if (
      usernameInput &&
      typeof usernameInput.isValid === "function" &&
      !usernameInput.isValid()
    ) {
      window.dispatchEvent(
        new CustomEvent("show-message", {
          detail: {
            message: usernameInput.validationError,
            color: "red",
            duration: 3000,
          },
        }),
      );
      return;
    }

    document.dispatchEvent(new CustomEvent("open-matchmaking"));
  }
}
