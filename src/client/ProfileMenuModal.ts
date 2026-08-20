import { TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { UserMeResponse } from "../core/ApiSchemas";
import { getUserMe } from "./Api";
import { BaseModal } from "./components/BaseModal";
import { modalHeader } from "./components/ui/ModalHeader";
import { signedOutNotice } from "./components/ui/SignedOutNotice";
import { translateText } from "./Utils";

/**
 * Shared shell for the small modals opened from the nav profile menu
 * (account settings, change username, subscription): a titled popup that
 * resolves /users/@me on open, shows a spinner while it does, and falls back to
 * the sign-in notice when there's no session.
 *
 * Subclasses provide `titleKey` and render the signed-in body.
 */
export abstract class ProfileMenuModal extends BaseModal {
  @state() protected userMeResponse: UserMeResponse | false = false;
  @state() protected isLoadingUser = false;

  /** Translation key for the modal header. */
  protected abstract titleKey: string;

  /** Body for a resolved, signed-in session. */
  protected abstract renderSignedIn(
    userMe: UserMeResponse,
  ): TemplateResult | typeof import("lit").nothing;

  protected modalConfig() {
    return { maxWidth: "620px" };
  }

  protected renderHeaderSlot() {
    return modalHeader({
      title: translateText(this.titleKey),
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
    return this.renderSignedIn(this.userMeResponse) as TemplateResult;
  }

  protected onOpen(args?: Record<string, unknown>): void {
    this.loadUser();
    this.onOpenExtra(args);
  }

  /** Extra open-time work (e.g. fetching cosmetics). */
  protected onOpenExtra(_args?: Record<string, unknown>): void {}

  /**
   * Re-resolve the session. Drops the previous response first so a failed or
   * signed-out reload can't leave stale account data on screen.
   */
  protected loadUser(): void {
    this.userMeResponse = false;
    this.isLoadingUser = true;
    void getUserMe()
      .then((userMe) => {
        this.userMeResponse = userMe ?? false;
      })
      .catch((err) => {
        console.warn(
          `${this.tagName.toLowerCase()}: failed to fetch user`,
          err,
        );
      })
      .finally(() => {
        this.isLoadingUser = false;
      });
  }
}
