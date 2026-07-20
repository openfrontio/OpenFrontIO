import { html, TemplateResult } from "lit";
import { translateText } from "../../Utils";

// The same blue check-circle as the UsernameInput verified toggle, sized for
// inline placement next to a player name in lists. Callers gate on
// isVerifiedUsername(accountUsername) — never on session/free-form names.
export function verifiedBadge(): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    class="w-4 h-4 text-blue-400 shrink-0"
    role="img"
    aria-label=${translateText("username.verified_toggle")}
  >
    <title>${translateText("username.verified_toggle")}</title>
    <circle cx="12" cy="12" r="10" fill="currentColor"></circle>
    <path
      d="M7.5 12.5l3 3 6-6.5"
      stroke="white"
      stroke-width="2.2"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    ></path>
  </svg>`;
}
