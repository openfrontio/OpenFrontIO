import "./components/ConfirmDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { gamePortal } from "./GamePortal";
import { translateText } from "./Utils";

/**
 * Promise-based, imperative replacements for the native `confirm()` / `alert()`
 * browser dialogs, for use during gameplay (portals disallow native prompts
 * inside the game frame). These wrap the shared <confirm-dialog> component so
 * the styling stays consistent with the rest of the app, and are callable from
 * non-Lit contexts (WebSocket handlers, popstate, etc.).
 *
 * While a pop-up is displayed we report gameplay as stopped to the portal, and
 * resume it once dismissed.
 */
function showDialog(props: Partial<ConfirmDialog>): Promise<boolean> {
  const dialog = document.createElement("confirm-dialog") as ConfirmDialog;
  Object.assign(dialog, props);

  gamePortal.gameplayStop();
  document.body.appendChild(dialog);

  return new Promise<boolean>((resolve) => {
    const done = (result: boolean) => {
      dialog.remove();
      gamePortal.gameplayStart();
      resolve(result);
    };
    dialog.addEventListener("confirm", () => done(true));
    dialog.addEventListener("cancel", () => done(false));
  });
}

/**
 * In-game replacement for `confirm()`. Resolves true when confirmed.
 * `options` overrides the dialog's presentation (variant, texts, heading)
 * for confirmations that aren't destructive-red by nature.
 */
export function showInGameConfirm(
  message: string,
  options?: Partial<ConfirmDialog>,
): Promise<boolean> {
  return showDialog({
    message,
    variant: "danger",
    buttons: "confirmCancel",
    ...options,
  });
}

/** In-game replacement for `alert()`. Resolves once dismissed. */
export function showInGameAlert(
  message: string,
  options?: Partial<ConfirmDialog>,
): Promise<boolean> {
  return showDialog({
    message,
    variant: "warning",
    buttons: "confirmOnly",
    confirmText: translateText("common.close"),
    ...options,
  });
}
