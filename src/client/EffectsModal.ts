import { html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { Cosmetics } from "../core/CosmeticSchemas";
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
      </div>
    `;
  }

  protected renderBody() {
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
        ></effects-grid>
      </div>
    `;
  }
}
