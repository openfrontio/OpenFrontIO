import { html, TemplateResult } from "lit";
import { translateText } from "../../Utils";
import "../baseComponents/Button";

/**
 * Empty state for the profile-menu modals (account settings, change username,
 * subscription) when there is no signed-in session: explain why the modal is
 * empty and hand off to the account modal's sign-in options.
 */
export const signedOutNotice = (
  onSignIn: () => void,
  message: string = translateText("account_modal.sign_in_desc"),
): TemplateResult => html`
  <div class="p-6">
    <div
      class="bg-white/5 rounded-xl border border-white/10 p-8 text-center flex flex-col items-center gap-4"
    >
      <p class="text-white/60 text-sm">${message}</p>
      <o-button
        variant="primary"
        size="md"
        translationKey="main.sign_in"
        @click=${onSignIn}
      ></o-button>
    </div>
  </div>
`;
