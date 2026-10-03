import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { Platform } from "../Platform";
import { copyToClipboard, showToast, translateText } from "../Utils";

// Ways to pass a profile on: copy the link, post it to X, or copy a ready
// message for Discord (which unfurls the link into the profile card). On a
// phone or tablet with a native share sheet, one Share button opens that
// instead, since it already offers every app the player has.
//
// Laid out as a row of buttons (the profile, the prestige ceremony), or as one
// labelled button that opens the same three as a menu (the end-of-game
// popup's footer, where a row doesn't fit). The link can carry a moment
// (`?moment=level50`) with its own line: see MomentShare.

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

const BUTTON_BASE =
  "inline-flex min-h-[38px] items-center gap-2 rounded-[10px] border px-3.5 text-[13px] font-semibold text-white transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-white/30";
// On a panel, the buttons are a light tint of it.
const BUTTON = `${BUTTON_BASE} border-white/15 bg-white/5 hover:bg-white/10`;
// Over a busy backdrop (the prestige ceremony's honeycomb), they need a
// backing of their own to read.
const BUTTON_SOLID = `${BUTTON_BASE} border-white/20 bg-zinc-900/85 shadow-lg backdrop-blur-sm hover:bg-zinc-800/95`;

const MENU_ITEM =
  "flex min-h-10 w-full items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 text-left text-sm font-semibold text-white transition-colors hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-hidden";

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

interface ShareAction {
  action: "copy" | "x" | "discord";
  icon: TemplateResult;
  labelKey: string;
}

const ACTIONS: readonly ShareAction[] = [
  {
    action: "copy",
    icon: linkIcon,
    labelKey: "player_profile.share_copy_link",
  },
  { action: "x", icon: xIcon, labelKey: "player_profile.share_x" },
  {
    action: "discord",
    icon: chatIcon,
    labelKey: "player_profile.share_discord",
  },
];

@customElement("profile-share")
export class ProfileShare extends LitElement {
  // The link to share: the canonical profile link (playerProfileUrl), or a
  // moment's (momentShareUrl).
  @property({ type: String }) url = "";
  // The player's display name, for the profile's line that goes with the
  // link. Unused when `text` is set.
  @property({ type: String }) name = "";
  // The line that goes with the link. Empty: the profile's own line.
  @property({ type: String }) text = "";
  // "row": the buttons side by side. "menu": one button, labelled `label`,
  // that opens them as a menu (or the share sheet, on a touch device).
  @property({ type: String }) layout: "row" | "menu" = "row";
  @property({ type: String }) label = "";
  // The menu button's classes, so it can match the buttons beside it.
  @property({ type: String }) triggerClass = "";
  // Opaque buttons, for a busy backdrop.
  @property({ type: Boolean }) solid = false;
  // Centre the row.
  @property({ type: Boolean }) centered = false;

  // Read out by screen readers after a copy: the toast that shows it is not
  // a live region.
  @state() private announcement = "";
  @state() private menuOpen = false;

  createRenderRoot() {
    return this;
  }

  disconnectedCallback(): void {
    this.listenOutside(false);
    this.menuOpen = false;
    super.disconnectedCallback();
  }

  private shareText(): string {
    return this.text !== ""
      ? this.text
      : translateText("player_profile.share_text", { name: this.name });
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

  private run(action: ShareAction["action"]): void {
    switch (action) {
      case "copy":
        void this.copy(this.url);
        return;
      case "x":
        this.shareOnX();
        return;
      case "discord":
        void this.copy(discordShareText(this.url, this.shareText()));
        return;
    }
  }

  // ---------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------

  private trigger(): HTMLButtonElement | null {
    return this.querySelector<HTMLButtonElement>('[data-share="menu"]');
  }

  private menuItems(): HTMLButtonElement[] {
    return [
      ...this.querySelectorAll<HTMLButtonElement>("[data-share-menu] button"),
    ];
  }

  private openMenu(): void {
    this.menuOpen = true;
    this.listenOutside(true);
    void this.updateComplete.then(() => this.menuItems()[0]?.focus());
  }

  private closeMenu(refocus: boolean): void {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.listenOutside(false);
    if (refocus) this.trigger()?.focus();
  }

  private onTrigger(): void {
    if (useNativeShare()) {
      void this.nativeShare();
      return;
    }
    if (this.menuOpen) this.closeMenu(false);
    else this.openMenu();
  }

  private listenOutside(on: boolean): void {
    if (on) document.addEventListener("pointerdown", this.onOutside, true);
    else document.removeEventListener("pointerdown", this.onOutside, true);
  }

  // A press anywhere else closes the menu.
  private onOutside = (e: Event): void => {
    if (!this.contains(e.target as Node)) this.closeMenu(false);
  };

  private onMenuKey(e: KeyboardEvent): void {
    if (!this.menuOpen) return;
    const items = this.menuItems();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (e.key) {
      case "Escape":
        // Only the menu closes: whatever holds it stays open.
        e.preventDefault();
        e.stopPropagation();
        this.closeMenu(true);
        return;
      case "Tab":
        this.closeMenu(false);
        return;
      case "ArrowDown":
        next = at === -1 ? 0 : (at + 1) % items.length;
        break;
      case "ArrowUp":
        next =
          at === -1 ? items.length - 1 : (at - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    items[next]?.focus();
  }

  private renderMenu(): TemplateResult {
    const native = useNativeShare();
    return html`<div
      class="relative flex w-full"
      @keydown=${(e: KeyboardEvent) => this.onMenuKey(e)}
    >
      <button
        type="button"
        data-share="menu"
        class=${this.triggerClass || BUTTON}
        aria-haspopup=${native ? nothing : "menu"}
        aria-expanded=${native ? nothing : String(this.menuOpen)}
        @click=${() => this.onTrigger()}
      >
        <span class="relative inline-flex items-center gap-2"
          >${shareIcon}<span>${this.label}</span></span
        >
      </button>
      ${this.menuOpen
        ? html`<div
            data-share-menu
            role="menu"
            aria-label=${this.label}
            class="absolute bottom-[calc(100%+8px)] left-1/2 z-50 flex w-max min-w-[220px] -translate-x-1/2 flex-col gap-0.5 rounded-xl border border-white/15 bg-zinc-900 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
          >
            ${ACTIONS.map(
              (a) =>
                html`<button
                  type="button"
                  role="menuitem"
                  data-share=${a.action}
                  class=${MENU_ITEM}
                  @click=${() => {
                    this.run(a.action);
                    this.closeMenu(true);
                  }}
                >
                  <span class="grid w-[18px] place-items-center">${a.icon}</span
                  ><span>${translateText(a.labelKey)}</span>
                </button>`,
            )}
          </div>`
        : nothing}
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Row
  // ---------------------------------------------------------------------------

  private button(
    action: string,
    icon: TemplateResult,
    label: string,
    onClick: () => void,
  ): TemplateResult {
    return html`<button
      type="button"
      class=${this.solid ? BUTTON_SOLID : BUTTON}
      data-share=${action}
      @click=${onClick}
    >
      ${icon}<span>${label}</span>
    </button>`;
  }

  private renderRow(): TemplateResult {
    return html`<div
      class="flex flex-wrap gap-2 ${this.centered ? "justify-center" : ""}"
    >
      ${useNativeShare()
        ? this.button(
            "native",
            shareIcon,
            translateText("player_profile.share_native"),
            () => void this.nativeShare(),
          )
        : ACTIONS.map((a) =>
            this.button(a.action, a.icon, translateText(a.labelKey), () =>
              this.run(a.action),
            ),
          )}
    </div>`;
  }

  render() {
    if (this.url === "") return nothing;
    return html`
      ${this.layout === "menu" ? this.renderMenu() : this.renderRow()}
      <span class="sr-only" role="status" aria-live="polite"
        >${this.announcement}</span
      >
    `;
  }
}
