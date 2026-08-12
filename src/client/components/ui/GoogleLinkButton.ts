import { html, TemplateResult } from "lit";
import { assetUrl } from "../../../core/AssetUrls";
import { translateText } from "../../Utils";

/**
 * "Link Google account" button. Shared by the account modal's identity card and
 * the account-settings panel's bind-an-email state so both entry points keep
 * Google's brand styling (white surface, dark text, multicolour mark) in sync.
 */
export const googleLinkButton = (
  onClick: (event: MouseEvent) => unknown,
): TemplateResult => html`
  <button
    @click=${onClick}
    class="w-full px-6 py-3 text-[#1f1f1f] bg-white hover:bg-[#f7f8f8] border border-[#dadce0] rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#4285F4] transition-colors duration-200 flex items-center justify-center gap-3 shadow-lg"
  >
    <img
      src=${assetUrl("images/GoogleLogo.svg")}
      alt=${translateText("account_modal.google_alt")}
      class="w-5 h-5"
    />
    <span class="font-bold tracking-wide"
      >${translateText("account_modal.link_google")}</span
    >
  </button>
`;
