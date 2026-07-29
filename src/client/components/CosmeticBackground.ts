import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  PATTERN_KEY,
  USER_SETTINGS_CHANGED_EVENT,
} from "../../core/game/UserSettings";
import { PlayerPattern, PlayerSkin } from "../../core/Schemas";
import { getPlayerCosmetics } from "../Cosmetics";
import { generatePreviewDataUrl } from "./PatternPreview";

// Fills its (positioned) parent with the local player's selected cosmetic, so the
// identity bubble reads like that player's territory does in-game. Skin texture wins
// over pattern (same precedence as in-game); nothing selected -> renders nothing, so
// the bubble's base surface shows through. Re-reads on cosmetic change (skin button).
@customElement("cosmetic-background")
export class CosmeticBackground extends LitElement {
  @state() private pattern: PlayerPattern | null = null;
  @state() private skin: PlayerSkin | null = null;
  private abort: AbortController | null = null;

  createRenderRoot() {
    return this;
  }

  async connectedCallback() {
    super.connectedCallback();
    this.abort = new AbortController();
    await this.load();
    window.addEventListener(
      `${USER_SETTINGS_CHANGED_EVENT}:${PATTERN_KEY}`,
      () => void this.load(),
      { signal: this.abort.signal },
    );
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.abort?.abort();
    this.abort = null;
  }

  private async load() {
    const c = await getPlayerCosmetics();
    if (!this.isConnected) return;
    this.pattern = c.pattern ?? null;
    this.skin = c.skin ?? null;
  }

  render() {
    if (this.skin) {
      return html`<div
        class="w-full h-full pointer-events-none"
        style="background-image:url('${this.skin
          .url}');background-size:cover;background-position:center"
      ></div>`;
    }
    if (this.pattern) {
      const url = generatePreviewDataUrl(this.pattern);
      if (!url) return nothing;
      return html`<div
        class="w-full h-full pointer-events-none [image-rendering:pixelated]"
        style="background-image:url('${url}');background-repeat:repeat;background-size:auto 100%"
      ></div>`;
    }
    return nothing;
  }
}
