import { ClientID, GameID } from "../../core/Schemas";
import { translateText } from "../Utils";

export function showErrorModal(
  error: string,
  message: string | undefined,
  gameID: GameID,
  clientID: ClientID,
  closable = false,
  showDiscord = true,
  heading = "error_modal.crashed",
): void {
  if (document.querySelector("#error-modal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.id = "error-modal";

  const content = [
    showDiscord ? translateText("error_modal.paste_discord") : null,
    translateText(heading),
    `game id: ${gameID}`,
    `client id: ${clientID}`,
    `Error: ${error}`,
    message ? `Message: ${message}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Create elements
  const pre = document.createElement("pre");
  pre.textContent = content;

  const button = document.createElement("button");
  button.textContent = translateText("error_modal.copy_clipboard");
  button.className = "copy-btn";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(content);
      button.textContent = translateText("error_modal.copied");
    } catch {
      button.textContent = translateText("error_modal.failed_copy");
    }
  });

  // Add to modal
  modal.appendChild(pre);
  modal.appendChild(button);
  if (closable) {
    const closeButton = document.createElement("button");
    closeButton.textContent = "X";
    closeButton.className = "close-btn";
    closeButton.addEventListener("click", () => {
      modal.remove();
    });
    modal.appendChild(closeButton);
  }

  document.body.appendChild(modal);
}
