import { html, TemplateResult } from "lit";
import { translateText } from "../../Utils";

// Valve's Steam mark, inline rather than an asset so the login button and the
// link button cannot drift, and so no new brand file has to ship. Same path
// data as SteamWishlistButton.
export const steamGlyph = (classes: string): TemplateResult => html`
  <svg
    class=${classes}
    viewBox="0 0 91.05 91.21"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      d="M45.45,0C21.49,0,1.87,18.47,0,41.95l24.44,10.11c2.07-1.42,4.57-2.24,7.27-2.24,.24,0,.48,0,.72,.02l10.87-15.76c0-.07,0-.15,0-.22,0-9.48,7.72-17.2,17.2-17.2s17.2,7.72,17.2,17.2-7.72,17.2-17.2,17.2c-.13,0-.26,0-.39,0l-15.5,11.06c0,.2,.01,.41,.01,.61,0,7.12-5.79,12.91-12.91,12.91-6.25,0-11.47-4.46-12.66-10.37L1.57,58.03c5.41,19.14,23,33.18,43.88,33.18,25.19,0,45.6-20.42,45.6-45.6S70.63,0,45.45,0Z"
    />
    <path
      d="M28.58,69.2l-5.6-2.31c.99,2.07,2.71,3.8,4.99,4.75,4.93,2.05,10.61-.29,12.67-5.22,.99-2.39,1-5.02,.01-7.41-.98-2.39-2.84-4.26-5.23-5.25-2.37-.99-4.91-.95-7.14-.11l5.79,2.39c3.64,1.52,5.36,5.69,3.84,9.33-1.51,3.64-5.69,5.36-9.33,3.84Z"
    />
    <path
      d="M71.96,33.85c0-6.32-5.14-11.46-11.46-11.46s-11.46,5.14-11.46,11.46,5.14,11.46,11.46,11.46,11.46-5.14,11.46-11.46Zm-20.05-.02c0-4.75,3.86-8.61,8.61-8.61s8.61,3.85,8.61,8.61-3.85,8.61-8.61,8.61-8.61-3.85-8.61-8.61Z"
    />
  </svg>
`;

/**
 * "Link Steam account" button, in Steam's dark brand palette.
 *
 * The caller renders the permanence warning next to it. That is not optional
 * copy: Steam recommends that users cannot self-unlink Steam from an external
 * account, so this button starts a ONE-WAY change that only support can undo.
 * The warning therefore has to be readable BEFORE the click — by the time the
 * player is back from Steam the link already exists.
 */
export const steamLinkButton = (
  onClick: (event: MouseEvent) => unknown,
  labelKey: string = "account_modal.link_steam",
): TemplateResult => html`
  <button
    @click=${onClick}
    class="w-full px-6 py-3 text-white bg-[#1b2838] hover:bg-[#2a475e] border border-[#66c0f4]/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#66c0f4] transition-colors duration-200 flex items-center justify-center gap-3 shadow-lg"
  >
    ${steamGlyph("w-5 h-5 shrink-0")}
    <span class="font-bold tracking-wide">${translateText(labelKey)}</span>
  </button>
`;
