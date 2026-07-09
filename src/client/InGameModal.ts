import "./components/ConfirmDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { crazyGamesSDK } from "./CrazyGamesSDK";
import { translateText } from "./Utils";

/**
 * Promise-based, imperative replacements for the native `confirm()` / `alert()`
 * browser dialogs, for use during gameplay (CrazyGames disallows native prompts
 * inside the game frame). These wrap the shared <confirm-dialog> component so
 * the styling stays consistent with the rest of the app, and are callable from
 * non-Lit contexts (WebSocket handlers, popstate, etc.).
 *
 * While a pop-up is displayed we report gameplay as stopped to CrazyGames, and
 * resume it once dismissed.
 */
function showDialog(props: Partial<ConfirmDialog>): Promise<boolean> {
  const dialog = document.createElement("confirm-dialog") as ConfirmDialog;
  Object.assign(dialog, props);

  crazyGamesSDK.gameplayStop();
  document.body.appendChild(dialog);

  return new Promise<boolean>((resolve) => {
    const done = (result: boolean) => {
      dialog.remove();
      crazyGamesSDK.gameplayStart();
      resolve(result);
    };
    dialog.addEventListener("confirm", () => done(true));
    dialog.addEventListener("cancel", () => done(false));
  });
}

/** In-game replacement for `confirm()`. Resolves true when confirmed. */
export function showInGameConfirm(message: string): Promise<boolean> {
  return showDialog({ message, variant: "danger", buttons: "confirmCancel" });
}

/** In-game replacement for `alert()`. Resolves once dismissed. */
export function showInGameAlert(message: string): Promise<boolean> {
  return showDialog({
    message,
    variant: "warning",
    buttons: "confirmOnly",
    confirmText: translateText("common.close"),
  });
}
