import { html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { isVerifiedUsername, type PlayerStatsTree } from "../core/ApiSchemas";
import { fetchPublicPlayerProfile } from "./Api";
import "./components/baseComponents/stats/PlayerStatsTree";
import { BaseModal } from "./components/BaseModal";
import "./components/PlayerName";
import { modalHeader } from "./components/ui/ModalHeader";
import { verifiedBadge } from "./components/ui/VerifiedBadge";
import { translateText } from "./Utils";

/** Build a shareable profile URL for a publicId. */
export function playerProfileUrl(publicId: string): string {
  return `${window.location.origin}${window.location.pathname}#modal=profile&publicID=${encodeURIComponent(publicId)}`;
}

@customElement("player-profile-modal")
export class PlayerProfileModal extends BaseModal {
  protected routerName = "profile";

  @state() private publicId: string | null = null;
  @state() private username: string | null = null;
  @state() private statsTree: PlayerStatsTree | null = null;
  @state() private loading = false;
  private openedFrom: "clan" | null = null;

  protected modalConfig() {
    return { maxWidth: "960px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("player_profile.title"),
      // The account username takes over the title when set — not uppercased
      // like the default title, since name casing is meaningful — and the
      // right chip then always shows the publicId.
      titleContent: this.username
        ? html`<span
            class="text-white text-xl lg:text-2xl font-bold tracking-wide break-words hyphens-auto min-w-0 inline-flex items-center gap-2"
          >
            ${this.username}
            ${isVerifiedUsername(this.username)
              ? verifiedBadge("w-5 h-5")
              : nothing}
          </span>`
        : undefined,
      onBack: () => this.back(),
      ariaLabel: translateText("common.back"),
      rightContent: this.publicId
        ? html`
            <player-name
              class="shrink-0"
              .publicId=${this.publicId}
              .copyText=${playerProfileUrl(this.publicId)}
            ></player-name>
          `
        : undefined,
    });
  }

  protected renderBody() {
    return html`
      <div class="px-3 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-7">
        ${this.renderProfile()}
      </div>
    `;
  }

  private renderProfile() {
    if (this.loading) {
      return this.renderLoadingSpinner(translateText("player_profile.loading"));
    }
    if (!this.publicId || !this.statsTree) {
      return html`
        <div class="flex flex-col items-center justify-center p-12 text-center">
          <span class="text-4xl mb-4">📊</span>
          <p class="text-white/40 text-sm">
            ${translateText("player_profile.not_found")}
          </p>
        </div>
      `;
    }
    return html`
      <div class="bg-white/5 rounded-xl border border-white/10 p-6">
        <player-stats-tree-view
          .statsTree=${this.statsTree}
        ></player-stats-tree-view>
      </div>
    `;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    const publicId =
      typeof args?.publicID === "string" && args.publicID.length > 0
        ? args.publicID
        : null;
    this.publicId = publicId;
    this.username = null;
    this.statsTree = null;
    this.loading = publicId !== null;
    if (publicId !== null) {
      void this.loadProfile(publicId);
    }
  }

  private async loadProfile(publicId: string): Promise<void> {
    const profile = await fetchPublicPlayerProfile(publicId);
    // A late response must not clobber state after close or re-open.
    if (this.publicId !== publicId) return;
    this.loading = false;
    this.statsTree = profile === false ? null : profile.stats;
    this.username = profile === false ? null : (profile.username ?? null);
  }

  protected onClose(): void {
    this.publicId = null;
    this.username = null;
    this.statsTree = null;
    this.loading = false;
    this.openedFrom = null;
  }

  public openFromClan(publicId: string): void {
    this.openedFrom = "clan";
    this.open({ publicID: publicId });
  }

  private back(): void {
    const openedFrom = this.openedFrom;
    this.close();
    if (openedFrom === "clan") {
      document
        .querySelector<HTMLElement & { returnToMembers(): void }>("clan-modal")
        ?.returnToMembers();
    }
  }
}
