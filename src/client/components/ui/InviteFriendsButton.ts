import { html, TemplateResult } from "lit";
import { desktopPresence } from "../../DesktopPresence";
import { translateText } from "../../Utils";

/**
 * "Invite Friends", or nothing when Steam's invite dialog is not reachable.
 *
 * Shared by every lobby surface rather than living on one of them. It first
 * shipped inline in JoinLobbyModal, which meant the host of a private lobby —
 * the player holding the code and deciding who joins — was the only one who
 * never got it. Two copies would drift the same way; one cannot.
 *
 * Desktop-shell-only: isAvailable() checks shell.api >= 2, which is false in a
 * browser and on an older depot's shell. Returning undefined rather than an
 * empty template lets callers keep rendering byte-identical markup where the
 * button is absent.
 *
 * The click is best-effort. The bridge resolves false when Steam is absent or
 * the overlay refuses, and a lobby must not break on that.
 */
export function inviteFriendsButton(): TemplateResult | undefined {
  if (!desktopPresence.isAvailable()) return undefined;
  const label = translateText("public_lobby.invite_friends");
  return html`<button
    data-test-invite-friends
    type="button"
    @click=${() => void desktopPresence.openInviteDialog()}
    class="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1 border border-white/10 text-white/60 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors"
    title=${label}
    aria-label=${label}
  >
    <svg
      class="w-4 h-4"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 00-6 6v1h12v-1a6 6 0 00-6-6zM16 7a1 1 0 00-2 0v2h-2a1 1 0 000 2h2v2a1 1 0 002 0v-2h2a1 1 0 000-2h-2V7z"
      ></path>
    </svg>
    ${label}
  </button>`;
}
