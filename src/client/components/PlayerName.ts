import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { isVerifiedUsername } from "../../core/ApiSchemas";
import "./CopyButton";
import { verifiedBadge } from "./ui/VerifiedBadge";

/**
 * Standard rendering of a player identity on account surfaces (friends, clan
 * lists, leaderboards, profiles): the account username when set — with the
 * verified check when it's a bare-name claim (isVerifiedUsername) — falling
 * back to `fallbackName` (e.g. a session name) and then the publicId.
 * Clicking copies the account username when set, the publicId otherwise —
 * never the fallback name, which isn't an account identity. `copyText`
 * overrides the copy payload entirely (e.g. a share URL).
 */
@customElement("player-name")
export class PlayerName extends LitElement {
  @property({ attribute: false }) username: string | null | undefined = null;
  @property({ type: String }) publicId = "";
  // Display-only fallback shown before the publicId when no account username
  // is set. Never badged and never copied.
  @property({ attribute: false }) fallbackName: string | null | undefined =
    null;
  // Copy payload override (e.g. a share URL).
  @property({ type: String }) copyText = "";

  createRenderRoot() {
    return this;
  }

  render() {
    const copyText =
      this.copyText !== "" ? this.copyText : (this.username ?? this.publicId);
    // inline-flex so the element sits on one line with inline siblings
    // (dates, role chips) while keeping the badge glued to the name.
    return html`
      <span class="inline-flex items-center gap-1.5 min-w-0 max-w-full">
        <copy-button
          compact
          .copyText=${copyText}
          .displayText=${this.username ?? this.fallbackName ?? this.publicId}
          .showVisibilityToggle=${false}
          .showCopyIcon=${false}
        ></copy-button>
        ${isVerifiedUsername(this.username) ? verifiedBadge() : nothing}
      </span>
    `;
  }
}
