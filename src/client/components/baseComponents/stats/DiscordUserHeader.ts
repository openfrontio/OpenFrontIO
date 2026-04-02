import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { DiscordUser } from "../../../../core/ApiSchemas";
import { getDiscordAvatarUrl, translateText } from "../../../Utils";

@customElement("discord-user-header")
export class DiscordUserHeader extends LitElement {
  createRenderRoot() {
    return this;
  }

  @state() private _data: DiscordUser | null = null;

  @property({ attribute: false })
  get data(): DiscordUser | null {
    return this._data;
  }
  set data(v: DiscordUser | null) {
    this._data = v;
    this.requestUpdate();
  }

  private get avatarUrl(): string | null {
    const u = this._data;
    if (!u) return null;
    return getDiscordAvatarUrl(u);
  }

  private get discordDisplayName(): string {
    return this._data?.username ?? "";
  }

  render() {
    const defaultAvatar = "https://cdn.discordapp.com/embed/avatars/0.png";
    const imgSrc = this.avatarUrl ?? defaultAvatar;
    return html`
      <div class="flex items-center gap-2">
        ${this._data
          ? html`
              <div class="p-[3px] rounded-full bg-gray-500">
                <img
                  class="w-12 h-12 rounded-full block"
                  src="${imgSrc}"
                  alt="${translateText("discord_user_header.avatar_alt")}"
                  @error=${(e: Event) => {
                    (e.target as HTMLImageElement).src = defaultAvatar;
                  }}
                />
              </div>
            `
          : null}
        <span class="font-semibold text-white">${this.discordDisplayName}</span>
      </div>
    `;
  }
}
