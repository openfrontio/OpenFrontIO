import { html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { isVerifiedUsername } from "../../core/ApiSchemas";
import { translateText } from "../Utils";
import "./CopyButton";
import { verifiedBadge } from "./ui/VerifiedBadge";

/**
 * Standard rendering of a player identity on account surfaces (friends, clan
 * lists, leaderboards, profiles): the account username when set — with the
 * verified check when it's a bare-name claim (isVerifiedUsername) — falling
 * back to the publicId. Clicking copies the account username when set, the
 * publicId otherwise. `copyText` overrides the copy payload entirely (e.g. a
 * share URL); `onNameClick` replaces copying with an action (e.g. opening
 * the player's profile), styled as the same chip unless `nameClass`
 * overrides it.
 */
@customElement("player-name")
export class PlayerName extends LitElement {
  @property({ attribute: false }) username: string | null | undefined = null;
  @property({ type: String }) publicId = "";
  // Copy payload override (e.g. a share URL).
  @property({ type: String }) copyText = "";
  // When set, clicking the name runs this instead of copying.
  @property({ attribute: false }) onNameClick: (() => void) | null = null;
  // Styling override for the clickable name (e.g. leaderboard rows keep
  // their original bold look instead of the publicId-chip look).
  @property({ type: String }) nameClass = "";

  createRenderRoot() {
    return this;
  }

  render() {
    const displayName = this.username ?? this.publicId;
    const copyText =
      this.copyText !== "" ? this.copyText : (this.username ?? this.publicId);
    // inline-flex so the element sits on one line with inline siblings
    // (dates, role chips) while keeping the badge glued to the name.
    return html`
      <span class="inline-flex items-center gap-1.5 min-w-0 max-w-full">
        ${this.onNameClick
          ? html`<button
              type="button"
              class=${this.nameClass !== ""
                ? this.nameClass
                : "text-xs text-white/60 font-mono bg-white/5 px-2 py-0.5 rounded border border-white/5 hover:bg-white/10 hover:text-white transition-colors"}
              title=${translateText("player_profile.view")}
              aria-label=${translateText("player_profile.view")}
              @click=${() => this.onNameClick?.()}
            >
              ${displayName}
            </button>`
          : html`<copy-button
              compact
              .copyText=${copyText}
              .displayText=${displayName}
              .showVisibilityToggle=${false}
              .showCopyIcon=${false}
            ></copy-button>`}
        ${isVerifiedUsername(this.username) ? verifiedBadge() : nothing}
      </span>
    `;
  }
}
