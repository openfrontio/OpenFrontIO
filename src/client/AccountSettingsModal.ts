import { html, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { getUserMe } from "./Api";
import "./components/AccountSettingsPanel";
import type { AccountSettingsPanel } from "./components/AccountSettingsPanel";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { signedOutNotice } from "./components/ui/SignedOutNotice";
import { translateText } from "./Utils";

/**
 * Standalone account settings, opened from the nav profile menu
 * (`#modal=account-settings`). Shares <account-settings-panel> with the account
 * modal's settings tab, so both entry points show the same controls.
 */
@customElement("account-settings-modal")
export class AccountSettingsModal extends BaseModal {
  protected routerName = "account-settings";

  @state() private userMeResponse: UserMeResponse | false = false;
  @state() private isLoadingUser = false;

  protected modalConfig() {
    return { maxWidth: "620px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText("account_settings_modal.title"),
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
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">
          <account-settings-panel
            .player=${this.userMeResponse.player}
            .user=${this.userMeResponse.user}
          ></account-settings-panel>
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
        console.warn("AccountSettingsModal: failed to fetch user", err);
      })
      .finally(() => {
        this.isLoadingUser = false;
      });
  }

  protected onClose(): void {
    // The delete-account dialog portals to document.body, so it would outlive
    // this (merely hidden) modal if left open.
    this.querySelector<AccountSettingsPanel>(
      "account-settings-panel",
    )?.closeDialogs();
  }
}
