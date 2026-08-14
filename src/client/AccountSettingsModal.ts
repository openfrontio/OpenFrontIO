import { html, TemplateResult } from "lit";
import { customElement } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import "./components/AccountSettingsPanel";
import type { AccountSettingsPanel } from "./components/AccountSettingsPanel";
import { consumeGoogleLinkResult } from "./GoogleLinkResult";
import { ProfileMenuModal } from "./ProfileMenuModal";

/**
 * Standalone account settings, opened from the nav profile menu
 * (`#modal=account-settings`). Hosts <account-settings-panel> — marketing
 * consent, the bind-an-email flow and account deletion.
 */
@customElement("account-settings-modal")
export class AccountSettingsModal extends ProfileMenuModal {
  protected routerName = "account-settings";
  protected titleKey = "account_settings_modal.title";

  protected renderSignedIn(userMe: UserMeResponse): TemplateResult {
    return html`
      <div class="custom-scrollbar mr-1">
        <div class="p-6">
          <account-settings-panel
            .player=${userMe.player}
            .user=${userMe.user}
          ></account-settings-panel>
        </div>
      </div>
    `;
  }

  protected onOpenExtra(args?: Record<string, unknown>): void {
    // The panel starts the Google link flow, and linkGoogle() returns to
    // whatever URL started it — so the `link=<result>` arg comes back here.
    consumeGoogleLinkResult(args);
  }

  protected onClose(): void {
    // The delete-account dialog portals to document.body, so it would outlive
    // this (merely hidden) modal if left open.
    this.querySelector<AccountSettingsPanel>(
      "account-settings-panel",
    )?.closeDialogs();
  }
}
