import { UserMeResponse } from "@openfront/shared/ApiSchemas";
import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { responseHasLinkedIdentity } from "../AccountIdentity";
import { getUserMe } from "../Api";
import { userAuth } from "../Auth";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { translateText } from "../Utils";
import { BaseModal } from "./BaseModal";
import {
  trustLockIcon,
  trustRequiredDialog,
  viewerIsTrusted,
} from "./LobbyCard";
import { modalHeader } from "./ui/ModalHeader";

@customElement("ranked-modal")
export class RankedModal extends BaseModal {
  protected routerName = "ranked";

  @state() private elo: number | string = "...";
  @state() private elo2v2: number | string = "...";
  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private errorMessage: string | null = null;
  // Hides the trust lock until /users/@me answers, so a trusted player
  // doesn't see it flash red first.
  @state() private loading = true;
  @state() private showTrustRequired = false;
  // CrazyGames players authenticate through the SDK, not a linked
  // Discord/Google/email account, so track that separately for ranked.
  @state() private crazyGamesSignedIn = false;

  // Eligible to see/play ranked: a linked account or a signed-in CrazyGames one.
  private isRankedEligible(): boolean {
    return (
      responseHasLinkedIdentity(this.userMeResponse) || this.crazyGamesSignedIn
    );
  }

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
      this.elo2v2 = translateText("map_component.error");
      return;
    }

    if (this.isRankedEligible()) {
      const leaderboard = this.userMeResponse
        ? this.userMeResponse.player.leaderboard
        : undefined;
      const noElo = translateText("matchmaking_modal.no_elo");
      this.elo = leaderboard?.oneVone?.elo ?? noElo;
      this.elo2v2 = leaderboard?.twoVtwo?.elo ?? noElo;
    }
  }

  protected override async onOpen(): Promise<void> {
    this.loading = true;
    this.showTrustRequired = false;
    this.elo = "...";
    this.elo2v2 = "...";
    this.errorMessage = null;

    try {
      const userMe = await getUserMe();
      this.userMeResponse = userMe;
      this.crazyGamesSignedIn =
        crazyGamesSDK.isOnCrazyGames() &&
        (await crazyGamesSDK.getUserProfile()) !== null;
    } catch (error) {
      console.warn("Failed to fetch user profile for ranked modal", error);
      this.userMeResponse = false;
      this.errorMessage = translateText("map_component.error");
      this.elo = translateText("map_component.error");
      this.elo2v2 = translateText("map_component.error");
    } finally {
      this.loading = false;
      this.updateElo();
    }
  }

  createRenderRoot() {
    return this;
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("mode_selector.ranked_title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody() {
    return html`
      <div class="custom-scrollbar p-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          ${this.renderCard(
            translateText("mode_selector.ranked_1v1_title"),
            this.errorMessage ??
              (this.isRankedEligible()
                ? translateText("matchmaking_modal.elo", { elo: this.elo })
                : translateText("mode_selector.ranked_title")),
            () => this.handleRanked("1v1"),
          )}
          ${this.renderCard(
            translateText("mode_selector.ranked_2v2_title"),
            this.errorMessage ??
              (this.isRankedEligible()
                ? translateText("matchmaking_modal.elo", { elo: this.elo2v2 })
                : translateText("mode_selector.ranked_title")),
            () => this.handleRanked("2v2"),
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
        <p class="mt-6 text-xs text-white/60 leading-relaxed text-center">
          ${translateText("mode_selector.ranked_pairing_note")}
        </p>
        ${this.showTrustRequired
          ? trustRequiredDialog(
              this.isRankedEligible(),
              () => (this.showTrustRequired = false),
              "ranked",
            )
          : ""}
      </div>
    `;
  }

  private renderCard(title: string, subtitle: string, onClick: () => void) {
    // Ranked admits trusted accounts only: a green open lock when the
    // player's account is trusted, a red closed one otherwise.
    const lock = this.trustKnown()
      ? trustLockIcon(viewerIsTrusted(this.userMeResponse), {
          tooltipTitle: translateText(
            "mode_selector.ranked_trust_tooltip_title",
          ),
        })
      : "";
    return html`
      <button
        @click=${onClick}
        class="relative flex flex-col w-full h-28 sm:h-32 rounded-2xl bg-malibu-blue border-0 transition-all duration-200 hover:bg-aquarius hover:scale-[1.03] hover:shadow-[var(--shadow-action-card-hover)] active:bg-malibu-blue/80 active:scale-[0.98] p-6 items-center justify-center gap-3"
      >
        <div class="flex flex-col items-center gap-1 text-center">
          <h3
            class="text-lg sm:text-xl font-bold text-white uppercase tracking-widest leading-tight"
          >
            ${title}
          </h3>
          <p
            class="text-xs text-white/80 uppercase tracking-wider whitespace-pre-line leading-tight"
          >
            ${subtitle}
          </p>
        </div>
        ${lock}
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

  // Whether /users/@me has answered, so the trust tier can be read.
  private trustKnown(): boolean {
    return !this.loading && this.errorMessage === null;
  }

  private async handleRanked(mode: "1v1" | "2v2") {
    // Ranked admits trusted accounts only; the popup says how to get there
    // (sign in first when signed out). Unknown tier: the service decides.
    if (this.trustKnown() && !viewerIsTrusted(this.userMeResponse)) {
      this.showTrustRequired = true;
      return;
    }
    if ((await userAuth()) === false) {
      this.close();
      window.showPage?.("page-account");
      return;
    }

    document.dispatchEvent(
      new CustomEvent("open-matchmaking", { detail: { mode } }),
    );
  }
}
