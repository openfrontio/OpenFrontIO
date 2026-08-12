import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { getUserMe } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { signedOutNotice } from "./components/ui/SignedOutNotice";
import "./components/UsernamePanel";
import { translateText } from "./Utils";

/**
 * Standalone account-username management, opened from the nav profile menu
 * (`#modal=change-username`). Renders the same <username-panel> as the account
 * modal, so the cooldown/claim rules live in one place.
 */
@customElement("change-username-modal")
export class ChangeUsernameModal extends BaseModal {
  protected routerName = "change-username";

  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private isLoadingUser = false;

  protected modalConfig() {
    return { maxWidth: "620px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("change_username_modal.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  protected renderBody(): TemplateResult {
    if (this.isLoadingUser) {
      return this.renderLoadingSpinner(
        translateText("account_modal.fetching_account"),
      );
    }
    if (this.userMeResponse === false) {
      return signedOutNotice(() => {
        this.close();
        window.showPage?.("page-account");
      });
    }
    const player = this.userMeResponse.player;
    // Older backends don't return the username fields; the panel renders
    // nothing for them, so say why instead of showing an empty modal.
    if (player.usernameStatus === undefined) {
      return html`
        <div class="p-6">
          <div
            class="bg-white/5 rounded-xl border border-white/10 p-8 text-center"
          >
            <p class="text-white/60 text-sm">
              ${translateText("change_username_modal.unavailable")}
            </p>
          </div>
        </div>
      `;
    }
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">
          <username-panel .player=${player}></username-panel>
        </div>
      </div>
    `;
  }

  protected onOpen(): void {
    this.isLoadingUser = true;
    void getUserMe()
      .then((userMe) => {
        this.userMeResponse = userMe ?? false;
      })
      .catch((err) => {
        console.warn("ChangeUsernameModal: failed to fetch user", err);
      })
      .finally(() => {
        this.isLoadingUser = false;
      });
  }
}
