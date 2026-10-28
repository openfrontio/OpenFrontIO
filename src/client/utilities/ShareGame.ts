import { ClientEnv } from "../ClientEnv";
import { gamePortal } from "../GamePortal";
import { copyToClipboard, showToast, translateText } from "../Utils";

/**
 * Copies the game link to the clipboard and shows a toast.
 * On game portals (CrazyGames, Poki), generates a portal invite link.
 * On desktop shell and web, uses ClientEnv.shareOrigin() to ensure valid links.
 */
export async function shareGame(gameId: string | undefined): Promise<void> {
  if (!gameId) {
    showToast(translateText("common.failed_copy"), "red");
    return;
  }

  try {
    const text = gamePortal.isOnGamePortal()
      ? await gamePortal.createInviteLink(gameId)
      : `${ClientEnv.shareOrigin()}${ClientEnv.gamePath(gameId)}`;

    if (!text) {
      showToast(translateText("common.failed_copy"), "red");
      return;
    }

    await copyToClipboard(text);
    showToast(translateText("common.copied"), "green");
  } catch {
    showToast(translateText("common.failed_copy"), "red");
  }
}
