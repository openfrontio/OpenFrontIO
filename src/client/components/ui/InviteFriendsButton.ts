import type { ClientInfo } from "@openfront/shared/WireSchemas";
import { html, TemplateResult } from "lit";
import { whenModalLoaded } from "../../LazyModals";
import { translateText } from "../../Utils";
import type { InviteLobbyModal } from "../InviteLobbyModal";

export interface InviteFriendsButtonOptions {
  lobbyId?: string;
  gameMode?: string;
  map?: string;
  clients?: ClientInfo[];
  isStillInLobby?: () => boolean;
}

/**
 * Checks whether the player is still in the target lobby before opening the lazy-loaded invite modal.
 */
function isPlayerStillInLobby(options?: InviteFriendsButtonOptions): boolean {
  const lobbyId = options?.lobbyId;
  if (!lobbyId) return false;
  if (typeof options?.isStillInLobby === "function") {
    return options.isStillInLobby();
  }
  if (document.body.classList.contains("in-game")) {
    return false;
  }
  const hostModal = document.querySelector<
    HTMLElement & { lobbyId?: string; isOpen?: () => boolean }
  >("host-lobby-modal");
  const joinModal = document.querySelector<
    HTMLElement & { currentLobbyId?: string; isOpen?: () => boolean }
  >("join-lobby-modal");
  if (hostModal || joinModal) {
    const inHost =
      (typeof hostModal?.isOpen !== "function" || hostModal.isOpen()) &&
      hostModal?.lobbyId === lobbyId;
    const inJoin =
      (typeof joinModal?.isOpen !== "function" || joinModal.isOpen()) &&
      joinModal?.currentLobbyId === lobbyId;
    return Boolean(inHost || inJoin);
  }
  return true;
}

/**
 * Universal "Invite Friends" button for private lobbies across web and desktop.
 *
 * Opens <invite-lobby-modal> which lists friends and clan members with fuzzy
 * filtering and status indicators, plus a Steam invite fallback on desktop.
 */
export function inviteFriendsButton(
  options?: InviteFriendsButtonOptions,
): TemplateResult {
  const label = translateText("public_lobby.invite_friends");
  const handleClick = () => {
    whenModalLoaded("invite-lobby-modal", () => {
      if (!isPlayerStillInLobby(options)) {
        return;
      }
      const modal =
        document.querySelector<InviteLobbyModal>("invite-lobby-modal");
      modal?.open(options as Record<string, unknown> | undefined);
    });
  };

  return html`<button
    data-test-invite-friends
    type="button"
    @click=${handleClick}
    class="flex items-center gap-1.5 shrink-0 whitespace-nowrap bg-white/5 hover:bg-white/10 rounded-lg px-2 py-1 border border-white/10 text-white/60 hover:text-white text-xs font-bold uppercase tracking-widest transition-colors cursor-pointer"
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
