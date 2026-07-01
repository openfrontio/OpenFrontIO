import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics, EFFECT_TYPES } from "../core/CosmeticSchemas";
import { BaseModal } from "./components/BaseModal";
import "./components/EffectsGrid";
import "./components/NotLoggedInWarning";
import { modalHeader } from "./components/ui/ModalHeader";
import { fetchCosmetics } from "./Cosmetics";
import { translateText } from "./Utils";

@customElement("effects-modal")
export class EffectsModal extends BaseModal {
  protected routerName = "effects";

  @state() private cosmetics: Cosmetics | null = null;
  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private search = "";

  // One tab per trail effectType; BaseModal owns activeTab + renders the bar.
  protected modalConfig() {
    return {
      tabs: EFFECT_TYPES.map((type) => ({
        key: type,
        label: translateText(`effects.type.${type}`),
      })),
    };
  }

  private handleSearch(event: Event) {
    this.search = (event.target as HTMLInputElement).value;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(
      "userMeResponse",
      (event: CustomEvent<UserMeResponse | false>) => {
        this.onUserMe(event.detail);
      },
    );
  }

  async onUserMe(userMeResponse: UserMeResponse | false) {
    this.userMeResponse = userMeResponse;
    this.cosmetics = await fetchCosmetics();
    this.requestUpdate();
  }

  protected renderHeaderSlot() {
    return html`
      <div
        class="relative flex flex-col border-b border-white/10 pb-4 shrink-0"
      >
        ${modalHeader({
          title: translateText("effects.title"),
          onBack: () => this.close(),
          ariaLabel: translateText("common.back"),
          rightContent: html`<not-logged-in-warning></not-logged-in-warning>`,
        })}

        <div class="md:flex items-center gap-2 justify-center mt-4">
          <input
            class="h-12 w-full max-w-md border border-white/10 bg-black/60
              rounded-xl shadow-inner text-xl text-center focus:outline-none
              focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 text-white placeholder-white/30 transition-all"
            type="text"
            placeholder=${translateText("effects.search")}
            .value=${this.search}
            @change=${this.handleSearch}
            @keyup=${this.handleSearch}
          />
        </div>
      </div>
    `;
  }

  protected renderBody(tab: string) {
    return html`
      <div class="flex flex-col">
        <div class="flex justify-center py-3 shrink-0">
          <o-button
            class="no-crazygames"
            variant="primary"
            size="sm"
            translationKey="main.store"
            @click=${() => {
              this.close();
              window.showPage?.("page-item-store");
            }}
          ></o-button>
        </div>
        <effects-grid
          mode="select"
          .cosmetics=${this.cosmetics}
          .userMeResponse=${this.userMeResponse}
          .search=${this.search}
          .effectType=${tab}
        ></effects-grid>
      </div>
    `;
  }
}
