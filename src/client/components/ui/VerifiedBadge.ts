import { html, nothing, TemplateResult } from "lit";
import { translateText } from "../../Utils";

// The blue check-circle that marks a verified account name everywhere it
// appears — player lists, the profile modal, the play-page identity bar.
// Callers gate on isVerifiedUsername(accountUsername) — never on
// session/free-form names.
//
// `colorClass` exists for the identity bar's off state, which draws the same
// mark greyed out; pass `label: null` there, since a control that is *not*
// currently verified must not announce itself as a verified player.
export function verifiedBadge(
  sizeClass = "w-4 h-4",
  colorClass = "text-blue-400",
  label?: string | null,
): TemplateResult {
  const text =
    label === undefined ? translateText("username.verified_player") : label;
  return html`<svg
    viewBox="0 0 24 24"
    class="${sizeClass} ${colorClass} shrink-0"
    role=${text === null ? nothing : "img"}
    aria-hidden=${text === null ? "true" : nothing}
    aria-label=${text ?? nothing}
  >
    ${text === null ? nothing : html`<title>${text}</title>`}
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
