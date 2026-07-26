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

  @property({ attribute: false })
  get data(): SteamUser | null {
    return this._data;
  }
  set data(v: SteamUser | null) {
    this._data = v;
    this.requestUpdate();
  }

  render() {
    if (!this._data) return html``;
    const name = this._data.personaName ?? "";
    const avatar = this._data.avatarUrl;
    return html`
      <div class="flex items-center gap-2">
        ${avatar
          ? html`
              <div class="p-[3px] rounded-full bg-gray-500">
                <img
                  class="w-12 h-12 rounded-full block"
                  src="${avatar}"
                  alt="${translateText("steam_user_header.avatar_alt")}"
                />
              </div>
            `
          : null}
        <span class="font-semibold text-white">${name}</span>
      </div>
    `;
  }
}
