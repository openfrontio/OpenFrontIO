import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SteamUser } from "../../../../core/ApiSchemas";
import { translateText } from "../../../Utils";

@customElement("steam-user-header")
export class SteamUserHeader extends LitElement {
  createRenderRoot() {
    return this;
  }

  @state() private _data: SteamUser | null = null;
  // Tracks a broken avatar image so we can stop rendering the <img> via Lit
  // state rather than mutating the element directly — Lit reuses the same
  // <img> across renders, so an imperative `style.display = "none"` would
  // stick around even after `data` changes to a working avatar.
  @state() private _avatarError = false;

  @property({ attribute: false })
  get data(): SteamUser | null {
    return this._data;
  }
  set data(v: SteamUser | null) {
    this._data = v;
    this._avatarError = false;
    this.requestUpdate();
  }

  render() {
    if (!this._data) return html``;
    // Fall back on an empty or null persona (explicit check rather than `||`,
    // which the repo lint rule forbids).
    const name = this._data.personaName?.trim()
      ? this._data.personaName
      : translateText("steam_user_header.default_name");
    const avatar = this._data.avatarUrl;
    return html`
      <div class="flex items-center gap-2">
        ${avatar && !this._avatarError
          ? html`
              <div class="p-[3px] rounded-full bg-gray-500">
                <img
                  class="w-12 h-12 rounded-full block"
                  src="${avatar}"
                  alt="${translateText("steam_user_header.avatar_alt")}"
                  @error=${() => {
                    this._avatarError = true;
                  }}
                />
              </div>
            `
          : null}
        <span class="font-semibold text-white">${name}</span>
      </div>
    `;
  }
}
