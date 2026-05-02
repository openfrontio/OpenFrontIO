import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ClanInfo } from "../../ClanApi";
import { translateText } from "../../Utils";
import { translateClanRole } from "./ClanShared";

@customElement("clan-card")
export class ClanCard extends LitElement {
  @property({ type: Object }) clan!: ClanInfo;
  @property() clanRole?: string;
  @property({ type: Boolean }) pending = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.style.display = "block";
  }

  private onClick() {
    this.dispatchEvent(
      new CustomEvent("clan-select", {
        detail: { tag: this.clan.tag },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderBadge() {
    const base =
      "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0";
    if (this.clanRole) {
      const colors =
        this.clanRole === "leader"
          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
          : "bg-malibu-blue/15 text-aquarius border border-malibu-blue/30";
      return html`<span class="${base} ${colors}"
        >${translateClanRole(this.clanRole)}</span
      >`;
    }
    if (this.pending) {
      return html`<span
        class="${base} bg-amber-500/20 text-amber-400 border border-amber-500/30"
        >${translateText("clan_modal.request_pending")}</span
      >`;
    }
    if (this.clan.isOpen) {
      return html`<span
        class="${base} bg-green-500/20 text-green-400 border border-green-500/30"
        >${translateText("clan_modal.open")}</span
      >`;
    }
    return html`<span
      class="${base} bg-red-500/20 text-red-400 border border-red-500/30"
      >${translateText("clan_modal.invite_only")}</span
    >`;
  }

  render() {
    const clan = this.clan;
    return html`
      <button
        @click=${() => this.onClick()}
        class="w-full text-left bg-white/5 hover:bg-white/10 rounded-xl border border-white/10 hover:border-white/20 p-4 transition-all cursor-pointer group"
      >
        <div class="flex items-center gap-4">
          <div
            class="w-12 h-12 rounded-xl bg-gradient-to-br ${clan.isOpen
              ? "from-malibu-blue/20 to-aquarius/20"
              : "from-amber-500/20 to-orange-500/20"} flex items-center justify-center border border-white/10 shrink-0"
          >
            <span class="text-white font-bold text-sm">${clan.tag}</span>
          </div>
          <div class="flex-1 min-w-0">
            <span class="text-white font-bold truncate block"
              >${clan.name}</span
            >
            <div class="flex items-center gap-4 mt-1 text-xs text-white/40">
              <span
                >${translateText("clan_modal.member_count", {
                  count: clan.memberCount ?? 0,
                })}</span
              >
            </div>
          </div>
          ${this.renderBadge()}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-5 h-5 text-white/20 group-hover:text-white/50 transition-colors shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </button>
    `;
  }
}
