import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { getUserMe, hasLinkedAccount } from "../Api";
import { userAuth } from "../Auth";
import { crazyGamesSDK } from "../CrazyGamesSDK";
import { getRankedTeammate, setRankedTeammate } from "../RankedTeammate";
import { translateText } from "../Utils";
import { BaseModal } from "./BaseModal";
import { modalHeader } from "./ui/ModalHeader";

@customElement("ranked-modal")
export class RankedModal extends BaseModal {
  protected routerName = "ranked";

  // Shared by both live cards; h-full keeps them the same height.
  private static readonly CARD_CLASS =
    "flex flex-col w-full h-full min-h-[9.5rem] rounded-2xl bg-malibu-blue border-0 transition-all duration-200 hover:bg-aquarius hover:scale-[1.03] hover:shadow-[var(--shadow-action-card-hover)] active:bg-malibu-blue/80 active:scale-[0.98] p-6 items-center justify-center gap-3";

  @state() private elo: number | string = "...";
  @state() private elo2v2: number | string = "...";
  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private errorMessage: string | null = null;
  // CrazyGames players authenticate through the SDK, not a linked
  // Discord/Google/email account, so track that separately for ranked.
  @state() private crazyGamesSignedIn = false;
  // Optional 2v2 teammate, by public id. Empty = ordinary solo queue. Ids are
  // permanent, so a regular duo exchanges them once.
  @state() private teammateId = "";

  private ownPublicId(): string | null {
    return this.userMeResponse === false
      ? null
      : this.userMeResponse.player.publicId;
  }

  // Eligible to see/play ranked: a linked account or a signed-in CrazyGames one.
  private isRankedEligible(): boolean {
    return hasLinkedAccount(this.userMeResponse) || this.crazyGamesSignedIn;
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
    this.elo = "...";
    this.elo2v2 = "...";
    this.errorMessage = null;
    this.teammateId = getRankedTeammate() ?? "";

    try {
      const userMe = await getUserMe();
      this.userMeResponse = userMe;
      this.crazyGamesSignedIn =
        crazyGamesSDK.isOnCrazyGames() &&
        (await crazyGamesSDK.getUserProfile()) !== null;
    } catch (error) {
      console.error("Failed to fetch user profile for ranked modal", error);
      this.userMeResponse = false;
      this.errorMessage = translateText("map_component.error");
      this.elo = translateText("map_component.error");
      this.elo2v2 = translateText("map_component.error");
    } finally {
      // Re-check now the player is known, so a stale self-reference isn't shown.
      this.teammateId = getRankedTeammate(this.ownPublicId()) ?? "";
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
            this.modeSubtitle(this.elo),
            () => this.handleRanked("1v1"),
          )}
          ${this.render2v2Card()}
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
    `;
  }

  // Error, else this mode's ELO, else a plain label when ranked isn't available.
  private modeSubtitle(elo: number | string): string {
    if (this.errorMessage !== null) return this.errorMessage;
    return this.isRankedEligible()
      ? translateText("matchmaking_modal.elo", { elo })
      : translateText("mode_selector.ranked_title");
  }

  // Shared by every card so the variants can't drift apart typographically.
  private cardBody(title: string, subtitle: string, muted = false) {
    return html`
      <div class="flex flex-col items-center gap-1 text-center">
        <h3
          class="text-lg sm:text-xl font-bold ${muted
            ? "text-white/60"
            : "text-white"} uppercase tracking-widest leading-tight"
        >
          ${title}
        </h3>
        <p
          class="text-xs ${muted
            ? "text-white/40"
            : "text-white/80"} uppercase tracking-wider whitespace-pre-line leading-tight"
        >
          ${subtitle}
        </p>
      </div>
    `;
  }

  private renderCard(title: string, subtitle: string, onClick: () => void) {
    return html`
      <button @click=${onClick} class=${RankedModal.CARD_CLASS}>
        ${this.cardBody(title, subtitle)}
      </button>
    `;
  }

  // The teammate field is pinned to the bottom and out of the flow, so the
  // title/ELO block stays centred like the 1v1 card's. A div rather than a button
  // because <button> may not contain <input>; button semantics come from
  // role/tabindex, and the input stops its events reaching the card.
  private render2v2Card() {
    const queue = () => this.handleRanked("2v2");
    return html`
      <div
        role="button"
        tabindex="0"
        class="${RankedModal.CARD_CLASS} relative cursor-pointer"
        @click=${queue}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            queue();
          }
        }}
      >
        ${this.cardBody(
          translateText("mode_selector.ranked_2v2_title"),
          this.modeSubtitle(this.elo2v2),
        )}
        ${this.isRankedEligible()
          ? html`
              <input
                type="text"
                .value=${this.teammateId}
                @input=${this.onTeammateInput}
                @click=${(e: Event) => e.stopPropagation()}
                @keydown=${(e: Event) => e.stopPropagation()}
                maxlength="22"
                aria-label=${translateText("ranked_modal.teammate_placeholder")}
                placeholder=${translateText(
                  "ranked_modal.teammate_placeholder",
                )}
                title=${translateText("ranked_modal.teammate_hint")}
                class="absolute bottom-3 left-3 right-3 mx-auto h-8 max-w-[15rem] cursor-text rounded-lg border border-white/25 bg-black/20 px-2 text-center text-xs tracking-wider text-white placeholder-white/60 transition-colors focus:border-white/50 focus:bg-black/30 focus:outline-none"
              />
            `
          : ""}
      </div>
    `;
  }

  // Own id is never a valid teammate: you'd wait on yourself.
  private onTeammateInput = (e: Event) => {
    const entered = (e.target as HTMLInputElement).value.trim();
    const ownId =
      this.userMeResponse === false
        ? null
        : this.userMeResponse.player.publicId;
    this.teammateId = entered === ownId ? "" : entered;
    setRankedTeammate(this.teammateId);
  };

  private renderDisabledCard(title: string, subtitle: string) {
    return html`
      <div
        class="group relative isolate flex flex-col w-full h-full min-h-[9.5rem] overflow-hidden rounded-2xl bg-slate-900/40 backdrop-blur-md border-0 shadow-none p-6 items-center justify-center gap-3 opacity-50 cursor-not-allowed"
      >
        ${this.cardBody(title, subtitle, true)}
      </div>
    `;
  }

  private async handleRanked(mode: "1v1" | "2v2") {
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
