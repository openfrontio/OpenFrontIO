import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { isVerifiedUsername } from "../../core/ApiSchemas";
import "./CopyButton";
import { verifiedBadge } from "./ui/VerifiedBadge";

/**
 * Standard rendering of a player identity on account surfaces (friends, clan
 * lists, leaderboards, profiles): the account username when set — with the
 * verified check when it's a bare-name claim (isVerifiedUsername) — falling
 * back to the publicId. Clicking copies the account username when set, the
 * publicId otherwise. `copyText` overrides the copy payload entirely (e.g. a
 * share URL).
 */
@customElement("player-name")
export class PlayerName extends LitElement {
  @property({ attribute: false }) username: string | null | undefined = null;
  @property({ type: String }) publicId = "";
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
          .displayText=${this.username ?? this.publicId}
          .showVisibilityToggle=${false}
          .showCopyIcon=${false}
        ></copy-button>
        ${isVerifiedUsername(this.username) ? verifiedBadge() : nothing}
      </span>
    `;
  }
}
