import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Platform } from "../Platform";
import { copyToClipboard, showToast, translateText } from "../Utils";

// Ways to pass a profile on: copy the link, post it to X, or copy a ready
// message for Discord (which unfurls the link into the profile card). On a
// phone or tablet with a native share sheet, one Share button opens that
// instead, since it already offers every app the player has.

/** The X (Twitter) compose URL for a link and a line of text. */
export function xShareUrl(url: string, text: string): string {
  return `https://x.com/intent/post?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

/** What "Copy for Discord" puts on the clipboard: the line, then the link. */
export function discordShareText(url: string, text: string): string {
  return `${text}\n${url}`;
}

// The native share sheet, where there is one to use. Desktop Chrome on
// Windows has navigator.share too, but there the three buttons say more than
// a generic Share, so the sheet is kept to touch devices.
export function useNativeShare(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    Platform.isTouch
  );
}

const BUTTON =
  "inline-flex min-h-[38px] items-center gap-2 rounded-[10px] border border-white/15 bg-white/5 px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/30";

const linkIcon = html`<svg
  width="16"
  height="16"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  aria-hidden="true"
>
  <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
  <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
</svg>`;

const xIcon = html`<svg
  width="14"
  height="14"
  viewBox="0 0 24 24"
  fill="currentColor"
  aria-hidden="true"
>
  <path
    d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"
  />
</svg>`;

const chatIcon = html`<svg
  width="16"
  height="16"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M4 5h16v11H9l-5 4z" />
</svg>`;

const shareIcon = html`<svg
  width="16"
  height="16"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d="M12 3v12" />
  <path d="M7 8l5-5 5 5" />
  <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
</svg>`;

@customElement("profile-share")
export class ProfileShare extends LitElement {
  // The canonical profile link (playerProfileUrl).
  @property({ type: String }) url = "";
  // The player's display name, for the line that goes with the link.
  @property({ type: String }) name = "";

  // Read out by screen readers after a copy: the toast that shows it is not
  // a live region.
  @state() private announcement = "";

  createRenderRoot() {
    return this;
  }

  private shareText(): string {
    return translateText("player_profile.share_text", { name: this.name });
  }

  private async copy(text: string): Promise<void> {
    // Cleared first so copying twice announces twice.
    this.announcement = "";
    try {
      await copyToClipboard(text);
      const copied = translateText("common.copied");
      showToast(copied, "green");
      this.announcement = copied;
    } catch {
      const failed = translateText("common.failed_copy");
      showToast(failed, "red");
      this.announcement = failed;
    }
  }

  // Opens in a new tab on the web. In the desktop shell, the shell's
  // window-open policy sends every https link to the system browser (the
  // same route the shell's other external links take, e.g. linkGoogle).
  private shareOnX(): void {
    window.open(
      xShareUrl(this.url, this.shareText()),
      "_blank",
      "noopener,noreferrer",
    );
  }

  private async nativeShare(): Promise<void> {
    try {
      await navigator.share({
        title: translateText("player_profile.title"),
        text: this.shareText(),
        url: this.url,
      });
    } catch (err) {
      // Dismissing the sheet rejects with AbortError: nothing to do. Any
      // other failure falls back to copying the link.
      if (err instanceof DOMException && err.name === "AbortError") return;
      await this.copy(this.url);
    }
  }

  private button(
    action: string,
    icon: TemplateResult,
    label: string,
    onClick: () => void,
  ): TemplateResult {
    return html`<button
      type="button"
      class=${BUTTON}
      data-share=${action}
      @click=${onClick}
    >
      ${icon}<span>${label}</span>
    </button>`;
  }

  render() {
    if (this.url === "") return nothing;
    return html`
      <div class="flex flex-wrap gap-2">
        ${useNativeShare()
          ? this.button(
              "native",
              shareIcon,
              translateText("player_profile.share_native"),
              () => void this.nativeShare(),
            )
          : html`
              ${this.button(
                "copy",
                linkIcon,
                translateText("player_profile.share_copy_link"),
                () => void this.copy(this.url),
              )}
              ${this.button(
                "x",
                xIcon,
                translateText("player_profile.share_x"),
                () => this.shareOnX(),
              )}
              ${this.button(
                "discord",
                chatIcon,
                translateText("player_profile.share_discord"),
                () =>
                  void this.copy(discordShareText(this.url, this.shareText())),
              )}
            `}
      </div>
      <span class="sr-only" role="status" aria-live="polite"
        >${this.announcement}</span
      >
    `;
  }
}
